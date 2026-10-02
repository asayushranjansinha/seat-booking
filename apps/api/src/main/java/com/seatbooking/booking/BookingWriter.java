package com.seatbooking.booking;

import com.seatbooking.domain.Booking;
import com.seatbooking.repo.BookingRepository;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The one transactional write, kept in its own bean so it can be RETRIED.
 *
 * <p>A retry has to start a new transaction, and a transaction only begins when a call
 * crosses the proxy. Retrying inside {@link BookingService} would just re-run statements
 * in a transaction Postgres has already aborted.
 */
@Component
public class BookingWriter {

    /** Postgres SQLSTATE for an exclusion constraint violation. */
    private static final String EXCLUSION_VIOLATION = "23P01";

    private final BookingRepository bookings;
    private final JdbcClient jdbc;

    public BookingWriter(BookingRepository bookings, JdbcClient jdbc) {
        this.bookings = bookings;
        this.jdbc = jdbc;
    }

    /** Thrown when the seat is definitively taken: another booking overlaps. */
    public static class SeatTakenException extends RuntimeException {}

    /**
     * Thrown when Postgres aborted this transaction to break a deadlock.
     *
     * <p>Not the same as the seat being taken. Several transactions inserting for the
     * same seat and slot each wait on the others inside the exclusion constraint check,
     * and with more than two the wait graph can form a cycle. Postgres picks a victim,
     * and the victim has learned nothing about whether the seat is free.
     */
    public static class ContendedException extends RuntimeException {}

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Booking insert(Booking booking) {
        lockSeat(booking.getSeatId());
        try {
            return bookings.saveAndFlush(booking);
        } catch (CannotAcquireLockException e) {
            throw new ContendedException();
        } catch (DataIntegrityViolationException e) {
            if (isExclusionViolation(e)) {
                throw new SeatTakenException();
            }
            throw e;
        }
    }

    /**
     * Queue contenders for one seat behind a per-seat advisory lock.
     *
     * <p>This is NOT where correctness comes from; the exclusion constraint still decides,
     * and removing this lock changes no outcome. It exists because of how Postgres makes
     * contenders wait: a second insert for an overlapping period blocks inside the
     * constraint check until the first transaction resolves, and with several queued at
     * once the wait graph can form a cycle. Postgres then breaks it with a deadlock, which
     * costs a full deadlock_timeout (1s by default) and surfaces as an error that says
     * nothing about whether the seat was free.
     *
     * <p>Taking the lock first turns that scramble into an orderly queue: one transaction
     * attempts the insert at a time, each either wins or gets a clean, immediate
     * constraint violation. The lock is transaction-scoped, so it is released on commit or
     * rollback with no unlock to forget, and it is keyed per seat, so bookings for
     * different seats never wait on each other.
     */
    private void lockSeat(UUID seatId) {
        // pg_advisory_xact_lock returns void, so the call is wrapped to yield a real
        // value the driver can map.
        jdbc.sql("SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(:seat, 0))) AS taken")
                .param("seat", seatId.toString())
                .query(Integer.class)
                .single();
    }

    private static boolean isExclusionViolation(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof java.sql.SQLException sql && EXCLUSION_VIOLATION.equals(sql.getSQLState())) {
                return true;
            }
            if (t.getMessage() != null && t.getMessage().contains("booking_no_overlap")) {
                return true;
            }
        }
        return false;
    }
}
