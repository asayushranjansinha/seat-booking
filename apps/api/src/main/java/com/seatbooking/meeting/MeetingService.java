package com.seatbooking.meeting;

import com.seatbooking.auth.CurrentUser;
import com.seatbooking.booking.BookingException;
import com.seatbooking.booking.BookingProperties;
import com.seatbooking.booking.OccupancyPublisher;
import com.seatbooking.booking.Pricing;
import com.seatbooking.domain.Booking;
import com.seatbooking.domain.EmailOutbox;
import com.seatbooking.domain.InviteStatus;
import com.seatbooking.domain.Meeting;
import com.seatbooking.domain.MeetingInvite;
import com.seatbooking.domain.Role;
import com.seatbooking.repo.BookingRepository;
import com.seatbooking.repo.EmailOutboxRepository;
import com.seatbooking.repo.MeetingInviteRepository;
import com.seatbooking.repo.MeetingRepository;
import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

/**
 * A manager taking a whole table and inviting people to it.
 *
 * <p>Everything here happens in ONE transaction: the meeting, a booking for every seat on
 * the table, the invites, and the outbox rows. If any seat is already taken the exclusion
 * constraint rejects that insert and the whole meeting rolls back, so a half-booked table
 * is not a state the system can be in. The emails roll back with it, which is the point of
 * writing them to a table instead of sending them inline.
 */
@Service
public class MeetingService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final DateTimeFormatter WHEN =
            DateTimeFormatter.ofPattern("EEEE d MMMM, HH:mm", Locale.ENGLISH);

    private final MeetingRepository meetings;
    private final MeetingInviteRepository invites;
    private final BookingRepository bookings;
    private final EmailOutboxRepository outbox;
    private final OccupancyPublisher occupancy;
    private final TemplateEngine templates;
    private final MailProperties mail;
    private final BookingProperties bookingRules;
    private final JdbcClient jdbc;

    public MeetingService(MeetingRepository meetings, MeetingInviteRepository invites,
                          BookingRepository bookings, EmailOutboxRepository outbox,
                          OccupancyPublisher occupancy, TemplateEngine templates,
                          MailProperties mail, BookingProperties bookingRules, JdbcClient jdbc) {
        this.meetings = meetings;
        this.invites = invites;
        this.bookings = bookings;
        this.outbox = outbox;
        this.occupancy = occupancy;
        this.templates = templates;
        this.mail = mail;
        this.bookingRules = bookingRules;
        this.jdbc = jdbc;
    }

    private record TableSeat(UUID seatId, String code, BigDecimal rate) {}

    private record TableInfo(UUID tableId, String label, String roomName, UUID floorId, UUID organizationId) {}

    @Transactional
    public MeetingDtos.MeetingResponse create(CurrentUser caller, MeetingDtos.CreateMeetingRequest request) {
        if (caller.role() != Role.MANAGER && caller.role() != Role.ADMIN) {
            throw new BookingException(HttpStatus.FORBIDDEN, "NOT_A_MANAGER",
                    "Only a manager can book a whole table.");
        }

        Instant now = Instant.now();
        Instant startsAt = request.startsAt();
        Instant endsAt = request.endsAt();
        if (!endsAt.isAfter(startsAt)) {
            throw new BookingException(HttpStatus.BAD_REQUEST, "INVALID_RANGE",
                    "A meeting has to end after it starts.");
        }
        if (endsAt.isBefore(now)) {
            throw new BookingException(HttpStatus.BAD_REQUEST, "IN_THE_PAST",
                    "That slot is already in the past.");
        }
        if (Duration.between(startsAt, endsAt).compareTo(bookingRules.maxDuration()) > 0) {
            throw new BookingException(HttpStatus.BAD_REQUEST, "TOO_LONG",
                    "A meeting can run for at most " + bookingRules.maxDuration().toHours() + " hours.");
        }
        if (startsAt.isAfter(now.plus(bookingRules.maxAdvance()))) {
            throw new BookingException(HttpStatus.BAD_REQUEST, "TOO_FAR_AHEAD",
                    "Tables can be booked up to " + bookingRules.maxAdvance().toDays() + " days ahead.");
        }

        TableInfo table = findTable(request.tableId(), caller.organizationId())
                .orElseThrow(() -> new BookingException(HttpStatus.NOT_FOUND, "NO_SUCH_TABLE",
                        "That table is not part of the published layout."));
        List<TableSeat> seats = seatsOf(request.tableId());
        if (seats.isEmpty()) {
            throw new BookingException(HttpStatus.CONFLICT, "NO_BOOKABLE_SEATS",
                    "That table has no bookable seats.");
        }

        Meeting meeting = new Meeting(table.organizationId(), caller.id(), table.tableId(),
                request.title(), request.agenda(), startsAt, endsAt);
        meetings.save(meeting);

        BigDecimal total = BigDecimal.ZERO;
        for (TableSeat seat : seats) {
            BigDecimal cost = Pricing.forSlot(seat.rate(), startsAt, endsAt);
            Booking booking = new Booking(table.organizationId(), seat.seatId(), caller.id(),
                    startsAt, endsAt, cost);
            booking.setMeetingId(meeting.getId());
            try {
                bookings.saveAndFlush(booking);
            } catch (CannotAcquireLockException e) {
                // Postgres broke a deadlock between transactions queued on the same
                // exclusion constraint check. The table may well be free; this attempt
                // simply lost. Saying so beats a 500 that tells the manager nothing.
                throw new BookingException(HttpStatus.CONFLICT, "CONTENDED",
                        "That table is being booked by several people at once. Please try again.");
            } catch (DataIntegrityViolationException e) {
                // One taken seat means the table is not available. Rolling the whole
                // transaction back is the only honest answer: a meeting with a gap in it
                // is not the thing the manager asked for.
                throw new BookingException(HttpStatus.CONFLICT, "TABLE_NOT_AVAILABLE",
                        "Seat " + seat.code() + " is already booked for part of that time, "
                                + "so the table cannot be held.");
            }
            total = total.add(cost);
        }

        List<String> emails = request.inviteEmails() == null ? List.of()
                : request.inviteEmails().stream().filter(e -> e != null && !e.isBlank()).distinct().toList();

        String ics = InviteCalendar.build(meeting.getId(), request.title(), request.agenda(),
                startsAt, endsAt, table.roomName() + " · " + table.label(),
                caller.email(), emails);

        List<MeetingDtos.InviteResponse> inviteResponses = new ArrayList<>();
        for (String email : emails) {
            MeetingInvite invite = new MeetingInvite(meeting.getId(), email, userIdFor(email), newToken());
            invites.save(invite);
            outbox.save(new EmailOutbox(
                    table.organizationId(), email,
                    "Invitation: " + request.title(),
                    renderInvite(request, table, caller.email(), seats, invite),
                    ics));
            inviteResponses.add(new MeetingDtos.InviteResponse(invite.getId(), email, invite.getStatus().name()));
        }

        seats.forEach(s -> occupancy.seatChanged(table.floorId(), s.seatId()));

        return new MeetingDtos.MeetingResponse(
                meeting.getId(), table.tableId(), table.label(), table.roomName(),
                request.title(), request.agenda(), startsAt, endsAt, caller.email(),
                seats.size(), seats.stream().map(TableSeat::code).toList(), total, inviteResponses);
    }

    private String renderInvite(MeetingDtos.CreateMeetingRequest request, TableInfo table,
                                String organiser, List<TableSeat> seats, MeetingInvite invite) {
        Context context = new Context(Locale.ENGLISH);
        context.setVariable("title", request.title());
        context.setVariable("agenda", request.agenda());
        context.setVariable("whenText",
                WHEN.format(request.startsAt().atZone(ZoneId.systemDefault()))
                        + " – " + DateTimeFormatter.ofPattern("HH:mm")
                        .format(request.endsAt().atZone(ZoneId.systemDefault())));
        context.setVariable("whereText", table.roomName() + " · " + table.label());
        context.setVariable("organiser", organiser);
        context.setVariable("seatsText",
                seats.size() + " (" + String.join(", ", seats.stream().map(TableSeat::code).toList()) + ")");
        context.setVariable("acceptUrl", mail.publicBaseUrl() + "/invite/" + invite.getToken() + "?reply=accept");
        context.setVariable("declineUrl", mail.publicBaseUrl() + "/invite/" + invite.getToken() + "?reply=decline");
        return templates.process("meeting-invite", context);
    }

    @Transactional(readOnly = true)
    public MeetingDtos.InviteViewResponse viewInvite(String token) {
        return jdbc.sql("""
                SELECT m.title, m.agenda, m.starts_at, m.ends_at, r.name, f.label,
                       o.email, i.email, i.status
                FROM meeting_invite i
                JOIN meeting m ON m.id = i.meeting_id
                JOIN furniture f ON f.id = m.table_id
                JOIN room r ON r.id = f.room_id
                JOIN app_user o ON o.id = m.organizer_id
                WHERE i.token = :token
                """)
                .param("token", token)
                .query((rs, n) -> new MeetingDtos.InviteViewResponse(
                        rs.getString(1), rs.getString(2),
                        rs.getTimestamp(3).toInstant(), rs.getTimestamp(4).toInstant(),
                        rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9)))
                .optional()
                .orElseThrow(() -> new BookingException(HttpStatus.NOT_FOUND, "NO_SUCH_INVITE",
                        "That invitation link is not valid."));
    }

    /** Answer an invitation using only the token, which is how someone without an account replies. */
    @Transactional
    public MeetingDtos.InviteViewResponse respond(String token, boolean accept) {
        MeetingInvite invite = invites.findByToken(token)
                .orElseThrow(() -> new BookingException(HttpStatus.NOT_FOUND, "NO_SUCH_INVITE",
                        "That invitation link is not valid."));
        invite.respond(accept ? InviteStatus.ACCEPTED : InviteStatus.DECLINED);
        // saveAndFlush, not save: viewInvite reads back through plain SQL, which does not
        // see a JPA change still sitting unflushed in the persistence context. Without the
        // flush the invitee accepts and is told they are still PENDING.
        invites.saveAndFlush(invite);
        return viewInvite(token);
    }

    @Transactional(readOnly = true)
    public List<MeetingDtos.MeetingResponse> myMeetings(CurrentUser caller) {
        return meetings.findByOrganizerIdOrderByStartsAtDesc(caller.id()).stream()
                .map(m -> {
                    TableInfo table = findTable(m.getTableId(), caller.organizationId()).orElse(null);
                    List<TableSeat> seats = seatsOf(m.getTableId());
                    BigDecimal total = jdbc.sql("""
                            SELECT COALESCE(SUM(cost), 0) FROM booking
                            WHERE meeting_id = :id AND status <> 'CANCELLED'
                            """).param("id", m.getId()).query(BigDecimal.class).single();
                    return new MeetingDtos.MeetingResponse(
                            m.getId(), m.getTableId(),
                            table == null ? null : table.label(),
                            table == null ? null : table.roomName(),
                            m.getTitle(), m.getAgenda(), m.getStartsAt(), m.getEndsAt(), caller.email(),
                            seats.size(), seats.stream().map(TableSeat::code).toList(), total,
                            invites.findByMeetingId(m.getId()).stream()
                                    .map(i -> new MeetingDtos.InviteResponse(i.getId(), i.getEmail(), i.getStatus().name()))
                                    .toList());
                })
                .toList();
    }

    // ------------------------------------------------------------------------ lookups

    private java.util.Optional<TableInfo> findTable(UUID tableId, UUID organizationId) {
        return jdbc.sql("""
                SELECT f.id, f.label, r.name, v.floor_id, f.organization_id
                FROM furniture f
                JOIN room r ON r.id = f.room_id
                JOIN floor_plan_version v ON v.id = f.plan_version_id
                WHERE f.id = :tableId AND v.status = 'PUBLISHED'
                  AND f.organization_id = :orgId AND f.kind = 'TABLE'
                """)
                .param("tableId", tableId)
                .param("orgId", organizationId)
                .query((rs, n) -> new TableInfo(rs.getObject(1, UUID.class), rs.getString(2),
                        rs.getString(3), rs.getObject(4, UUID.class), rs.getObject(5, UUID.class)))
                .optional();
    }

    private List<TableSeat> seatsOf(UUID tableId) {
        return jdbc.sql("""
                SELECT s.id, s.code, COALESCE(s.hourly_rate, r.hourly_rate, 0)
                FROM seat s
                JOIN room r ON r.id = s.room_id
                JOIN floor_plan_version v ON v.id = s.plan_version_id
                WHERE s.table_id = :tableId AND s.bookable AND v.status = 'PUBLISHED'
                ORDER BY s.code
                """)
                .param("tableId", tableId)
                .query((rs, n) -> new TableSeat(rs.getObject(1, UUID.class), rs.getString(2), rs.getBigDecimal(3)))
                .list();
    }

    private UUID userIdFor(String email) {
        return jdbc.sql("SELECT id FROM app_user WHERE lower(email) = lower(:email)")
                .param("email", email).query(UUID.class).optional().orElse(null);
    }

    private static String newToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
