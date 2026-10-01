package com.seatbooking.geometry;

/**
 * A seat position in TABLE-LOCAL space. {@code rot} is the seat's facing: the angle of
 * the vector pointing from the seat toward the table.
 */
public record SeatPlacement(int index, double x, double y, double rot, boolean override) {}
