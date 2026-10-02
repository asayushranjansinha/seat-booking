package com.seatbooking.meeting;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.StringReader;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import net.fortuna.ical4j.data.CalendarBuilder;
import net.fortuna.ical4j.model.Calendar;
import net.fortuna.ical4j.model.component.VEvent;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The invitation has to be a real iCalendar document, not a text file that resembles one.
 * These parse it back with ical4j's own reader, which is the closest cheap stand-in for
 * what a calendar client will do with it.
 */
class InviteCalendarTest {

    private static final UUID MEETING = UUID.fromString("7f1c2a44-1111-2222-3333-444455556666");
    private static final Instant START = Instant.parse("2026-11-03T09:30:00Z");
    private static final Instant END = Instant.parse("2026-11-03T11:00:00Z");

    private static String build(String title, String agenda, List<String> attendees) {
        return InviteCalendar.build(MEETING, title, agenda, START, END,
                "Open Studio · Bench A", "morgan@demo.test", attendees);
    }

    private static Calendar parse(String ics) throws Exception {
        return new CalendarBuilder().build(new StringReader(ics));
    }

    private static VEvent firstEvent(Calendar calendar) {
        return (VEvent) calendar.getComponents("VEVENT").get(0);
    }

    @Test
    @DisplayName("produces a calendar a client can parse, with one event at the right time")
    void parsesBack() throws Exception {
        Calendar calendar = parse(build("Quarterly planning", "Budget and headcount",
                List.of("ana@demo.test", "bo@demo.test")));

        assertEquals(1, calendar.getComponents("VEVENT").size());
        VEvent event = firstEvent(calendar);

        assertEquals("Quarterly planning", event.getProperty("SUMMARY").orElseThrow().getValue());
        assertEquals("Budget and headcount", event.getProperty("DESCRIPTION").orElseThrow().getValue());
        assertEquals("Open Studio · Bench A", event.getProperty("LOCATION").orElseThrow().getValue());
        // The Z matters: without it iCalendar treats the time as "floating" and every
        // client reads it in its own timezone, quietly showing the wrong hour abroad.
        assertEquals("20261103T093000Z", event.getProperty("DTSTART").orElseThrow().getValue());
        assertEquals("20261103T110000Z", event.getProperty("DTEND").orElseThrow().getValue());
    }

    @Test
    @DisplayName("METHOD:REQUEST, so a mail client offers Accept and Decline")
    void isAnInvitationNotAnAttachment() throws Exception {
        String ics = build("Standup", null, List.of("ana@demo.test"));
        assertEquals("REQUEST", parse(ics).getProperty("METHOD").orElseThrow().getValue());
        assertTrue(ics.contains("VERSION:2.0"));
    }

    @Test
    @DisplayName("the UID is stable for a meeting, so an update replaces the event")
    void uidIsStable() throws Exception {
        String first = build("Standup", null, List.of("ana@demo.test"));
        String second = build("Standup moved", "now with an agenda", List.of("ana@demo.test"));

        String uidA = firstEvent(parse(first)).getProperty("UID").orElseThrow().getValue();
        String uidB = firstEvent(parse(second)).getProperty("UID").orElseThrow().getValue();
        assertEquals(uidA, uidB, "a changed meeting must update the event, not create a second one");
        assertTrue(uidA.contains(MEETING.toString()));
    }

    @Test
    @DisplayName("every invitee is an attendee, and the organiser is set")
    void attendees() throws Exception {
        VEvent event = firstEvent(parse(build("Review", null, List.of("ana@demo.test", "bo@demo.test"))));

        List<String> attendees = event.getProperties("ATTENDEE").stream()
                .map(p -> p.getValue()).toList();
        assertEquals(List.of("mailto:ana@demo.test", "mailto:bo@demo.test"), attendees);
        assertEquals("mailto:morgan@demo.test", event.getProperty("ORGANIZER").orElseThrow().getValue());
    }

    @Test
    @DisplayName("text that would break the format is escaped and folded, not emitted raw")
    void escapesAndFolds() throws Exception {
        String nasty = "Budget, headcount; and \"scope\"\nsecond line";
        String ics = build("Quarterly planning with an extremely long title that must be folded "
                + "across lines because iCalendar limits a content line to 75 octets", nasty, List.of());

        // A raw newline inside a value would terminate the property early.
        VEvent event = firstEvent(parse(ics));
        assertEquals(nasty, event.getProperty("DESCRIPTION").orElseThrow().getValue(),
                "the description must survive a round trip intact");

        for (String line : ics.split("\r\n")) {
            assertTrue(line.getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 75,
                    "every content line must be folded to 75 octets: " + line);
        }
        assertFalse(ics.contains("\n\n"));
    }
}
