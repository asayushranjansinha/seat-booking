package com.seatbooking.geometry;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Seats a table. The Java authority for the same algorithm the browser runs locally for
 * 60fps dragging; both are pinned to packages/geometry-fixtures.
 */
public final class Placement {

    private static final double TAU = 2 * Math.PI;

    /** Edge indices of a tessellated RECT, which is wound CCW from the bottom-left. */
    private static final Map<String, Integer> RECT_EDGE_NAMES =
            Map.of("bottom", 0, "right", 1, "top", 2, "left", 3);

    private Placement() {}

    /** A seat faces the table, so its heading is the inward direction. */
    private static double facing(Vec2 outward) {
        return Math.atan2(-outward.y(), -outward.x());
    }

    /**
     * Largest-remainder allocation of {@code m} seats across gaps, proportional to gap
     * length. Ties break to the lower gap index so both languages allocate identically.
     */
    private static int[] allocate(int m, double[] lengths, double total) {
        int k = lengths.length;
        int[] base = new int[k];
        if (k == 0) {
            return base;
        }
        double[] quotas = new double[k];
        int assigned = 0;
        for (int j = 0; j < k; j++) {
            quotas[j] = m * lengths[j] / total;
            base[j] = (int) Math.floor(quotas[j]);
            assigned += base[j];
        }
        Integer[] order = new Integer[k];
        for (int j = 0; j < k; j++) {
            order[j] = j;
        }
        final int[] baseRef = base;
        Arrays.sort(order, Comparator
                .<Integer>comparingDouble(j -> -(quotas[j] - baseRef[j]))
                .thenComparingInt(j -> j));
        for (int i = 0; i < m - assigned; i++) {
            base[order[i]]++;
        }
        return base;
    }

    public static List<SeatPlacement> placeSeats(PlaceSeatsRequest req) {
        Map<Integer, SeatOverride> overrides = new LinkedHashMap<>();
        for (SeatOverride o : req.overrides()) {
            overrides.put(o.index(), o);
        }

        return switch (req.rule()) {
            case PlacementRule.Manual ignored -> new TreeMap<>(overrides).values().stream()
                    .map(o -> new SeatPlacement(o.index(), o.x(), o.y(), o.rot(), true))
                    .toList();

            case PlacementRule.Radial radial -> {
                double rx;
                double ry;
                if (req.shape() instanceof Shape.Circle c) {
                    rx = c.r();
                    ry = c.r();
                } else if (req.shape() instanceof Shape.Ellipse e) {
                    rx = e.rx();
                    ry = e.ry();
                } else {
                    throw new IllegalArgumentException(
                            "RADIAL placement requires a CIRCLE or ELLIPSE table");
                }
                List<SeatPlacement> out = new ArrayList<>(radial.count());
                for (int i = 0; i < radial.count(); i++) {
                    SeatOverride o = overrides.get(i);
                    if (o != null) {
                        out.add(new SeatPlacement(i, o.x(), o.y(), o.rot(), true));
                        continue;
                    }
                    double t = radial.startAngle() + TAU * i / radial.count();
                    Vec2 p = new Vec2(
                            (rx + req.clearance()) * Math.cos(t),
                            (ry + req.clearance()) * Math.sin(t));
                    out.add(new SeatPlacement(i, p.x(), p.y(), facing(p.normalize()), false));
                }
                yield out;
            }

            case PlacementRule.EdgeCounts edgeCounts -> {
                List<Vec2> ring = Tessellation.tessellate(req.shape(), req.tolerance());
                Map<Integer, Integer> counts = new TreeMap<>();
                for (Map.Entry<String, Integer> e : edgeCounts.counts().entrySet()) {
                    Integer named = RECT_EDGE_NAMES.get(e.getKey());
                    counts.put(named != null ? named : Integer.parseInt(e.getKey()), e.getValue());
                }
                List<SeatPlacement> out = new ArrayList<>();
                int index = 0;
                int n = ring.size();
                for (Map.Entry<Integer, Integer> e : counts.entrySet()) {
                    int edge = e.getKey();
                    int m = e.getValue();
                    Vec2 p = ring.get(edge);
                    Vec2 d = ring.get((edge + 1) % n).sub(p);
                    Vec2 nrm = d.outwardNormal();
                    for (int j = 0; j < m; j++) {
                        SeatOverride o = overrides.get(index);
                        if (o != null) {
                            out.add(new SeatPlacement(index, o.x(), o.y(), o.rot(), true));
                        } else {
                            double t = (j + 0.5) / m;
                            Vec2 c = p.add(d.scale(t)).add(nrm.scale(req.clearance()));
                            out.add(new SeatPlacement(index, c.x(), c.y(), facing(nrm), false));
                        }
                        index++;
                    }
                }
                yield out;
            }

            case PlacementRule.PerimeterEven even -> {
                int count = even.count();
                List<Vec2> off = Offsets.offsetRing(
                        Tessellation.tessellate(req.shape(), req.tolerance()), req.clearance());
                double perimeter = Rings.perimeter(off);

                List<Integer> free = new ArrayList<>();
                for (int i = 0; i < count; i++) {
                    if (!overrides.containsKey(i)) {
                        free.add(i);
                    }
                }

                List<Double> slots = new ArrayList<>();
                if (overrides.isEmpty()) {
                    for (int i : free) {
                        slots.add(perimeter * (i + even.startOffset()) / count);
                    }
                } else {
                    // Project each pinned seat onto the ring, then share the remaining
                    // seats across the gaps between them, proportionally to gap length.
                    List<Double> pins = overrides.values().stream()
                            .map(o -> Rings.projectToArcLength(off, new Vec2(o.x(), o.y())))
                            .sorted()
                            .toList();

                    int k = pins.size();
                    double[] gapStart = new double[k];
                    double[] gapLen = new double[k];
                    for (int j = 0; j < k; j++) {
                        gapStart[j] = pins.get(j);
                        if (k == 1) {
                            gapLen[j] = perimeter;
                        } else {
                            double len = (pins.get((j + 1) % k) - gapStart[j]) % perimeter;
                            gapLen[j] = len < 0 ? len + perimeter : len;
                        }
                    }

                    int[] alloc = allocate(free.size(), gapLen, perimeter);
                    for (int j = 0; j < k; j++) {
                        for (int i = 0; i < alloc[j]; i++) {
                            slots.add((gapStart[j] + gapLen[j] * (i + 1) / (alloc[j] + 1))
                                    % perimeter);
                        }
                    }
                    // Assign in ascending arc length, not gap order, so a seat keeps
                    // roughly the position it already had. Otherwise pinning one seat
                    // makes every other seat's identity jump around the table.
                    slots.sort(Comparator.naturalOrder());
                }

                SeatPlacement[] out = new SeatPlacement[count];
                for (SeatOverride o : overrides.values()) {
                    out[o.index()] = new SeatPlacement(o.index(), o.x(), o.y(), o.rot(), true);
                }
                for (int slotIndex = 0; slotIndex < free.size(); slotIndex++) {
                    int i = free.get(slotIndex);
                    Rings.ArcSample sample = Rings.pointAtArcLength(off, slots.get(slotIndex));
                    out[i] = new SeatPlacement(
                            i,
                            sample.point().x(),
                            sample.point().y(),
                            facing(sample.outwardNormal()),
                            false);
                }
                yield Arrays.asList(out);
            }
        };
    }
}
