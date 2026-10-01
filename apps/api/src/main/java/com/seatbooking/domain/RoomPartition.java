package com.seatbooking.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** A wall drawn inside a room. JTS Polygonizer derives named sub-zones from these. */
@Entity
@Table(name = "room_partition")
public class RoomPartition {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String polyline;

    @Column(nullable = false)
    private BigDecimal thickness = new BigDecimal("0.100");

    protected RoomPartition() {}

    public RoomPartition(UUID organizationId, UUID roomId, String polyline, BigDecimal thickness) {
        this.organizationId = organizationId;
        this.roomId = roomId;
        this.polyline = polyline;
        this.thickness = thickness;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public UUID getRoomId() {
        return roomId;
    }

    public String getPolyline() {
        return polyline;
    }

    public void setPolyline(String polyline) {
        this.polyline = polyline;
    }

    public BigDecimal getThickness() {
        return thickness;
    }

    public void setThickness(BigDecimal thickness) {
        this.thickness = thickness;
    }
}
