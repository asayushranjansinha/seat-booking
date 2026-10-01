package com.seatbooking.geometry;

import java.util.ArrayList;
import java.util.List;

/** Outward polygon offsetting. */
public final class Offsets {

    public static final double MITER_LIMIT = 4;

    private Offsets() {}

    /**
     * Offset a CCW ring outward by {@code distance}, mitering corners and falling back to
     * a bevel past {@link #MITER_LIMIT}.
     *
     * <p>Deliberately hand-rolled rather than delegated to JTS {@code buffer()}, even
     * though JTS is used elsewhere in this package's callers for predicates. This
     * function sits directly beneath seat placement, where the Java and TypeScript
     * engines must agree vertex-for-vertex, and JTS and clipper2-js give no such
     * guarantee. Predicate work (contains, intersects, Polygonizer) still goes to JTS,
     * where tolerance-level agreement is all that is needed.
     */
    public static List<Vec2> offsetRing(List<Vec2> ring, double distance) {
        int n = ring.size();
        List<Vec2> out = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            Vec2 prev = ring.get((i - 1 + n) % n);
            Vec2 cur = ring.get(i);
            Vec2 next = ring.get((i + 1) % n);

            Vec2 n0 = cur.sub(prev).outwardNormal();
            Vec2 n1 = next.sub(cur).outwardNormal();
            Vec2 m = n0.add(n1);
            double mLen = m.length();

            // A 180 degree turn has no miter point; emit both offset corners.
            if (mLen < 1e-12) {
                out.add(cur.add(n0.scale(distance)));
                out.add(cur.add(n1.scale(distance)));
                continue;
            }

            Vec2 mUnit = m.scale(1 / mLen);
            double cosHalf = mUnit.dot(n0);
            if (cosHalf <= 1 / MITER_LIMIT) {
                out.add(cur.add(n0.scale(distance)));
                out.add(cur.add(n1.scale(distance)));
            } else {
                out.add(cur.add(mUnit.scale(distance / cosHalf)));
            }
        }
        return out;
    }
}
