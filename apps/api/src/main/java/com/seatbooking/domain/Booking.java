package com.seatbooking.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * A seat held for one person over one time range.
 *
 * <p>The {@code period} column is a STORED generated column derived by Postgres from
 * {@code startsAt} and {@code endsAt}, and the exclusion constraint that prevents double
 * booking is defined over it. Neither is mapped here: the entity stays plain JPA with no
 * custom Hibernate range type, and nothing in Java can write a period that disagrees with
 * the timestamps it came from.
 */
@Entity
@Table(name = "booking")
public class Booking {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(name = "seat_id", nullable = false)
    private UUID seatId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "meeting_id")
    private UUID meetingId;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "ends_at", nullable = false)
    private Instant endsAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private BookingStatus status = BookingStatus.CONFIRMED;

    @Column(nullable = false)
    private BigDecimal cost = BigDecimal.ZERO;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    protected Booking() {}

    public Booking(UUID organizationId, UUID seatId, UUID userId, Instant startsAt, Instant endsAt,
                   BigDecimal cost) {
        this.organizationId = organizationId;
        this.seatId = seatId;
        this.userId = userId;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
        this.cost = cost;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public UUID getSeatId() {
        return seatId;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getMeetingId() {
        return meetingId;
    }

    public void setMeetingId(UUID meetingId) {
        this.meetingId = meetingId;
    }

    public Instant getStartsAt() {
        return startsAt;
    }

    public Instant getEndsAt() {
        return endsAt;
    }

    public BookingStatus getStatus() {
        return status;
    }

    public BigDecimal getCost() {
        return cost;
    }

    public Instant getCancelledAt() {
        return cancelledAt;
    }

    public void cancel(Instant at) {
        this.status = BookingStatus.CANCELLED;
        this.cancelledAt = at;
    }
}
