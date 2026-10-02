package com.seatbooking.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Shape and transform are stored as raw JSON strings rather than mapped objects.
 * Hibernate's JSON format mapper and the Jackson version Boot 4 ships are a moving target,
 * and the geometry layer already owns the only correct parse of these documents, so the
 * persistence layer stays out of it and the service boundary does the conversion.
 */
@Entity
@Table(name = "room")
public class Room {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(name = "plan_version_id", nullable = false)
    private UUID planVersionId;

    @Column(nullable = false)
    private String name;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String shape;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String transform;

    @Column(nullable = false)
    private BigDecimal height = new BigDecimal("2.700");

    @Column(name = "hourly_rate")
    private BigDecimal hourlyRate;

    /**
     * What this room is FOR, which decides who may book a seat in it.
     *
     * <p>A property of the space rather than of each seat: a cabin whose seats disagreed
     * about who is allowed in would be a state nobody wants to debug.
     */
    @Column(nullable = false)
    private String kind = "ROOM";

    protected Room() {}

    public Room(UUID organizationId, UUID planVersionId, String name, String shape, String transform) {
        this.organizationId = organizationId;
        this.planVersionId = planVersionId;
        this.name = name;
        this.shape = shape;
        this.transform = transform;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public UUID getPlanVersionId() {
        return planVersionId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getShape() {
        return shape;
    }

    public void setShape(String shape) {
        this.shape = shape;
    }

    public String getTransform() {
        return transform;
    }

    public void setTransform(String transform) {
        this.transform = transform;
    }

    public BigDecimal getHeight() {
        return height;
    }

    public void setHeight(BigDecimal height) {
        this.height = height;
    }

    public BigDecimal getHourlyRate() {
        return hourlyRate;
    }

    public String getKind() {
        return kind;
    }

    public void setKind(String kind) {
        this.kind = kind;
    }

    public void setHourlyRate(BigDecimal hourlyRate) {
        this.hourlyRate = hourlyRate;
    }
}
