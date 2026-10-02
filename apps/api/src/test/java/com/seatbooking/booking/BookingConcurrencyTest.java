package com.seatbooking.booking;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.ObjectMapper;

/**
 * The real proof that the exclusion constraint holds.
 *
 * <p>Deliberately over HTTP and deliberately parallel. Calling the service sequentially
 * shows only that the SQL is syntactically right; it is the simultaneous case that a
 * "check then insert" implementation passes in testing and fails in production. Every
 * request here reaches the database, and exactly one is allowed to win.
 *
 * <p>Not {@code @Transactional}: a test transaction would serialise the very contention
 * being tested, and nothing would ever race.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BookingConcurrencyTest {

    private static final int ATTEMPTS = 16;

    @LocalServerPort private int port;
    @Autowired private JdbcClient jdbc;

    // The JDK client rather than a Spring test client: Boot 4 replaced TestRestTemplate,
    // and a concurrency test only needs something that genuinely issues parallel requests.
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private String token;
    private UUID seatId;

    @BeforeEach
    void signIn() {
        token = login("user@demo.test");
        seatId = jdbc.sql("""
                SELECT s.id FROM seat s
                JOIN floor_plan_version v ON v.id = s.plan_version_id
                WHERE v.status = 'PUBLISHED' AND s.bookable AND s.code = 'C3'
                """).query(UUID.class).single();
        clearBookings();
    }

    @AfterEach
    void cleanUp() {
        clearBookings();
    }

    private void clearBookings() {
        jdbc.sql("DELETE FROM booking WHERE seat_id = :id").param("id", seatId).update();
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

    /** POST a booking and return the response. */
    private HttpResponse<String> postBooking(UUID seat, Instant from, Instant to) {
        String body = "{\"seatId\":\"" + seat + "\",\"startsAt\":\"" + from
                + "\",\"endsAt\":\"" + to + "\"}";
        return send(HttpRequest.newBuilder(uri("/api/bookings"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.ofString(body)));
    }

    @Test
    @DisplayName("16 simultaneous bookings for one seat and slot: exactly one 201, the rest 409")
    void concurrentBookingsAdmitExactlyOne() throws Exception {
        Instant start = Instant.now().plus(2, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS);
        Instant end = start.plus(3, ChronoUnit.HOURS);
        // Every thread waits on the barrier so the requests go out together rather than
        // trickling; without this they serialise and nothing contends.
        CyclicBarrier gate = new CyclicBarrier(ATTEMPTS);
        AtomicInteger created = new AtomicInteger();
        AtomicInteger conflict = new AtomicInteger();
        AtomicInteger other = new AtomicInteger();
        java.util.List<String> unexpected = java.util.Collections.synchronizedList(new java.util.ArrayList<>());

        try (ExecutorService pool = Executors.newFixedThreadPool(ATTEMPTS)) {
            List<Callable<Integer>> calls = java.util.stream.IntStream.range(0, ATTEMPTS)
                    .<Callable<Integer>>mapToObj(i -> () -> {
                        gate.await(10, TimeUnit.SECONDS);
                        java.net.http.HttpResponse<String> response = postBooking(seatId, start, end);
                        int status = response.statusCode();
                        if (status == 201) created.incrementAndGet();
                        else if (status == 409) conflict.incrementAndGet();
                        else {
                            other.incrementAndGet();
                            unexpected.add(status + " " + response.body());
                        }
                        return status;
                    })
                    .toList();
            for (Future<Integer> f : pool.invokeAll(calls, 30, TimeUnit.SECONDS)) {
                f.get();
            }
        }

        assertEquals(0, other.get(), "no attempt may fail in any other way: " + unexpected);
        assertEquals(1, created.get(), "exactly one booking may be created");
        assertEquals(ATTEMPTS - 1, conflict.get(), "every other attempt must be refused with 409");

        int rows = jdbc.sql("""
                SELECT count(*) FROM booking WHERE seat_id = :id AND status <> 'CANCELLED'
                """).param("id", seatId).query(Integer.class).single();
        assertEquals(1, rows, "the database must hold exactly one live booking for that seat");
    }

    @Test
    @DisplayName("concurrent bookings for ADJACENT slots all succeed")
    void adjacentSlotsDoNotConflict() throws Exception {
        // The half-open [) range means 10:00-11:00 and 11:00-12:00 do not overlap. If the
        // constraint were inclusive, honest back-to-back bookings would be rejected.
        Instant base = Instant.now().plus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS);
        CyclicBarrier gate = new CyclicBarrier(4);
        AtomicInteger created = new AtomicInteger();

        try (ExecutorService pool = Executors.newFixedThreadPool(4)) {
            List<Callable<Void>> calls = java.util.stream.IntStream.range(0, 4)
                    .<Callable<Void>>mapToObj(i -> () -> {
                        Instant start = base.plus(i, ChronoUnit.HOURS);
                        gate.await(10, TimeUnit.SECONDS);
                        if (postBooking(seatId, start, start.plus(1, ChronoUnit.HOURS)).statusCode() == 201) {
                            created.incrementAndGet();
                        }
                        return null;
                    })
                    .toList();
            for (Future<Void> f : pool.invokeAll(calls, 30, TimeUnit.SECONDS)) {
                f.get();
            }
        }

        assertEquals(4, created.get(), "back-to-back bookings must all be allowed");
    }

    @Test
    @DisplayName("a cancelled booking frees its slot for someone else")
    void cancellingFreesTheSlot() {
        Instant start = Instant.now().plus(4, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS);
        Instant end = start.plus(2, ChronoUnit.HOURS);

        HttpResponse<String> first = postBooking(seatId, start, end);
        assertEquals(201, first.statusCode());
        assertEquals(409, postBooking(seatId, start, end).statusCode());

        String id = MAPPER.readTree(first.body()).path("id").asString();
        send(HttpRequest.newBuilder(uri("/api/bookings/" + id))
                .header("Authorization", "Bearer " + token).DELETE());

        assertEquals(201, postBooking(seatId, start, end).statusCode(),
                "the slot must be free once cancelled");
    }

    @Test
    @DisplayName("the time rules are enforced: too long, too far ahead, in the past")
    void timeRules() {
        Instant soon = Instant.now().plus(1, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS);

        assertTrue(post(soon, soon.plus(7, ChronoUnit.HOURS)).contains("TOO_LONG"),
                "7 hours exceeds the 6 hour cap");
        assertTrue(post(Instant.now().plus(8, ChronoUnit.DAYS), Instant.now().plus(8, ChronoUnit.DAYS).plus(1, ChronoUnit.HOURS))
                        .contains("TOO_FAR_AHEAD"),
                "8 days exceeds the 6 day window");
        assertTrue(post(Instant.now().minus(3, ChronoUnit.HOURS), Instant.now().minus(2, ChronoUnit.HOURS))
                        .contains("IN_THE_PAST"),
                "a slot that has already finished cannot be booked");
    }

    private String post(Instant from, Instant to) {
        return postBooking(seatId, from, to).body();
    }
}
