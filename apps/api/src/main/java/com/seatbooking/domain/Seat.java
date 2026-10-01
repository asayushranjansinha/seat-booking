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
 * A seat stores {@code localTransform} relative to its PARENT: the table when it has one,
 * otherwise the room. This is the decision the whole product rests on, because rotating a
 * table then changes one transform and every seat follows without a single seat row being
 * rewritten.
 *
 * <p>{@code worldX / worldY / worldRot} are a denormalised cache written at publish time
 * so read paths never recompute the transform chain. They are never the source of truth,
 * and anything that treats them as such will drift the moment a parent moves.
 */
@Entity
@Table(name = "seat")
public class Seat {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(name = "plan_version_id", nullable = false)
    private UUID planVersionId;

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(name = "table_id")
    private UUID tableId;

    @Column(nullable = false)
    private String code;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String shape;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "local_transform", nullable = false)
    private String localTransform;

    /** The rule that generated this seat, so regeneration can reproduce it. */
    @JdbcTypeCode(SqlTypes.JSON)
    private String placement;

    @Column(name = "seat_index", nullable = false)
    private int seatIndex;

    /** Set when the admin has dragged this seat. Regeneration skips it. */
    @Column(name = "is_override", nullable = false)
    private boolean override;

    @Column(nullable = false)
    private boolean bookable = true;

    @Column(name = "hourly_rate")
    private BigDecimal hourlyRate;

    @Column(name = "world_x")
    private Double worldX;

    @Column(name = "world_y")
    private Double worldY;

    @Column(name = "world_rot")
    private Double worldRot;

    protected Seat() {}

    public Seat(UUID organizationId, UUID planVersionId, UUID roomId, UUID tableId,
                String code, String shape, String localTransform, int seatIndex) {
        this.organizationId = organizationId;
        this.planVersionId = planVersionId;
        this.roomId = roomId;
        this.tableId = tableId;
        this.code = code;
        this.shape = shape;
        this.localTransform = localTransform;
        this.seatIndex = seatIndex;
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

    public UUID getTableId() {
        return tableId;
    }

    public void setTableId(UUID tableId) {
        this.tableId = tableId;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getShape() {
        return shape;
    }

    public void setShape(String shape) {
        this.shape = shape;
    }

    public String getLocalTransform() {
        return localTransform;
    }

    public void setLocalTransform(String localTransform) {
        this.localTransform = localTransform;
    }

    public String getPlacement() {
        return placement;
    }

    public void setPlacement(String placement) {
        this.placement = placement;
    }

    public int getSeatIndex() {
        return seatIndex;
    }

    public void setSeatIndex(int seatIndex) {
        this.seatIndex = seatIndex;
    }

    public boolean isOverride() {
        return override;
    }

    public void setOverride(boolean override) {
        this.override = override;
    }

    public boolean isBookable() {
        return bookable;
    }

    public void setBookable(boolean bookable) {
        this.bookable = bookable;
    }

    public BigDecimal getHourlyRate() {
        return hourlyRate;
    }

    public void setHourlyRate(BigDecimal hourlyRate) {
        this.hourlyRate = hourlyRate;
    }

    public Double getWorldX() {
        return worldX;
    }

    public Double getWorldY() {
        return worldY;
    }

    public Double getWorldRot() {
        return worldRot;
    }

    /** Written at publish time only. */
    public void setWorld(double x, double y, double rot) {
        this.worldX = x;
        this.worldY = y;
        this.worldRot = rot;
    }
}
