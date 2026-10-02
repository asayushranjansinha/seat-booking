package com.seatbooking.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * An email that WILL be sent, written inside the transaction that caused it.
 *
 * <p>Sending from the request would couple a booking to an SMTP server: a slow relay
 * makes the booking slow, and a relay that is down either loses the invite or fails the
 * booking that was otherwise fine. Writing a row instead makes the email as durable as
 * the meeting itself, and the worker can retry for as long as it takes.
 */
@Entity
@Table(name = "email_outbox")
public class EmailOutbox {

    public enum Status {
        PENDING,
        SENT,
        FAILED
    }

    /** Give up after this many tries and leave the row for a human to look at. */
    public static final int MAX_ATTEMPTS = 8;

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(nullable = false)
    private String recipient;

    @Column(nullable = false)
    private String subject;

    @Column(nullable = false)
    private String body;

    /** The iCalendar document, attached so the mail is a real calendar invitation. */
    private String ics;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status = Status.PENDING;

    @Column(nullable = false)
    private int attempts;

    @Column(name = "last_error")
    private String lastError;

    @Column(name = "next_attempt_at", nullable = false)
    private Instant nextAttemptAt = Instant.now();

    @Column(name = "sent_at")
    private Instant sentAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected EmailOutbox() {}

    public EmailOutbox(UUID organizationId, String recipient, String subject, String body, String ics) {
        this.organizationId = organizationId;
        this.recipient = recipient;
        this.subject = subject;
        this.body = body;
        this.ics = ics;
    }

    public UUID getId() {
        return id;
    }

    public String getRecipient() {
        return recipient;
    }

    public String getSubject() {
        return subject;
    }

    public String getBody() {
        return body;
    }

    public String getIcs() {
        return ics;
    }

    public Status getStatus() {
        return status;
    }

    public int getAttempts() {
        return attempts;
    }

    public String getLastError() {
        return lastError;
    }

    public Instant getNextAttemptAt() {
        return nextAttemptAt;
    }

    public Instant getSentAt() {
        return sentAt;
    }

    public void markSent(Instant at) {
        this.status = Status.SENT;
        this.sentAt = at;
        this.lastError = null;
    }

    /**
     * Back off exponentially, so a relay that is briefly unreachable is retried quickly
     * and one that is properly broken is not hammered.
     */
    public void markFailed(String error, Instant now) {
        this.attempts++;
        this.lastError = error != null && error.length() > 900 ? error.substring(0, 900) : error;
        if (attempts >= MAX_ATTEMPTS) {
            this.status = Status.FAILED;
        } else {
            this.nextAttemptAt = now.plus(Duration.ofSeconds((long) Math.pow(3, attempts)));
        }
    }
}
