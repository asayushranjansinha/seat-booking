package com.seatbooking.layout;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.seatbooking.geometry.Shape;
import com.seatbooking.geometry.Transform;
import com.seatbooking.geometry.Vec2;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The areas a room is divided into by the partitions drawn across it. */
class SubZonesTest {

    private static final Shape ROOM = new Shape.Rect(12, 8); // x in [-6,6], y in [-4,4]

    private static List<Vec2> line(double x1, double y1, double x2, double y2) {
        return List.of(new Vec2(x1, y1), new Vec2(x2, y2));
    }

    @Test
    @DisplayName("a room with no partitions has no sub-zones")
    void noPartitions() {
        assertTrue(SubZones.derive(ROOM, Transform.IDENTITY, List.of()).isEmpty());
    }

    @Test
    @DisplayName("one wall-to-wall partition splits the room in two, areas summing to the whole")
    void oneVerticalPartition() {
        List<SubZones.SubZone> zones =
                SubZones.derive(ROOM, Transform.IDENTITY, List.of(line(0, -4, 0, 4)));

        assertEquals(2, zones.size());
        assertEquals(96.0, zones.stream().mapToDouble(SubZones.SubZone::area).sum(), 1e-6);
        for (SubZones.SubZone zone : zones) {
            assertEquals(48.0, zone.area(), 1e-6);
        }
        assertEquals(List.of("Zone A", "Zone B"), zones.stream().map(SubZones.SubZone::name).toList());
    }

    @Test
    @DisplayName("a partition that stops short of the far wall divides nothing")
    void danglingPartition() {
        // Reaches only halfway across, so the room is still one connected space.
        assertTrue(SubZones.derive(ROOM, Transform.IDENTITY, List.of(line(0, -4, 0, 0))).isEmpty(),
                "a dangling partition must not invent a zone");
    }

    @Test
    @DisplayName("crossing partitions make four zones, named in reading order")
    void crossingPartitions() {
        List<SubZones.SubZone> zones = SubZones.derive(ROOM, Transform.IDENTITY,
                List.of(line(0, -4, 0, 4), line(-6, 0, 6, 0)));

        assertEquals(4, zones.size());
        assertEquals(96.0, zones.stream().mapToDouble(SubZones.SubZone::area).sum(), 1e-6);
        for (SubZones.SubZone zone : zones) {
            assertEquals(24.0, zone.area(), 1e-6);
        }
        // Reading order is top row first, left to right, so names are stable run to run.
        assertEquals("Zone A", zones.get(0).name());
        assertTrue(zones.get(0).ring().stream().allMatch(p -> p.get(1) >= -1e-9),
                "Zone A must be in the top half");
        assertTrue(zones.get(0).ring().stream().anyMatch(p -> p.get(0) <= 1e-9),
                "Zone A must be the left of the top two");
    }

    @Test
    @DisplayName("an off-centre partition splits the room unevenly, as drawn")
    void unevenSplit() {
        List<SubZones.SubZone> zones =
                SubZones.derive(ROOM, Transform.IDENTITY, List.of(line(-2, -4, -2, 4)));

        assertEquals(2, zones.size());
        List<Double> areas = zones.stream().map(SubZones.SubZone::area).sorted().toList();
        assertEquals(32.0, areas.get(0), 1e-6);   // 4 wide x 8
        assertEquals(64.0, areas.get(1), 1e-6);   // 8 wide x 8
    }

    @Test
    @DisplayName("works on a non-rectangular room")
    void lShapedRoom() {
        Shape lShape = new Shape.Polygon(List.of(
                new Vec2(0, 0), new Vec2(8, 0), new Vec2(8, 4),
                new Vec2(4, 4), new Vec2(4, 8), new Vec2(0, 8)));
        // Cut across the lower arm, wall to wall.
        List<SubZones.SubZone> zones =
                SubZones.derive(lShape, Transform.IDENTITY, List.of(line(4, 0, 4, 4)));

        assertEquals(2, zones.size());
        assertEquals(48.0, zones.stream().mapToDouble(SubZones.SubZone::area).sum(), 1e-6);
    }
}
