package com.seatbooking.layout;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * The whole layout graph in one document.
 *
 * <p>A canvas editor is inherently transactional: per-entity CRUD produces chatty traffic
 * and half-valid intermediate states, where a table has moved but its seats have not.
 * One debounced save of the entire scene avoids both.
 *
 * <p>Shapes and transforms travel as raw JSON because the geometry engine, not the
 * transport layer, owns their only correct interpretation.
 */
public record SceneDto(
        UUID planVersionId,
        UUID floorId,
        String status,
        long revision,
        @Valid List<RoomDto> rooms,
        @Valid List<FurnitureDto> furniture,
        @Valid List<SeatDto> seats) {

    public record RoomDto(
            UUID id,
            @NotBlank String name,
            @NotNull JsonNode shape,
            @NotNull JsonNode transform,
            BigDecimal height,
            BigDecimal hourlyRate,
            @Valid List<PartitionDto> partitions,
            @Valid List<GateDto> gates) {}

    public record PartitionDto(UUID id, @NotNull JsonNode polyline, BigDecimal thickness) {}

    public record GateDto(
            UUID id,
            int wallEdgeIdx,
            @NotNull BigDecimal offsetT,
            @NotNull BigDecimal width,
            @NotBlank String type) {}

    public record FurnitureDto(
            UUID id,
            @NotNull UUID roomId,
            @NotBlank String kind,
            String label,
            @NotNull JsonNode shape,
            @NotNull JsonNode transform,
            BigDecimal height) {}

    public record SeatDto(
            UUID id,
            @NotNull UUID roomId,
            UUID tableId,
            @NotBlank String code,
            @NotNull JsonNode shape,
            @NotNull JsonNode localTransform,
            JsonNode placement,
            int seatIndex,
            boolean override,
            boolean bookable,
            BigDecimal hourlyRate) {}
}
