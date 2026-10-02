package com.seatbooking.layout;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.seatbooking.geometry.Vec2;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

/**
 * An outline can be wrong in two different ways, and the message has to say which.
 * Telling someone their outline crosses itself when it actually has two corners in the
 * same place sends them hunting for a crossing edge that is not there.
 */
class OutlineValidationTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final LayoutValidator validator = new LayoutValidator();

    private static SceneDto sceneWithRoom(String shapeJson) {
        SceneDto.RoomDto room = new SceneDto.RoomDto(
                UUID.randomUUID(), "Room 1",
                MAPPER.readTree(shapeJson),
                MAPPER.readTree("{\"x\":0,\"y\":0,\"rot\":0}"),
                new BigDecimal("2.700"), null, List.of(), List.of());
        return new SceneDto(UUID.randomUUID(), UUID.randomUUID(), "DRAFT", 1,
                List.of(room), List.of(), List.of());
    }

    @Test
    @DisplayName("a repeated corner is reported as a repeated corner, not a self-intersection")
    void repeatedCorner() {
        // Exactly what the pen produced from two clicks in the same spot.
        List<Violation> found = validator.validate(sceneWithRoom(
                "{\"kind\":\"POLYGON\",\"points\":[[0,0],[8,0],[8,6],[8,6],[0,6]]}"));

        assertEquals(1, found.size());
        assertEquals("ROOM_REPEATED_CORNER", found.get(0).code());
        assertTrue(found.get(0).message().contains("same place"));
    }

    @Test
    @DisplayName("an outline that genuinely crosses itself says so")
    void selfIntersecting() {
        // A bow tie: the edges cross in the middle.
        List<Violation> found = validator.validate(sceneWithRoom(
                "{\"kind\":\"POLYGON\",\"points\":[[0,0],[8,6],[8,0],[0,6]]}"));

        assertEquals(1, found.size());
        assertEquals("ROOM_SELF_INTERSECTS", found.get(0).code());
        assertTrue(found.get(0).message().contains("crosses itself"));
    }

    @Test
    @DisplayName("an ordinary outline passes")
    void validOutline() {
        assertTrue(validator.validate(sceneWithRoom(
                "{\"kind\":\"POLYGON\",\"points\":[[0,0],[8,0],[8,6],[0,6]]}")).isEmpty());
        assertTrue(validator.validate(sceneWithRoom(
                "{\"kind\":\"RECT\",\"w\":8,\"h\":6}")).isEmpty());
    }
}
