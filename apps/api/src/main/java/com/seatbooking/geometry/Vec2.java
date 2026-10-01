package com.seatbooking.geometry;

/** A point or vector. All lengths are metres, all angles radians. */
public record Vec2(double x, double y) {

    public static final Vec2 ZERO = new Vec2(0, 0);

    public Vec2 add(Vec2 o) {
        return new Vec2(x + o.x, y + o.y);
    }

    public Vec2 sub(Vec2 o) {
        return new Vec2(x - o.x, y - o.y);
    }

    public Vec2 scale(double k) {
        return new Vec2(x * k, y * k);
    }

    public double dot(Vec2 o) {
        return x * o.x + y * o.y;
    }

    public double length() {
        return Math.sqrt(x * x + y * y);
    }

    public Vec2 normalize() {
        double l = length();
        return l == 0 ? ZERO : new Vec2(x / l, y / l);
    }

    /**
     * Outward normal of a directed edge on a CCW ring. The interior lies to the left of
     * the edge direction, so the outward side is to the right: (dy, -dx).
     */
    public Vec2 outwardNormal() {
        Vec2 u = normalize();
        return new Vec2(u.y, -u.x);
    }
}
