package com.seatbooking.layout;

import com.seatbooking.geometry.Shape;
import com.seatbooking.geometry.Tessellation;
import com.seatbooking.geometry.Transform;
import com.seatbooking.geometry.Vec2;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.locationtech.jts.geom.Polygon;
import org.springframework.stereotype.Component;

/**
 * The authoritative check on a layout. The browser runs the same rules locally for
 * instant feedback, but a client cannot be trusted, so publishing is gated on this.
 */
@Component
public class LayoutValidator {

    public List<Violation> validate(SceneDto scene) {
        List<Violation> violations = new ArrayList<>();

        Map<UUID, Transform> roomWorld = new HashMap<>();
        Map<UUID, Polygon> roomPolygons = new HashMap<>();
        Map<UUID, Shape> roomShapes = new HashMap<>();

        for (SceneDto.RoomDto room : safe(scene.rooms())) {
            Shape shape;
            Transform world;
            try {
                shape = GeometryJson.shape(room.shape());
                world = GeometryJson.transform(room.transform());
            } catch (RuntimeException e) {
                violations.add(Violation.error("ROOM_GEOMETRY_UNREADABLE", "room", room.id(),
                        "Room geometry could not be read: " + e.getMessage()));
                continue;
            }
            Polygon polygon = Jts.polygon(shape, world);
            if (!polygon.isSimple() || !polygon.isValid()) {
                // Distinguish the two ways an outline goes wrong. A ring with a repeated
                // corner is not self-intersecting, and telling someone it is sends them
                // looking for a crossing edge that does not exist.
                violations.add(repeatedCorner(shape)
                        ? Violation.error("ROOM_REPEATED_CORNER", "room", room.id(),
                                "Room '" + room.name() + "' has two corners in the same place. "
                                        + "Delete it and trace the outline again.")
                        : Violation.error("ROOM_SELF_INTERSECTS", "room", room.id(),
                                "Room '" + room.name() + "' has an outline that crosses itself."));
            }
            roomWorld.put(room.id(), world);
            roomPolygons.put(room.id(), polygon);
            roomShapes.put(room.id(), shape);

            validateGates(room, shape, violations);
            validatePartitions(room, polygon, world, violations);
        }

        // Tables must sit inside their room.
        Map<UUID, Transform> tableWorld = new HashMap<>();
        Map<UUID, Polygon> tablePolygons = new HashMap<>();
        for (SceneDto.FurnitureDto f : safe(scene.furniture())) {
            Transform parent = roomWorld.get(f.roomId());
            if (parent == null) {
                violations.add(Violation.error("FURNITURE_ORPHANED", "furniture", f.id(),
                        "Furniture references a room that is not in this layout."));
                continue;
            }
            Shape shape;
            try {
                shape = GeometryJson.shape(f.shape());
            } catch (RuntimeException e) {
                violations.add(Violation.error("FURNITURE_GEOMETRY_UNREADABLE", "furniture", f.id(),
                        "Furniture geometry could not be read: " + e.getMessage()));
                continue;
            }
            Transform world = parent.compose(GeometryJson.transform(f.transform()));
            Polygon polygon = Jts.polygon(shape, world);
            tableWorld.put(f.id(), world);
            tablePolygons.put(f.id(), polygon);

            if (!roomPolygons.get(f.roomId()).contains(polygon)) {
                violations.add(Violation.error("FURNITURE_OUTSIDE_ROOM", "furniture", f.id(),
                        label(f) + " extends outside its room."));
            }
        }

        // Seats must sit inside their room, clear of tables, and clear of each other.
        List<UUID> seatIds = new ArrayList<>();
        List<Polygon> seatPolygons = new ArrayList<>();
        Set<String> seenCodes = new HashSet<>();

        for (SceneDto.SeatDto seat : safe(scene.seats())) {
            if (!seenCodes.add(seat.code())) {
                violations.add(Violation.error("SEAT_CODE_DUPLICATE", "seat", seat.id(),
                        "Seat code '" + seat.code() + "' is used more than once."));
            }
            // A seat's parent is its table when it has one, otherwise its room. This is
            // the chain that makes rotating a table carry its seats.
            Transform parent = seat.tableId() != null
                    ? tableWorld.get(seat.tableId())
                    : roomWorld.get(seat.roomId());
            if (parent == null) {
                violations.add(Violation.error("SEAT_ORPHANED", "seat", seat.id(),
                        "Seat '" + seat.code() + "' references a table or room not in this layout."));
                continue;
            }
            Shape shape;
            try {
                shape = GeometryJson.shape(seat.shape());
            } catch (RuntimeException e) {
                violations.add(Violation.error("SEAT_GEOMETRY_UNREADABLE", "seat", seat.id(),
                        "Seat geometry could not be read: " + e.getMessage()));
                continue;
            }
            Polygon polygon = Jts.polygon(shape, parent.compose(GeometryJson.transform(seat.localTransform())));

            Polygon room = roomPolygons.get(seat.roomId());
            if (room == null) {
                violations.add(Violation.error("SEAT_ORPHANED", "seat", seat.id(),
                        "Seat '" + seat.code() + "' references a room not in this layout."));
                continue;
            }
            if (!room.contains(polygon)) {
                violations.add(Violation.error("SEAT_OUTSIDE_ROOM", "seat", seat.id(),
                        "Seat '" + seat.code() + "' is outside its room."));
            }
            if (seat.tableId() != null) {
                Polygon table = tablePolygons.get(seat.tableId());
                if (table != null && table.intersects(polygon)) {
                    violations.add(Violation.error("SEAT_OVERLAPS_TABLE", "seat", seat.id(),
                            "Seat '" + seat.code() + "' overlaps its table; increase the clearance."));
                }
            }
            for (int i = 0; i < seatPolygons.size(); i++) {
                if (seatPolygons.get(i).intersects(polygon)) {
                    violations.add(Violation.error("SEAT_OVERLAPS_SEAT", "seat", seat.id(),
                            "Seat '" + seat.code() + "' overlaps another seat."));
                    break;
                }
            }
            seatIds.add(seat.id());
            seatPolygons.add(polygon);
        }

        return violations;
    }

    /** A gate must lie on a real wall of its room and fit within that wall. */
    private void validateGates(SceneDto.RoomDto room, Shape shape, List<Violation> violations) {
        List<Vec2> ring = Tessellation.tessellate(shape, Jts.TOLERANCE);
        for (SceneDto.GateDto gate : safe(room.gates())) {
            if (gate.wallEdgeIdx() < 0 || gate.wallEdgeIdx() >= ring.size()) {
                violations.add(Violation.error("GATE_NO_SUCH_WALL", "gate", gate.id(),
                        "Gate is placed on wall " + gate.wallEdgeIdx() + ", but the room has "
                                + ring.size() + " walls."));
                continue;
            }
            Vec2 a = ring.get(gate.wallEdgeIdx());
            Vec2 b = ring.get((gate.wallEdgeIdx() + 1) % ring.size());
            double wallLength = b.sub(a).length();
            double width = gate.width().doubleValue();
            double t = gate.offsetT().doubleValue();

            if (width > wallLength) {
                violations.add(Violation.error("GATE_WIDER_THAN_WALL", "gate", gate.id(),
                        String.format("Gate is %.2fm wide but its wall is only %.2fm.", width, wallLength)));
                continue;
            }
            // offsetT is the gate's CENTRE, so half its width must fit either side.
            double half = (width / 2) / wallLength;
            if (t - half < -1e-9 || t + half > 1 + 1e-9) {
                violations.add(Violation.error("GATE_OVERHANGS_WALL", "gate", gate.id(),
                        "Gate extends past the end of its wall."));
            }
        }
    }

    /** A partition must actually divide the room: both ends on the room boundary. */
    private void validatePartitions(SceneDto.RoomDto room, Polygon polygon, Transform world,
                                    List<Violation> violations) {
        for (SceneDto.PartitionDto partition : safe(room.partitions())) {
            List<Vec2> points = GeometryJson.points(partition.polyline());
            if (points.size() < 2) {
                violations.add(Violation.error("PARTITION_TOO_SHORT", "partition", partition.id(),
                        "A partition needs at least two points."));
                continue;
            }
            var line = Jts.lineString(points, world);
            double startGap = line.getStartPoint().distance(polygon.getBoundary());
            double endGap = line.getEndPoint().distance(polygon.getBoundary());
            if (startGap > Jts.TOLERANCE || endGap > Jts.TOLERANCE) {
                violations.add(Violation.error("PARTITION_NOT_ANCHORED", "partition", partition.id(),
                        "Both ends of a partition must meet the room boundary; "
                                + String.format("they are %.3fm and %.3fm away.", startGap, endGap)));
            }
            if (!polygon.covers(line)) {
                violations.add(Violation.error("PARTITION_OUTSIDE_ROOM", "partition", partition.id(),
                        "The partition leaves the room outline."));
            }
        }
    }

    /** True when two consecutive corners of the outline sit on top of each other. */
    private static boolean repeatedCorner(Shape shape) {
        List<Vec2> ring = Tessellation.tessellate(shape, Jts.TOLERANCE);
        for (int i = 0; i < ring.size(); i++) {
            Vec2 a = ring.get(i);
            Vec2 b = ring.get((i + 1) % ring.size());
            if (a.sub(b).length() < Jts.TOLERANCE) {
                return true;
            }
        }
        return false;
    }

    /** A human-readable name for a piece of furniture, for the violation message. */
    private static String label(SceneDto.FurnitureDto f) {
        return f.label() != null && !f.label().isBlank()
                ? "'" + f.label() + "'"
                : f.kind().toLowerCase();
    }

    private static <T> List<T> safe(List<T> list) {
        return list == null ? List.of() : list;
    }
}
