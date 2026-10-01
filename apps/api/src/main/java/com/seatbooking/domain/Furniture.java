package com.seatbooking.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Tables are furniture with kind = TABLE. Seats hang off them. */
@Entity
@Table(name = "furniture")
public class Furniture {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(name = "plan_version_id", nullable = false)
    private UUID planVersionId;

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private FurnitureKind kind;

    private String label;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String shape;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String transform;

    @Column(nullable = false)
    private BigDecimal height = new BigDecimal("0.750");

    protected Furniture() {}

    public Furniture(UUID organizationId, UUID planVersionId, UUID roomId, FurnitureKind kind,
                     String label, String shape, String transform) {
        this.organizationId = organizationId;
        this.planVersionId = planVersionId;
        this.roomId = roomId;
        this.kind = kind;
        this.label = label;
        this.shape = shape;
        this.transform = transform;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public UUID getPlanVersionId() {
        return planVersionId;
    }

    public UUID getRoomId() {
        return roomId;
    }

    public void setRoomId(UUID roomId) {
        this.roomId = roomId;
    }

    public FurnitureKind getKind() {
        return kind;
    }

    public void setKind(FurnitureKind kind) {
        this.kind = kind;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
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
}
