package com.seatbooking.geometry;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Reduces any {@link Shape} to a polygon ring. */
public final class Tessellation {

    private static final double TAU = 2 * Math.PI;

    private Tessellation() {}

    /**
     * Number of segments approximating a full circle of the given radius within
     * {@code tolerance} metres of sagitta error.
     *
     * <p>This value feeds an INTEGER decision, so it must be identical here and in the
     * TypeScript engine. {@code sin}, {@code cos} and {@code acos} are not correctly
     * rounded by IEEE-754 and may differ in the last ulp between the JVM and a JS engine,
     * which is enough to flip a {@code ceil} and silently desynchronise the two. Only
     * {@code + - * /} and {@code sqrt} are guaranteed correctly rounded, so the count is
     * derived from the small-angle sagitta approximation
     * {@code e = r(1 - cos(PI/n)) ~= r*PI^2/(2n^2)} solved for n, which needs nothing but
     * a square root.
     */
    public static int segmentCountForArc(double radius, double tolerance) {
        double raw = Math.ceil(Math.PI * Math.sqrt(radius / (2.0 * tolerance)));
        // Clamp before narrowing; also catches NaN and infinity.
        if (!(raw < 512.0)) {
            return 512;
        }
        int n = (int) raw;
        n = 4 * ((n + 3) / 4); // multiple of 4 keeps quadrant symmetry
        if (n < 12) {
            n = 12;
        }
        return n;
    }

    /** Signed area. Positive for a CCW ring. */
    public static double ringSignedArea(List<Vec2> ring) {
        double s = 0;
        int n = ring.size();
        for (int i = 0; i < n; i++) {
            Vec2 p = ring.get(i);
            Vec2 q = ring.get((i + 1) % n);
            s += p.x() * q.y() - q.x() * p.y();
        }
        return 0.5 * s;
    }

    public static List<Vec2> tessellate(Shape shape, double tolerance) {
        return switch (shape) {
            case Shape.Rect r -> {
                double w = r.w() / 2;
                double h = r.h() / 2;
                // CCW from the bottom-left corner, which is what makes the edge indices
                // stable and nameable: 0=bottom 1=right 2=top 3=left.
                yield List.of(
                        new Vec2(-w, -h), new Vec2(w, -h), new Vec2(w, h), new Vec2(-w, h));
            }
            case Shape.Circle c -> {
                int n = segmentCountForArc(c.r(), tolerance);
                List<Vec2> out = new ArrayList<>(n);
                for (int i = 0; i < n; i++) {
                    double t = TAU * i / n;
                    out.add(new Vec2(c.r() * Math.cos(t), c.r() * Math.sin(t)));
                }
                yield out;
            }
            case Shape.Ellipse e -> {
                int n = segmentCountForArc(Math.max(e.rx(), e.ry()), tolerance);
                List<Vec2> out = new ArrayList<>(n);
                for (int i = 0; i < n; i++) {
                    double t = TAU * i / n;
                    out.add(new Vec2(e.rx() * Math.cos(t), e.ry() * Math.sin(t)));
                }
                yield out;
            }
            case Shape.Polygon p -> {
                List<Vec2> pts = new ArrayList<>(p.points());
                if (ringSignedArea(pts) < 0) {
                    Collections.reverse(pts);
                }
                yield pts;
            }
        };
    }
}
