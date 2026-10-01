package com.seatbooking.geometry;

import java.util.Map;

/** How seats are distributed around a table outline. */
public sealed interface PlacementRule {

    /**
     * {@code count} seats spread evenly by arc length around the offset outline.
     * Resizing the table changes the perimeter, so the seats redistribute in proportion:
     * this is the rule that delivers the product requirement.
     */
    record PerimeterEven(int count, double startOffset) implements PlacementRule {
        public PerimeterEven(int count) {
            this(count, 0);
        }
    }

    /**
     * Per-side counts such as {@code {top:3, bottom:3, left:1, right:1}}. Keys are either
     * an edge name (RECT only) or a numeric edge index. Operates on the original edges
     * rather than the offset ring, so indices stay stable even where a miter bevels.
     */
    record EdgeCounts(Map<String, Integer> counts) implements PlacementRule {}

    /** Round tables: seats at even angles rather than even arc length. */
    record Radial(int count, double startAngle) implements PlacementRule {
        public Radial(int count) {
            this(count, 0);
        }
    }

    /** Every seat is positioned by hand. */
    record Manual() implements PlacementRule {}
}
