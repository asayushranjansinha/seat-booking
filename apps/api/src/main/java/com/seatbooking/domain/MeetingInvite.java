package com.seatbooking.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * One person asked to a meeting.
 *
 * <p>The token is how an invitee answers without having an account: it is the only thing
 * standing between a stranger and someone else's RSVP, so it is high-entropy and unique,
 * and it identifies the invite rather than carrying any claim about who is holding it.
 */
@Entity
@Table(name = "meeting_invite")
public class MeetingInvite {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "meeting_id", nullable = false)
    private UUID meetingId;

    @Column(nullable = false)
    private String email;

    @Column(name = "user_id")
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private InviteStatus status = InviteStatus.PENDING;

    @Column(nullable = false)
    private String token;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected MeetingInvite() {}

    public MeetingInvite(UUID meetingId, String email, UUID userId, String token) {
        this.meetingId = meetingId;
        this.email = email;
        this.userId = userId;
        this.token = token;
    }

    public UUID getId() {
        return id;
    }

    public UUID getMeetingId() {
        return meetingId;
    }

    public String getEmail() {
        return email;
    }

    public UUID getUserId() {
        return userId;
    }

    public InviteStatus getStatus() {
        return status;
    }

    public void respond(InviteStatus status) {
        this.status = status;
    }

    public String getToken() {
        return token;
    }
}
