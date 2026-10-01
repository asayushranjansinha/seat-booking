package com.seatbooking.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "floor")
public class Floor {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(name = "building_id", nullable = false)
    private UUID buildingId;

    @Column(nullable = false)
    private String name;

    @Column(name = "level", nullable = false)
    private int level;

    protected Floor() {}

    public Floor(UUID organizationId, UUID buildingId, String name, int level) {
        this.organizationId = organizationId;
        this.buildingId = buildingId;
        this.name = name;
        this.level = level;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public UUID getBuildingId() {
        return buildingId;
    }

    public String getName() {
        return name;
    }

    public int getLevel() {
        return level;
    }
}
