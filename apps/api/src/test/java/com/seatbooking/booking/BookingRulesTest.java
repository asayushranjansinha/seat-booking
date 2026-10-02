package com.seatbooking.booking;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.seatbooking.DemoData;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.ObjectMapper;

/**
 * Two rules the product promises and the database keeps.
 *
 * <p>Over HTTP, because both are enforced below the service and a unit test of the
 * service would prove only that someone remembered to write an if.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BookingRulesTest {

    @LocalServerPort private int port;
    @Autowired private JdbcClient jdbc;

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private List<UUID> seats;

    @BeforeEach
    void setUp() {
        DemoData.requireAnyPublishedSeats(jdbc);
        seats = jdbc.sql("""
                SELECT s.id FROM seat s
                JOIN floor_plan_version v ON v.id = s.plan_version_id
                JOIN room r ON r.id = s.room_id
                WHERE v.status = 'PUBLISHED' AND s.bookable AND r.kind = 'ROOM'
                ORDER BY s.code LIMIT 2
                """).query(UUID.class).list();
        clear();
    }

    @AfterEach
    void tearDown() {
        clear();
        jdbc.sql("UPDATE room SET kind = 'ROOM'").update();
    }

    private void clear() {
        jdbc.sql("DELETE FROM booking").update();
    }

    @Test
    @DisplayName("one desk per person at a time: a second, overlapping booking is refused")
    void oneDeskPerPerson() {
        String token = login("user@demo.test");
        Instant from = Instant.now().plus(2, ChronoUnit.HOURS).truncatedTo(ChronoUnit.HOURS);

        assertEquals(201, book(token, seats.get(0), from, from.plus(2, ChronoUnit.HOURS)).statusCode());

        // A DIFFERENT seat, overlapping in time. The seat is free; the person is not.
        HttpResponse<String> second =
                book(token, seats.get(1), from.plus(1, ChronoUnit.HOURS), from.plus(3, ChronoUnit.HOURS));
        assertEquals(409, second.statusCode(), second.body());
        assertTrue(second.body().contains("ALREADY_HOLDING_A_DESK"), second.body());

        // The same day, not overlapping, is exactly what the rule tells people to do.
        assertEquals(201,
                book(token, seats.get(1), from.plus(2, ChronoUnit.HOURS), from.plus(4, ChronoUnit.HOURS))
                        .statusCode());
    }

    @Test
    @DisplayName("the rule is about overlap, not about the seat")
    void sameSeatBackToBack() {
        String token = login("user@demo.test");
        Instant from = Instant.now().plus(2, ChronoUnit.HOURS).truncatedTo(ChronoUnit.HOURS);
        assertEquals(201, book(token, seats.get(0), from, from.plus(1, ChronoUnit.HOURS)).statusCode());
        // Touching ranges do not overlap: tstzrange is half-open, so this is allowed.
        assertEquals(201,
                book(token, seats.get(0), from.plus(1, ChronoUnit.HOURS), from.plus(2, ChronoUnit.HOURS))
                        .statusCode());
    }

    @Test
    @DisplayName("a cabin turns away an ordinary user and admits a manager")
    void cabinsAreRestricted() {
        UUID seat = seats.get(0);
        jdbc.sql("""
                UPDATE room SET kind = 'CABIN'
                WHERE id = (SELECT room_id FROM seat WHERE id = :seat)
                """).param("seat", seat).update();

        Instant from = Instant.now().plus(2, ChronoUnit.HOURS).truncatedTo(ChronoUnit.HOURS);
        Instant to = from.plus(1, ChronoUnit.HOURS);

        HttpResponse<String> refused = book(login("user@demo.test"), seat, from, to);
        assertEquals(403, refused.statusCode(), refused.body());
        assertTrue(refused.body().contains("CABIN_RESTRICTED"), refused.body());

        // Enforced on the server, so hiding the button was never the mechanism.
        assertEquals(201, book(login("manager@demo.test"), seat, from, to).statusCode());
    }

    private HttpResponse<String> book(String token, UUID seat, Instant from, Instant to) {
        String body = "{\"seatId\":\"" + seat + "\",\"startsAt\":\"" + from
                + "\",\"endsAt\":\"" + to + "\"}";
        return send(HttpRequest.newBuilder(uri("/api/bookings"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.ofString(body)));
    }

    private String login(String email) {
        HttpResponse<String> response = send(HttpRequest.newBuilder(uri("/api/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(
                        "{\"email\":\"" + email + "\",\"password\":\"password\"}")));
        return MAPPER.readTree(response.body()).path("accessToken").asString();
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private static HttpResponse<String> send(HttpRequest.Builder builder) {
        try {
            return HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
