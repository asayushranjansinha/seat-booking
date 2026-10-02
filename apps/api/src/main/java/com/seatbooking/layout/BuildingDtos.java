package com.seatbooking.layout;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class BuildingDtos {

    private BuildingDtos() {}

    public record CreateBuildingRequest(@NotBlank @Size(max = 120) String name, String address) {}

    public record UpdateBuildingRequest(@NotBlank @Size(max = 120) String name, String address) {}

    /**
     * @param level which storey this is; ground is 0 and basements are negative, so the
     *              natural ordering of the number is the natural ordering of the building
     */
    public record CreateFloorRequest(@NotBlank @Size(max = 120) String name, int level) {}

    public record UpdateFloorRequest(@NotBlank @Size(max = 120) String name, int level) {}

    /** What stands in the way of deleting something, so the answer is actionable. */
    public record BlockedByBookings(
            List<LayoutService.AffectedBooking> bookings,
            String message) {}

    public record FloorSummary(
            UUID id,
            String name,
            int level,
            UUID publishedVersionId,
            UUID draftVersionId,
            int rooms,
            int seats,
            int liveBookings,
            Instant publishedAt) {}

    public record BuildingSummary(
            UUID id,
            String name,
            String address,
            List<FloorSummary> floors) {}
}
