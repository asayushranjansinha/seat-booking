package com.seatbooking.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * A gate is positioned ON a wall: an edge index into the room outline plus a parameter
 * along that edge. Storing it parametrically means resizing the room carries its gates,
 * for the same reason local transforms carry seats.
 */
@Entity
@Table(name = "gate")
public class Gate {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(name = "wall_edge_idx", nullable = false)
    private int wallEdgeIdx;

    /** Position along the wall edge, 0 to 1. */
    @Column(name = "offset_t", nullable = false)
    private BigDecimal offsetT;

    @Column(nullable = false)
    private BigDecimal width;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private GateType type;

    protected Gate() {}

    public Gate(UUID organizationId, UUID roomId, int wallEdgeIdx, BigDecimal offsetT, BigDecimal width, GateType type) {
        this.organizationId = organizationId;
        this.roomId = roomId;
        this.wallEdgeIdx = wallEdgeIdx;
        this.offsetT = offsetT;
        this.width = width;
        this.type = type;
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

    public int getWallEdgeIdx() {
        return wallEdgeIdx;
    }

    public void setWallEdgeIdx(int wallEdgeIdx) {
        this.wallEdgeIdx = wallEdgeIdx;
    }

    public BigDecimal getOffsetT() {
        return offsetT;
    }

    public void setOffsetT(BigDecimal offsetT) {
        this.offsetT = offsetT;
    }

    public BigDecimal getWidth() {
        return width;
    }

    public void setWidth(BigDecimal width) {
        this.width = width;
    }

    public GateType getType() {
        return type;
    }

    public void setType(GateType type) {
        this.type = type;
    }
}
