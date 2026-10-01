package com.seatbooking.geometry;

import java.util.List;

/** Measures and queries over a CCW polygon ring. */
public final class Rings {

    private Rings() {}

    /** A sample taken at some arc length around a ring. */
    public record ArcSample(Vec2 point, Vec2 tangent, Vec2 outwardNormal) {}

    public static double perimeter(List<Vec2> ring) {
        double p = 0;
        int n = ring.size();
        for (int i = 0; i < n; i++) {
            p += ring.get((i + 1) % n).sub(ring.get(i)).length();
        }
        return p;
    }

    public static Vec2 centroid(List<Vec2> ring) {
        double a = Tessellation.ringSignedArea(ring);
        int n = ring.size();
        if (Math.abs(a) < 1e-12) {
            double sx = 0;
            double sy = 0;
            for (Vec2 p : ring) {
                sx += p.x();
                sy += p.y();
            }
            return new Vec2(sx / n, sy / n);
        }
        double cx = 0;
        double cy = 0;
        for (int i = 0; i < n; i++) {
            Vec2 p = ring.get(i);
            Vec2 q = ring.get((i + 1) % n);
            double cross = p.x() * q.y() - q.x() * p.y();
            cx += (p.x() + q.x()) * cross;
            cy += (p.y() + q.y()) * cross;
        }
        return new Vec2(cx / (6 * a), cy / (6 * a));
    }

    /** Ray casting. Behaviour exactly on the boundary is unspecified and not fixtured. */
    public static boolean pointInRing(List<Vec2> ring, Vec2 pt) {
        boolean inside = false;
        int n = ring.size();
        for (int i = 0; i < n; i++) {
            Vec2 a = ring.get(i);
            Vec2 b = ring.get((i + 1) % n);
            if ((a.y() > pt.y()) != (b.y() > pt.y())) {
                double xCross = (b.x() - a.x()) * (pt.y() - a.y()) / (b.y() - a.y()) + a.x();
                if (pt.x() < xCross) {
                    inside = !inside;
                }
            }
        }
        return inside;
    }

    /** Walk to arc length {@code s}, wrapping modulo the perimeter, negative s included. */
    public static ArcSample pointAtArcLength(List<Vec2> ring, double s) {
        int n = ring.size();
        double perimeter = perimeter(ring);
        double target = s % perimeter;
        if (target < 0) {
            target += perimeter;
        }
        double acc = 0;
        for (int i = 0; i < n; i++) {
            Vec2 p = ring.get(i);
            Vec2 d = ring.get((i + 1) % n).sub(p);
            double l = d.length();
            if (acc + l >= target || i == n - 1) {
                double t = l == 0 ? 0 : (target - acc) / l;
                Vec2 u = d.normalize();
                return new ArcSample(p.add(d.scale(t)), u, new Vec2(u.y(), -u.x()));
            }
            acc += l;
        }
        throw new IllegalStateException("arc length walk fell off the ring");
    }

    /** Arc length of the closest point on the ring. Ties break to the lower edge index. */
    public static double projectToArcLength(List<Vec2> ring, Vec2 pt) {
        int n = ring.size();
        double bestD2 = Double.POSITIVE_INFINITY;
        double bestS = 0;
        double acc = 0;
        for (int i = 0; i < n; i++) {
            Vec2 p = ring.get(i);
            Vec2 d = ring.get((i + 1) % n).sub(p);
            double l = d.length();
            if (l == 0) {
                continue;
            }
            double t = pt.sub(p).dot(d) / (l * l);
            t = Math.max(0, Math.min(1, t));
            Vec2 diff = pt.sub(p.add(d.scale(t)));
            double d2 = diff.dot(diff);
            if (d2 < bestD2) {
                bestD2 = d2;
                bestS = acc + t * l;
            }
            acc += l;
        }
        return bestS;
    }
}
