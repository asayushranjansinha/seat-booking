package com.seatbooking.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** A manager holding a whole table for a slot, with people invited to it. */
@Entity
@Table(name = "meeting")
public class Meeting {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(name = "organizer_id", nullable = false)
    private UUID organizerId;

    @Column(name = "table_id", nullable = false)
    private UUID tableId;

    @Column(nullable = false)
    private String title;

    private String agenda;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "ends_at", nullable = false)
    private Instant endsAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected Meeting() {}

    public Meeting(UUID organizationId, UUID organizerId, UUID tableId, String title, String agenda,
                   Instant startsAt, Instant endsAt) {
        this.organizationId = organizationId;
        this.organizerId = organizerId;
        this.tableId = tableId;
        this.title = title;
        this.agenda = agenda;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public UUID getOrganizerId() {
        return organizerId;
    }

    public UUID getTableId() {
        return tableId;
    }

    public String getTitle() {
        return title;
    }

    public String getAgenda() {
        return agenda;
    }

    public Instant getStartsAt() {
        return startsAt;
    }

    public Instant getEndsAt() {
        return endsAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
