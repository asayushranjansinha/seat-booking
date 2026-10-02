package com.seatbooking.meeting;

import java.io.StringWriter;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import net.fortuna.ical4j.data.CalendarOutputter;
import net.fortuna.ical4j.model.Calendar;
import net.fortuna.ical4j.model.component.VEvent;
import net.fortuna.ical4j.model.property.Attendee;
import net.fortuna.ical4j.model.property.Description;
import net.fortuna.ical4j.model.property.Location;
import net.fortuna.ical4j.model.property.Organizer;
import net.fortuna.ical4j.model.property.ProdId;
import net.fortuna.ical4j.model.property.Uid;
import net.fortuna.ical4j.model.property.immutable.ImmutableCalScale;
import net.fortuna.ical4j.model.property.immutable.ImmutableMethod;
import net.fortuna.ical4j.model.property.immutable.ImmutableVersion;

/**
 * A real iCalendar invitation, not a text file that looks like one.
 *
 * <p>Built with ical4j rather than string concatenation because the format has rules a
 * calendar client enforces: line folding at 75 octets, escaping in TEXT values, UTC
 * timestamps, a stable UID so an update replaces the event instead of creating a second
 * one, and METHOD:REQUEST so the mail arrives as an invitation with accept/decline rather
 * than as an attachment nobody can act on.
 */
public final class InviteCalendar {

    private InviteCalendar() {}

    public static String build(
            UUID meetingId,
            String title,
            String agenda,
            Instant startsAt,
            Instant endsAt,
            String location,
            String organizerEmail,
            List<String> attendeeEmails) {

        // The Instants are passed straight through, NOT converted to a LocalDateTime.
        // A LocalDateTime emits DTSTART with neither a Z nor a TZID, which iCalendar calls
        // a "floating" time: every client reads it in ITS OWN timezone, so an invitee a
        // few hours away is told the wrong hour and nothing anywhere reports an error.
        VEvent event = new VEvent(startsAt, endsAt, title);

        // A stable UID derived from the meeting id, so a later update to the same meeting
        // replaces this event in the invitee's calendar rather than adding another.
        event.add(new Uid(meetingId.toString() + "@seatbooking"));
        if (agenda != null && !agenda.isBlank()) {
            event.add(new Description(agenda));
        }
        if (location != null && !location.isBlank()) {
            event.add(new Location(location));
        }
        event.add(new Organizer("mailto:" + organizerEmail));
        for (String email : attendeeEmails) {
            event.add(new Attendee("mailto:" + email));
        }

        Calendar calendar = new Calendar();
        calendar.add(new ProdId("-//Seat Booking//EN"));
        calendar.add(ImmutableVersion.VERSION_2_0);
        calendar.add(ImmutableCalScale.GREGORIAN);
        // REQUEST is what makes a client show Accept and Decline.
        calendar.add(ImmutableMethod.REQUEST);
        calendar.add(event);

        return serialise(calendar);
    }

    /**
     * Serialise through {@link CalendarOutputter}, never {@code Calendar.toString()}.
     *
     * <p>toString() gives a readable dump with no line folding, so a long SUMMARY comes
     * out as a single content line well past the 75 octet limit. Lenient clients cope;
     * strict ones reject the whole calendar, and the failure looks like "the invite just
     * didn't work" rather than anything diagnosable.
     */
    private static String serialise(Calendar calendar) {
        StringWriter writer = new StringWriter();
        try {
            // Validation off: the outputter's own validator is stricter than the clients
            // we care about, and the structure here is fixed by this class anyway.
            new CalendarOutputter(false).output(calendar, writer);
        } catch (java.io.IOException e) {
            throw new UncheckedIOException(e);
        }
        return writer.toString();
    }
}
