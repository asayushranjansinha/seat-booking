package com.seatbooking.meeting;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * A manager takes a whole table, invites two people, and the invitations actually leave
 * the building: through the outbox worker, over SMTP, into Mailpit, with a real .ics
 * attached. Nothing here is stubbed, because the parts that usually break are the ones a
 * stub removes.
 *
 * <p>Not {@code @Transactional}: the outbox worker runs on a scheduler in another thread
 * and can only see rows that have actually committed. That is the whole point of the
 * pattern, and a test transaction would hide it.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MeetingFlowTest {

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String MAILPIT = "http://localhost:8025";

    @LocalServerPort private int port;
    @Autowired private JdbcClient jdbc;

    private String managerToken;
    private UUID tableId;

    @BeforeEach
    void setUp() {
        managerToken = login("manager@demo.test");
        tableId = jdbc.sql("""
                SELECT f.id FROM furniture f
                JOIN floor_plan_version v ON v.id = f.plan_version_id
                WHERE v.status = 'PUBLISHED' AND f.kind = 'TABLE' AND f.label = 'Round Table'
                """).query(UUID.class).single();
        // Clear everything touching THIS table. Asserting against global counts makes
        // a test depend on an empty database, which it never is once anyone has used
        // the app: a seat booked by hand in the browser was enough to turn it red.
        clearTable();
        deleteMailpitMessages();
    }

    @Test
    @DisplayName("a manager books the whole table, every seat is held, and invites are queued")
    void bookWholeTable() {
        Instant start = Instant.now().plus(2, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS);
        HttpResponse<String> response = createMeeting(start, start.plus(2, ChronoUnit.HOURS),
                "[\"ana@demo.test\",\"bo@demo.test\"]");
        // Assert the status first: reading seatCount off an error body silently yields 0,
        // and the failure then says "expected 6 but was 0" instead of what went wrong.
        assertEquals(201, response.statusCode(), "meeting was refused: " + response.body());
        JsonNode meeting = MAPPER.readTree(response.body());

        assertEquals(6, meeting.path("seatCount").asInt(), "the round table has 6 seats");
        assertEquals(2, meeting.path("invites").size());
        // 6 seats at 4.50/hour for 2 hours.
        assertEquals(54.0, meeting.path("totalCost").asDouble(), 0.001);

        int held = jdbc.sql("""
                SELECT count(*) FROM booking WHERE meeting_id = :id AND status <> 'CANCELLED'
                """).param("id", UUID.fromString(meeting.path("id").asString()))
                .query(Integer.class).single();
        assertEquals(6, held, "every seat on the table must be held by the meeting");
    }

    @Test
    @DisplayName("one taken seat rolls the whole meeting back, rather than half-booking the table")
    void aTakenSeatRollsEverythingBack() {
        Instant start = Instant.now().plus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS);
        Instant end = start.plus(2, ChronoUnit.HOURS);

        // Someone already has one seat on that table.
        UUID seat = jdbc.sql("SELECT id FROM seat WHERE table_id = :t ORDER BY code LIMIT 1")
                .param("t", tableId).query(UUID.class).single();
        String userToken = login("user@demo.test");
        HttpResponse<String> booked = send(HttpRequest.newBuilder(uri("/api/bookings"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + userToken)
                .POST(HttpRequest.BodyPublishers.ofString(
                        "{\"seatId\":\"" + seat + "\",\"startsAt\":\"" + start + "\",\"endsAt\":\"" + end + "\"}")));
        assertEquals(201, booked.statusCode());

        HttpResponse<String> response = createMeeting(start, end, "[\"ana@demo.test\"]");
        assertEquals(409, response.statusCode());
        assertTrue(response.body().contains("TABLE_NOT_AVAILABLE"));

        assertEquals(0, count("SELECT count(*) FROM meeting WHERE table_id = '" + tableId + "'"),
                "no meeting may survive the rollback");
        assertEquals(0, count("SELECT count(*) FROM email_outbox"),
                "the queued emails must roll back with the meeting that caused them");
        assertEquals(1, bookingsOnTable(), "only the original booking remains on this table");

        clearTable();
    }

    @Test
    @DisplayName("the outbox worker actually delivers, with a real .ics attached")
    void invitesAreDelivered() throws Exception {
        Instant start = Instant.now().plus(4, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS);
        createMeeting(start, start.plus(1, ChronoUnit.HOURS), "[\"ana@demo.test\"]");

        // The worker runs every 2 seconds on its own thread, so wait for the effect.
        JsonNode message = awaitMailpitMessage("ana@demo.test", Duration.ofSeconds(20));
        assertNotNull(message, "the invitation never reached the SMTP server");

        String id = message.path("ID").asString();
        String raw = send(HttpRequest.newBuilder(URI.create(MAILPIT + "/api/v1/message/" + id)).GET()).body();
        JsonNode full = MAPPER.readTree(raw);

        assertTrue(full.path("Subject").asString().contains("Invitation:"));
        assertTrue(full.path("HTML").asString().contains("Accept"), "the mail offers a reply");

        boolean hasCalendar = false;
        for (JsonNode attachment : full.path("Attachments")) {
            if (attachment.path("FileName").asString().endsWith(".ics")) {
                hasCalendar = true;
            }
        }
        assertTrue(hasCalendar, "the invitation must carry a calendar attachment");

        assertEquals(0, count("SELECT count(*) FROM email_outbox WHERE status = 'PENDING'"),
                "nothing should still be queued once delivered");
        assertEquals(1, count("SELECT count(*) FROM email_outbox WHERE status = 'SENT'"));
    }

    @Test
    @DisplayName("an invitee answers with the token alone, holding no account")
    void respondWithTokenOnly() {
        Instant start = Instant.now().plus(5, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS);
        createMeeting(start, start.plus(1, ChronoUnit.HOURS), "[\"stranger@example.com\"]");

        String token = jdbc.sql("SELECT token FROM meeting_invite WHERE email = 'stranger@example.com'")
                .query(String.class).single();

        // No Authorization header anywhere in this flow.
        JsonNode view = MAPPER.readTree(send(HttpRequest.newBuilder(uri("/api/invites/" + token)).GET()).body());
        assertEquals("PENDING", view.path("status").asString());
        assertEquals("stranger@example.com", view.path("yourEmail").asString());

        HttpResponse<String> replied = send(HttpRequest.newBuilder(
                uri("/api/invites/" + token + "/respond?reply=accept"))
                .POST(HttpRequest.BodyPublishers.noBody()));
        assertEquals(200, replied.statusCode());
        assertEquals("ACCEPTED", MAPPER.readTree(replied.body()).path("status").asString());

        assertEquals(404, send(HttpRequest.newBuilder(uri("/api/invites/not-a-real-token")).GET()).statusCode(),
                "an unknown token must not reveal anything");
    }

    @Test
    @DisplayName("only a manager or admin may take a whole table")
    void onlyManagersBookTables() {
        Instant start = Instant.now().plus(2, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS);
        String userToken = login("user@demo.test");
        HttpResponse<String> response = send(HttpRequest.newBuilder(uri("/api/meetings"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + userToken)
                .POST(HttpRequest.BodyPublishers.ofString(body(start, start.plus(1, ChronoUnit.HOURS), "[]"))));
        assertEquals(403, response.statusCode());
        assertTrue(response.body().contains("NOT_A_MANAGER"));
    }

    // ----------------------------------------------------------------------- helpers

    private String body(Instant start, Instant end, String emailsJson) {
        return "{\"tableId\":\"" + tableId + "\",\"title\":\"Quarterly planning\","
                + "\"agenda\":\"Budget and headcount\",\"startsAt\":\"" + start
                + "\",\"endsAt\":\"" + end + "\",\"inviteEmails\":" + emailsJson + "}";
    }

    private HttpResponse<String> createMeeting(Instant start, Instant end, String emailsJson) {
        return send(HttpRequest.newBuilder(uri("/api/meetings"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + managerToken)
                .POST(HttpRequest.BodyPublishers.ofString(body(start, end, emailsJson))));
    }

    private JsonNode awaitMailpitMessage(String recipient, Duration timeout) throws Exception {
        Instant deadline = Instant.now().plus(timeout);
        while (Instant.now().isBefore(deadline)) {
            HttpResponse<String> response =
                    send(HttpRequest.newBuilder(URI.create(MAILPIT + "/api/v1/messages")).GET());
            for (JsonNode message : MAPPER.readTree(response.body()).path("messages")) {
                for (JsonNode to : message.path("To")) {
                    if (recipient.equalsIgnoreCase(to.path("Address").asString())) {
                        return message;
                    }
                }
            }
            Thread.sleep(500);
        }
        return null;
    }

    private void deleteMailpitMessages() {
        try {
            send(HttpRequest.newBuilder(URI.create(MAILPIT + "/api/v1/messages")).DELETE());
        } catch (Exception e) {
            // Mailpit not running is a problem for one test, not for the whole class.
        }
    }

    private void clearTable() {
        jdbc.sql("DELETE FROM booking WHERE seat_id IN (SELECT id FROM seat WHERE table_id = :t)").param("t", tableId).update();
        jdbc.sql("DELETE FROM meeting_invite WHERE meeting_id IN (SELECT id FROM meeting WHERE table_id = :t)").param("t", tableId).update();
        jdbc.sql("DELETE FROM meeting WHERE table_id = :t").param("t", tableId).update();
        jdbc.sql("DELETE FROM email_outbox").update();
    }

    private int count(String sql) {
        return jdbc.sql(sql).query(Integer.class).single();
    }

    /** Bookings on this table only, so other data cannot skew the count. */
    private int bookingsOnTable() {
        return jdbc.sql("SELECT count(*) FROM booking WHERE status <> 'CANCELLED' AND seat_id IN (SELECT id FROM seat WHERE table_id = :t)")
                .param("t", tableId).query(Integer.class).single();
    }

    private String login(String email) {
        return MAPPER.readTree(send(HttpRequest.newBuilder(uri("/api/auth/login"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(
                                "{\"email\":\"" + email + "\",\"password\":\"password\"}")))
                        .body())
                .path("accessToken").asString();
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
