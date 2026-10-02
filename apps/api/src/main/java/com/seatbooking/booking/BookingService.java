package com.seatbooking.booking;

import com.seatbooking.auth.CurrentUser;
import com.seatbooking.domain.Booking;
import com.seatbooking.domain.BookingStatus;
import com.seatbooking.repo.AppUserRepository;
import com.seatbooking.repo.BookingRepository;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Booking a seat.
 *
 * <p>The race for a seat is not settled here. Two requests for the same seat and slot
 * both reach the database and the exclusion constraint admits exactly one; this class
 * only has to turn the resulting violation into a 409, which is far less code than a
 * correct locking scheme and cannot be defeated by a second application instance.
 */
@Service
public class BookingService {

    /**
     * How many times to re-attempt an insert that Postgres aborted to break a
     * deadlock. Contention like that is transient by definition, and three attempts
     * clears it comfortably at any load this product will see.
     */
    private static final int MAX_ATTEMPTS = 4;

    private final BookingRepository bookings;
    private final BookingWriter writer;
    private final AppUserRepository users;
    private final OccupancyPublisher occupancy;
    private final BookingProperties properties;
    private final JdbcClient jdbc;

    public BookingService(BookingRepository bookings, BookingWriter writer, AppUserRepository users,
                          OccupancyPublisher occupancy, BookingProperties properties,
                          JdbcClient jdbc) {
        this.bookings = bookings;
        this.writer = writer;
        this.users = users;
        this.occupancy = occupancy;
        this.properties = properties;
        this.jdbc = jdbc;
    }

    /** A seat, with everything needed to price it and check it is bookable. */
    private record BookableSeat(UUID seatId, String code, UUID organizationId, UUID floorId,
                                boolean bookable, BigDecimal rate) {}

    private Optional<BookableSeat> findBookableSeat(UUID seatId) {
        return jdbc.sql("""
                SELECT s.id, s.code, s.organization_id, f.id AS floor_id, s.bookable,
                       COALESCE(s.hourly_rate, r.hourly_rate, 0) AS rate
                FROM seat s
                JOIN room r ON r.id = s.room_id
                JOIN floor_plan_version v ON v.id = s.plan_version_id
                JOIN floor f ON f.id = v.floor_id
                WHERE s.id = :seatId AND v.status = 'PUBLISHED'
                """)
                .param("seatId", seatId)
                .query((rs, n) -> new BookableSeat(
                        rs.getObject(1, UUID.class), rs.getString(2), rs.getObject(3, UUID.class),
                        rs.getObject(4, UUID.class), rs.getBoolean(5), rs.getBigDecimal(6)))
                .optional();
    }


    /**
     * Deliberately NOT transactional: the insert is retried, and a retry needs a fresh
     * transaction rather than more statements in one Postgres has already aborted.
     */
    public BookingDtos.BookingResponse book(CurrentUser caller, BookingDtos.CreateBookingRequest request) {
        Instant now = Instant.now();
        Instant startsAt = request.startsAt();
        Instant endsAt = request.endsAt();

        if (!endsAt.isAfter(startsAt)) {
            throw new BookingException(HttpStatus.BAD_REQUEST, "INVALID_RANGE",
                    "A booking has to end after it starts.");
        }
        if (endsAt.isBefore(now)) {
            throw new BookingException(HttpStatus.BAD_REQUEST, "IN_THE_PAST",
                    "That slot is already in the past.");
        }
        Duration duration = Duration.between(startsAt, endsAt);
        if (duration.compareTo(properties.maxDuration()) > 0) {
            throw new BookingException(HttpStatus.BAD_REQUEST, "TOO_LONG",
                    "A single booking can run for at most " + properties.maxDuration().toHours() + " hours.");
        }
        // The advance window depends on now(), so unlike the duration cap it cannot be a
        // check constraint and has to be enforced here.
        if (startsAt.isAfter(now.plus(properties.maxAdvance()))) {
            throw new BookingException(HttpStatus.BAD_REQUEST, "TOO_FAR_AHEAD",
                    "Seats can be booked up to " + properties.maxAdvance().toDays() + " days ahead.");
        }

        BookableSeat seat = findBookableSeat(request.seatId())
                .orElseThrow(() -> new BookingException(HttpStatus.NOT_FOUND, "NO_SUCH_SEAT",
                        "That seat is not part of the published layout."));
        if (!seat.organizationId().equals(caller.organizationId())) {
            throw new BookingException(HttpStatus.NOT_FOUND, "NO_SUCH_SEAT",
                    "That seat is not part of the published layout.");
        }
        if (!seat.bookable()) {
            throw new BookingException(HttpStatus.CONFLICT, "NOT_BOOKABLE",
                    "Seat " + seat.code() + " is not bookable.");
        }

        Booking booking = new Booking(seat.organizationId(), seat.seatId(), caller.id(),
                startsAt, endsAt, Pricing.forSlot(seat.rate(), startsAt, endsAt));

        for (int attempt = 1; ; attempt++) {
            try {
                writer.insert(booking);
                break;
            } catch (BookingWriter.SeatTakenException e) {
                // Definitive: the constraint refused because something overlaps. Another
                // request won, nothing was written, and retrying cannot change that.
                throw new BookingException(HttpStatus.CONFLICT, "ALREADY_BOOKED",
                        "Seat " + seat.code() + " is already booked for part of that time.");
            } catch (BookingWriter.ContendedException e) {
                // Not definitive: Postgres chose this transaction as the deadlock victim
                // while several were queued on the same constraint check. Whether the seat
                // is free is still unknown, so try again rather than report a conflict
                // that may not exist.
                if (attempt >= MAX_ATTEMPTS) {
                    throw new BookingException(HttpStatus.CONFLICT, "CONTENDED",
                            "Seat " + seat.code() + " is being booked by several people at once. "
                                    + "Please try again.");
                }
                backOff(attempt);
            }
        }

        occupancy.seatChanged(seat.floorId(), seat.seatId());
        return describe(booking, seat.code(), caller.email());
    }

    /** Jittered, so retrying transactions do not line up and deadlock again together. */
    private static void backOff(int attempt) {
        try {
            Thread.sleep(ThreadLocalRandom.current().nextLong(5L * attempt, 25L * attempt));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BookingException(HttpStatus.SERVICE_UNAVAILABLE, "INTERRUPTED",
                    "The request was interrupted.");
        }
    }

    @Transactional
    public BookingDtos.BookingResponse cancel(CurrentUser caller, UUID bookingId) {
        Booking booking = bookings.findById(bookingId)
                .filter(b -> b.getOrganizationId().equals(caller.organizationId()))
                .orElseThrow(() -> new BookingException(HttpStatus.NOT_FOUND, "NO_SUCH_BOOKING",
                        "No such booking."));
        // An admin can cancel anyone's booking; everyone else only their own.
        if (!booking.getUserId().equals(caller.id()) && caller.role() != com.seatbooking.domain.Role.ADMIN) {
            throw new BookingException(HttpStatus.FORBIDDEN, "NOT_YOURS", "That is not your booking.");
        }
        if (booking.getStatus() == BookingStatus.CANCELLED) {
            return describe(booking, seatCode(booking.getSeatId()), caller.email());
        }
        booking.cancel(Instant.now());
        bookings.save(booking);
        occupancy.seatChanged(floorOf(booking.getSeatId()), booking.getSeatId());
        return describe(booking, seatCode(booking.getSeatId()), caller.email());
    }

    @Transactional(readOnly = true)
    public List<BookingDtos.BookingResponse> myBookings(CurrentUser caller) {
        return jdbc.sql("""
                SELECT b.id, b.seat_id, s.code, r.name, b.user_id, u.email,
                       b.starts_at, b.ends_at, b.status, b.cost
                FROM booking b
                JOIN seat s ON s.id = b.seat_id
                JOIN room r ON r.id = s.room_id
                JOIN app_user u ON u.id = b.user_id
                WHERE b.user_id = :userId
                ORDER BY b.starts_at DESC
                """)
                .param("userId", caller.id())
                .query((rs, n) -> new BookingDtos.BookingResponse(
                        rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getString(3),
                        rs.getString(4), rs.getObject(5, UUID.class), rs.getString(6),
                        rs.getTimestamp(7).toInstant(), rs.getTimestamp(8).toInstant(),
                        rs.getString(9), rs.getBigDecimal(10)))
                .list();
    }

    /**
     * How every seat on a floor stands over one window.
     *
     * <p>Answered in a single query rather than per seat: a floor has hundreds of seats
     * and the scrubber re-asks on every drag.
     */
    @Transactional(readOnly = true)
    public BookingDtos.OccupancyResponse occupancy(CurrentUser caller, UUID floorId, Instant from, Instant to) {
        List<BookingDtos.SeatOccupancy> seats = jdbc.sql("""
                SELECT s.id, s.code, s.bookable,
                       COALESCE(s.hourly_rate, r.hourly_rate, 0) AS rate,
                       EXISTS (SELECT 1 FROM booking b
                               WHERE b.seat_id = s.id AND b.status <> 'CANCELLED'
                                 AND b.period && tstzrange(:from, :to, '[)')) AS taken,
                       EXISTS (SELECT 1 FROM booking b
                               WHERE b.seat_id = s.id AND b.status <> 'CANCELLED'
                                 AND b.user_id = :userId
                                 AND b.period && tstzrange(:from, :to, '[)')) AS mine
                FROM seat s
                JOIN room r ON r.id = s.room_id
                JOIN floor_plan_version v ON v.id = s.plan_version_id
                WHERE v.floor_id = :floorId AND v.status = 'PUBLISHED'
                  AND s.organization_id = :orgId
                ORDER BY s.code
                """)
                .param("floorId", floorId)
                .param("orgId", caller.organizationId())
                .param("userId", caller.id())
                .param("from", java.sql.Timestamp.from(from))
                .param("to", java.sql.Timestamp.from(to))
                .query((rs, n) -> {
                    boolean bookable = rs.getBoolean(3);
                    boolean mine = rs.getBoolean(6);
                    boolean taken = rs.getBoolean(5);
                    BookingDtos.SeatOccupancy.Status status =
                            !bookable ? BookingDtos.SeatOccupancy.Status.BLOCKED
                                    : mine ? BookingDtos.SeatOccupancy.Status.MINE
                                            : taken ? BookingDtos.SeatOccupancy.Status.BOOKED
                                                    : BookingDtos.SeatOccupancy.Status.FREE;
                    return new BookingDtos.SeatOccupancy(
                            rs.getObject(1, UUID.class), rs.getString(2), status, rs.getBigDecimal(4));
                })
                .list();
        return new BookingDtos.OccupancyResponse(floorId, from, to, seats);
    }

    private BookingDtos.BookingResponse describe(Booking booking, String seatCode, String email) {
        Map<String, String> names = jdbc.sql("""
                SELECT r.name FROM seat s JOIN room r ON r.id = s.room_id WHERE s.id = :seatId
                """)
                .param("seatId", booking.getSeatId())
                .query((rs, n) -> Map.entry("room", rs.getString(1)))
                .optional()
                .map(e -> Map.of(e.getKey(), e.getValue()))
                .orElse(Map.of());
        return new BookingDtos.BookingResponse(
                booking.getId(), booking.getSeatId(), seatCode, names.get("room"),
                booking.getUserId(), email, booking.getStartsAt(), booking.getEndsAt(),
                booking.getStatus().name(), booking.getCost());
    }

    private String seatCode(UUID seatId) {
        return jdbc.sql("SELECT code FROM seat WHERE id = :id").param("id", seatId)
                .query(String.class).optional().orElse("?");
    }

    private UUID floorOf(UUID seatId) {
        return jdbc.sql("""
                SELECT v.floor_id FROM seat s JOIN floor_plan_version v ON v.id = s.plan_version_id
                WHERE s.id = :id
                """).param("id", seatId).query(UUID.class).optional().orElse(null);
    }
}
