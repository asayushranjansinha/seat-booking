package com.seatbooking.geometry;

import java.util.List;

/**
 * A transform local to the parent element, never an absolute world position.
 *
 * <p>This is the decision the whole system rests on. A seat stores its position in
 * table-local space, so rotating a table changes one transform and every seat follows for
 * free. No seat record is rewritten, so nothing can drift out of alignment.
 */
public record Transform(double x, double y, double rot) {

    public static final Transform IDENTITY = new Transform(0, 0, 0);

    public Transform compose(Transform child) {
        double c = Math.cos(rot);
        double s = Math.sin(rot);
        return new Transform(
                x + c * child.x - s * child.y,
                y + s * child.x + c * child.y,
                rot + child.rot);
    }

    public Vec2 apply(Vec2 p) {
        double c = Math.cos(rot);
        double s = Math.sin(rot);
        return new Vec2(x + c * p.x() - s * p.y(), y + s * p.x() + c * p.y());
    }

    public Transform invert() {
        double c = Math.cos(-rot);
        double s = Math.sin(-rot);
        return new Transform(-(c * x - s * y), -(s * x + c * y), -rot);
    }

    /** Compose a chain root-first: floor to room to table to seat. */
    public static Transform chain(List<Transform> chain) {
        Transform acc = IDENTITY;
        for (Transform t : chain) {
            acc = acc.compose(t);
        }
        return acc;
    }
}
