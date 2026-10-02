package com.seatbooking.layout;

import com.seatbooking.geometry.Transform;
import com.seatbooking.geometry.Vec2;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Seat codes, in the order a person reads a floor.
 *
 * <p>Codes used to be handed out per table, from a letter chosen by how many tables
 * happened to exist when that one was drawn. Draw the tables in a different order and the
 * same floor gets different codes; move a table across the room and it keeps a letter that
 * now means nothing. Nobody could be told "you are in B7" and walk to it.
 *
 * <p>So the floor decides, not the drawing order. Rooms are lettered down and across the
 * plan, and seats within a room are numbered the same way: by the table they belong to,
 * then by their place around it. A1 is in the first room, nearest its top-left corner, and
 * stays A1 however the plan is edited around it.
 *
 * <p>Assigned on the server, on every save. The browser cannot be the authority on this —
 * two people editing the same draft would each renumber from their own view of it.
 */
final class SeatNumbering {

    private SeatNumbering() {}

    /** Reading order: down the plan first, then across. */
    private static final Comparator<Vec2> READING_ORDER =
            Comparator.<Vec2>comparingDouble(p -> -round(p.y())).thenComparingDouble(p -> round(p.x()));

    /**
     * Positions are doubles that have been through a rotation, so two things an operator
     * put in one row are rarely at exactly one y. Rounded to the nearest 10 cm they are,
     * and a 10 cm difference is not a row.
     */
    private static double round(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    /** A letter per room: A..Z, then AA, AB — the same scheme a spreadsheet uses. */
    static String letterFor(int index) {
        StringBuilder out = new StringBuilder();
        for (int n = index; n >= 0; n = n / 26 - 1) {
            out.insert(0, (char) ('A' + n % 26));
        }
        return out.toString();
    }

    /**
     * Work out every seat's code.
     *
     * @return seat id to code, covering exactly the seats given
     */
    static Map<UUID, String> assign(SceneDto scene) {
        Map<UUID, String> codes = new HashMap<>();
        if (scene.rooms() == null || scene.seats() == null) {
            return codes;
        }

        // Rooms in reading order. A room's own transform is its position on the floor.
        List<SceneDto.RoomDto> rooms = new ArrayList<>(scene.rooms());
        rooms.sort(Comparator.comparing(r -> origin(r.transform()), READING_ORDER));

        // Where each table sits, so the seats in a room can be ordered by table.
        Map<UUID, Vec2> tableAt = new HashMap<>();
        Map<UUID, UUID> tableRoom = new HashMap<>();
        for (SceneDto.FurnitureDto f : nullSafe(scene.furniture())) {
            tableAt.put(f.id(), origin(f.transform()));
            tableRoom.put(f.id(), f.roomId());
        }

        for (int i = 0; i < rooms.size(); i++) {
            String letter = letterFor(i);
            UUID roomId = rooms.get(i).id();

            List<SceneDto.SeatDto> inRoom = new ArrayList<>();
            for (SceneDto.SeatDto s : scene.seats()) {
                if (roomId.equals(s.roomId())) inRoom.add(s);
            }

            // By table, in reading order, then by the seat's own place around that table.
            // A seat with no table is loose in the room and is ordered by where it is.
            inRoom.sort(Comparator
                    .comparing((SceneDto.SeatDto s) -> {
                        Vec2 at = s.tableId() == null ? null : tableAt.get(s.tableId());
                        return at != null ? at : origin(s.localTransform());
                    }, READING_ORDER)
                    .thenComparingInt(SceneDto.SeatDto::seatIndex)
                    .thenComparing(s -> String.valueOf(s.id())));

            for (int n = 0; n < inRoom.size(); n++) {
                codes.put(inRoom.get(n).id(), letter + (n + 1));
            }
        }
        return codes;
    }

    private static Vec2 origin(tools.jackson.databind.JsonNode transformJson) {
        Transform t = GeometryJson.transform(transformJson);
        return new Vec2(t.x(), t.y());
    }

    private static <T> List<T> nullSafe(List<T> list) {
        return list == null ? List.of() : list;
    }
}
