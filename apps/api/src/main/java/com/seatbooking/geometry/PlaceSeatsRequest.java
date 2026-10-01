package com.seatbooking.geometry;

import java.util.List;

/**
 * @param shape the table outline
 * @param clearance distance from the table outline to the seat centre, in metres
 * @param rule how the seats are distributed
 * @param overrides seats the admin has dragged, which stay where they were put
 * @param tolerance tessellation tolerance in metres
 */
public record PlaceSeatsRequest(
        Shape shape,
        double clearance,
        PlacementRule rule,
        List<SeatOverride> overrides,
        double tolerance) {

    public static final double DEFAULT_TOLERANCE = 1e-3;

    public PlaceSeatsRequest {
        overrides = overrides == null ? List.of() : List.copyOf(overrides);
        if (tolerance <= 0) {
            tolerance = DEFAULT_TOLERANCE;
        }
    }

    public PlaceSeatsRequest(Shape shape, double clearance, PlacementRule rule) {
        this(shape, clearance, rule, List.of(), DEFAULT_TOLERANCE);
    }
}
