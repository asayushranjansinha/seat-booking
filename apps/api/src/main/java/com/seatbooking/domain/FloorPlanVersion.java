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
 * All geometry hangs off a version, because admins edit layouts that already carry live
 * bookings. Editing clones the published version into a draft; publishing is atomic.
 *
 * <p>{@code revision} is the optimistic concurrency token for the scene save, surfaced to
 * clients as an ETag so two admins cannot silently clobber one another. It is maintained
 * explicitly rather than with {@code @Version} because the scene save bumps it once for a
 * whole graph of child rows, not per entity.
 */
@Entity
@Table(name = "floor_plan_version")
public class FloorPlanVersion {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(name = "floor_id", nullable = false)
    private UUID floorId;

    @Column(name = "version_no", nullable = false)
    private int versionNo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PlanStatus status;

    @Column(nullable = false)
    private long revision;

    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected FloorPlanVersion() {}

    public FloorPlanVersion(UUID organizationId, UUID floorId, int versionNo, PlanStatus status, UUID createdBy) {
        this.organizationId = organizationId;
        this.floorId = floorId;
        this.versionNo = versionNo;
        this.status = status;
        this.createdBy = createdBy;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public UUID getFloorId() {
        return floorId;
    }

    public int getVersionNo() {
        return versionNo;
    }

    public PlanStatus getStatus() {
        return status;
    }

    public void setStatus(PlanStatus status) {
        this.status = status;
    }

    public long getRevision() {
        return revision;
    }

    public void bumpRevision() {
        this.revision++;
        this.updatedAt = Instant.now();
    }

    public Instant getPublishedAt() {
        return publishedAt;
    }

    public void setPublishedAt(Instant publishedAt) {
        this.publishedAt = publishedAt;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
