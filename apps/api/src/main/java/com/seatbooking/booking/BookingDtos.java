package com.seatbooking.booking;

import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public final class BookingDtos {

    private BookingDtos() {}

    public record CreateBookingRequest(
            @NotNull UUID seatId,
            @NotNull Instant startsAt,
            @NotNull Instant endsAt) {}

    public record BookingResponse(
            UUID id,
            UUID seatId,
            String seatCode,
            String roomName,
            UUID userId,
            String userEmail,
            Instant startsAt,
            Instant endsAt,
            String status,
            BigDecimal cost) {}

    /**
     * What one seat looks like over the window being viewed.
     *
     * <p>Colour is derived from the window, never stored on the seat: a seat is only
     * "red" relative to a moment, which is why the booking UI needs a time scrubber
     * rather than a single live view.
     */
    public record SeatOccupancy(UUID seatId, String seatCode, Status status, BigDecimal hourlyRate) {

        public enum Status {
            /** Bookable and nothing overlaps the window. */
            FREE,
            /** Someone else holds it. */
            BOOKED,
            /** The caller holds it. */
            MINE,
            /** Not bookable at all, so never offered. */
            BLOCKED
        }
    }

    public record OccupancyResponse(
            UUID floorId, Instant from, Instant to, java.util.List<SeatOccupancy> seats) {}
}
