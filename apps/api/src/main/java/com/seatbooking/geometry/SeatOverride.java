package com.seatbooking.geometry;

/**
 * A seat the admin has dragged. Its stored transform wins over the generated one, and
 * regeneration redistributes the remaining seats around it rather than overwriting it.
 */
public record SeatOverride(int index, double x, double y, double rot) {}
