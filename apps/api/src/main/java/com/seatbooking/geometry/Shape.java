package com.seatbooking.geometry;

import java.util.List;

/**
 * One discriminated union for rooms, tables and seats alike. Because a single
 * {@link Tessellation#tessellate} call reduces any of them to a polygon ring, rendering,
 * offsetting, hit-testing, overlap validation and 3D extrusion share exactly one code
 * path, and "any shape" stops being a feature with a cost spread across the codebase.
 *
 * <p>PATH (bezier) is deliberately absent in M1. It slots in behind the same seam later
 * without touching anything downstream.
 */
public sealed interface Shape {

    record Rect(double w, double h) implements Shape {}

    record Circle(double r) implements Shape {}

    record Ellipse(double rx, double ry) implements Shape {}

    record Polygon(List<Vec2> points) implements Shape {}
}
