package com.seatbooking.layout;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.seatbooking.domain.Floor;
import com.seatbooking.domain.PlanStatus;
import com.seatbooking.repo.AppUserRepository;
import com.seatbooking.repo.FloorPlanVersionRepository;
import com.seatbooking.repo.FloorRepository;
import com.seatbooking.repo.SeatRepository;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * The draft / publish lifecycle, end to end against a real Postgres.
 *
 * <p>Several of these pin bugs that manual testing found and that nothing else would have
 * caught: cloning a draft was relocating the published version's rows rather than copying
 * them, and removing a seat from a draft was silently deleting bookings through an
 * ON DELETE CASCADE before the publish guard could ever run.
 */
@SpringBootTest
// Each test runs in a transaction that is rolled back afterwards. Without this, a draft
// or booking left behind by one test collides with the next through the very constraints
// this schema relies on: one draft per floor, and no overlapping booking on a seat.
@Transactional
class LayoutLifecycleTest {

    @Autowired private LayoutService layouts;
    @Autowired private FloorRepository floors;
    @Autowired private FloorPlanVersionRepository versions;
    @Autowired private SeatRepository seats;
    @Autowired private AppUserRepository users;
    @Autowired private JdbcClient jdbc;

    private Floor demoFloor() {
        return floors.findAll().stream().findFirst().orElseThrow();
    }

    private UUID adminId() {
        return users.findByEmailIgnoreCase("admin@demo.test").orElseThrow().getId();
    }

    /**
     * A draft cloned from the published version, with any pre-existing draft discarded
     * first.
     *
     * <p>createDraft deliberately returns an existing draft rather than silently throwing
     * away an admin's work, so a test that just calls it inherits whatever half-finished
     * layout happens to be lying around. These tests assert against the PUBLISHED layout,
     * so they have to start from a clone of it.
     */
    private SceneDto freshDraft(Floor floor) {
        versions.findByFloorIdAndStatus(floor.getId(), PlanStatus.DRAFT)
                .ifPresent(existing -> jdbc.sql("DELETE FROM floor_plan_version WHERE id = :id")
                        .param("id", existing.getId()).update());
        return layouts.createDraft(floor.getId(), floor.getOrganizationId(), adminId());
    }

    private UUID publishedVersionId(UUID floorId) {
        return versions.findByFloorIdAndStatus(floorId, PlanStatus.PUBLISHED).orElseThrow().getId();
    }

    @Test
    @DisplayName("the seeded demo floor publishes cleanly with every shape kind represented")
    void demoFloorIsPublished() {
        Floor floor = demoFloor();
        SceneDto scene = layouts.getScene(publishedVersionId(floor.getId()));

        assertEquals(3, scene.rooms().size(), "a rectangular, a circular and an L-shaped room");
        assertEquals(4, scene.furniture().size());
        assertEquals(27, scene.seats().size());
        assertTrue(layouts.validate(scene.planVersionId()).isEmpty(),
                "the seeded layout must be valid, or the seed is hiding a validator bug");

        Set<String> kinds = scene.rooms().stream()
                .map(r -> r.shape().path("kind").asString())
                .collect(Collectors.toSet());
        assertEquals(Set.of("RECT", "CIRCLE", "POLYGON"), kinds);
    }

    @Test
    @DisplayName("world transforms are written at publish time by composing the parent chain")
    void worldTransformsAreDenormalisedAtPublish() {
        UUID published = publishedVersionId(demoFloor().getId());
        List<com.seatbooking.domain.Seat> rows = seats.findByPlanVersionId(published);
        assertTrue(rows.stream().allMatch(s -> s.getWorldX() != null && s.getWorldY() != null),
                "every published seat carries a denormalised world position");

        // Bench B sits at (3, 0) rotated 30 degrees. Its seat B1 is stored at table-local
        // (-1.65, -1.05), so composing must put it at roughly (2.096, -1.734).
        com.seatbooking.domain.Seat b1 = rows.stream()
                .filter(s -> "B1".equals(s.getCode())).findFirst().orElseThrow();
        assertEquals(2.096, b1.getWorldX(), 1e-3);
        assertEquals(-1.734, b1.getWorldY(), 1e-3);
    }

    @Test
    @DisplayName("cloning a draft COPIES the published version instead of relocating its rows")
    void draftCloneDoesNotCannibaliseThePublishedVersion() {
        Floor floor = demoFloor();
        UUID publishedId = publishedVersionId(floor.getId());
        List<UUID> publishedSeatIdsBefore =
                seats.findByPlanVersionId(publishedId).stream().map(com.seatbooking.domain.Seat::getId).toList();
        assertFalse(publishedSeatIdsBefore.isEmpty());

        SceneDto draft = freshDraft(floor);

        // The published version must still have every seat it started with. Reusing the
        // client-supplied ids used to make save() merge onto these very rows and move
        // them into the draft, emptying the published version.
        assertEquals(publishedSeatIdsBefore.size(), seats.findByPlanVersionId(publishedId).size(),
                "the published version lost seats to its own clone");

        Set<UUID> draftSeatIds = seats.findByPlanVersionId(draft.planVersionId()).stream()
                .map(com.seatbooking.domain.Seat::getId).collect(Collectors.toSet());
        assertEquals(publishedSeatIdsBefore.size(), draftSeatIds.size());
        for (UUID id : publishedSeatIdsBefore) {
            assertFalse(draftSeatIds.contains(id), "draft seats must be new rows, not the published ones");
        }

        // References must follow the remapping: no seat may point at a room or table that
        // belongs to another version.
        Set<UUID> draftRoomIds = draft.rooms().stream().map(SceneDto.RoomDto::id).collect(Collectors.toSet());
        Set<UUID> draftTableIds = draft.furniture().stream().map(SceneDto.FurnitureDto::id).collect(Collectors.toSet());
        for (SceneDto.SeatDto seat : draft.seats()) {
            assertTrue(draftRoomIds.contains(seat.roomId()), "seat " + seat.code() + " points outside its version");
            if (seat.tableId() != null) {
                assertTrue(draftTableIds.contains(seat.tableId()), "seat " + seat.code() + " points at a foreign table");
            }
        }
    }

    @Test
    @DisplayName("a newly drawn room keeps the id the editor minted for it")
    void newEntityKeepsItsClientId() {
        Floor floor = demoFloor();
        SceneDto draft = freshDraft(floor);

        // What the editor does when the pen closes: mint a uuid and save.
        UUID clientId = UUID.randomUUID();
        SceneDto.RoomDto drawn = new SceneDto.RoomDto(
                clientId, "Drawn by the pen",
                GeometryJson.parse("{\"kind\":\"POLYGON\",\"points\":[[0,0],[4,0],[4,4],[0,4]]}"),
                GeometryJson.parse("{\"x\":40,\"y\":40,\"rot\":0}"),
                new java.math.BigDecimal("2.700"), null, List.of(), List.of());

        List<SceneDto.RoomDto> rooms = new java.util.ArrayList<>(draft.rooms());
        rooms.add(drawn);
        SceneDto saved = layouts.saveScene(draft.planVersionId(),
                new SceneDto(draft.planVersionId(), draft.floorId(), draft.status(),
                        draft.revision(), rooms, draft.furniture(), draft.seats()),
                draft.revision());

        // Rewriting it would leave the editor's selection pointing at nothing.
        assertTrue(saved.rooms().stream().anyMatch(r -> clientId.equals(r.id())),
                "a brand-new id must survive the save; only a clone's borrowed ids are remapped");
    }

    @Test
    @DisplayName("a stale If-Match is refused rather than silently overwriting another admin")
    void staleRevisionIsRefused() {
        Floor floor = demoFloor();
        SceneDto draft = freshDraft(floor);
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> layouts.saveScene(draft.planVersionId(), draft, draft.revision() + 99));
        assertEquals(412, e.getStatusCode().value());
    }

    @Test
    @DisplayName("publishing is refused when it would delete a seat holding a future booking")
    void publishIsBlockedByLiveBookings() {
        Floor floor = demoFloor();
        UUID publishedId = publishedVersionId(floor.getId());
        UUID bookedSeat = seats.findByPlanVersionId(publishedId).stream()
                .filter(s -> "A3".equals(s.getCode())).findFirst().orElseThrow().getId();

        UUID bookingId = bookSeat(bookedSeat);

        SceneDto draft = freshDraft(floor);
        SceneDto without = new SceneDto(draft.planVersionId(), draft.floorId(), draft.status(),
                draft.revision(), draft.rooms(), draft.furniture(),
                draft.seats().stream().filter(s -> !"A3".equals(s.code())).toList());
        SceneDto saved = layouts.saveScene(draft.planVersionId(), without, draft.revision());

        LayoutService.PublishResult result = layouts.publish(saved.planVersionId());

        assertFalse(result.published(), "publishing must not orphan a live booking");
        assertEquals(1, result.affectedBookings().size());
        assertEquals("A3", result.affectedBookings().get(0).seatCode());
        assertEquals("user@demo.test", result.affectedBookings().get(0).userEmail());

        // The booking must still exist. The FK used to cascade, so the scene save above
        // deleted it outright and the guard had nothing left to find.
        assertEquals(1, countBooking(bookingId), "the booking was destroyed by a layout edit");

    }

    @Test
    @DisplayName("publishing carries live bookings onto the new version's matching seat")
    void publishRepointsLiveBookings() {
        Floor floor = demoFloor();
        UUID publishedId = publishedVersionId(floor.getId());
        UUID oldSeatId = seats.findByPlanVersionId(publishedId).stream()
                .filter(s -> "C1".equals(s.getCode())).findFirst().orElseThrow().getId();
        UUID bookingId = bookSeat(oldSeatId);

        SceneDto draft = freshDraft(floor);
        LayoutService.PublishResult result = layouts.publish(draft.planVersionId());
        assertTrue(result.published(), "an unchanged clone must publish cleanly");

        UUID newSeatId = seats.findByPlanVersionId(draft.planVersionId()).stream()
                .filter(s -> "C1".equals(s.getCode())).findFirst().orElseThrow().getId();
        assertNotEquals(oldSeatId, newSeatId);

        UUID nowPointsAt = jdbc.sql("SELECT seat_id FROM booking WHERE id = :id")
                .param("id", bookingId).query(UUID.class).single();
        assertEquals(newSeatId, nowPointsAt,
                "the booking must follow its seat code onto the newly published layout");

    }

    // ------------------------------------------------------------------ test helpers

    private UUID bookSeat(UUID seatId) {
        return jdbc.sql("""
                INSERT INTO booking (organization_id, seat_id, user_id, starts_at, ends_at, status, cost)
                SELECT s.organization_id, s.id, u.id,
                       now() + interval '2 days', now() + interval '2 days 3 hours', 'CONFIRMED', 13.50
                FROM seat s CROSS JOIN app_user u
                WHERE s.id = :seatId AND u.email = 'user@demo.test'
                RETURNING id
                """)
                .param("seatId", seatId)
                .query(UUID.class)
                .single();
    }

    private int countBooking(UUID id) {
        return jdbc.sql("SELECT count(*) FROM booking WHERE id = :id").param("id", id)
                .query(Integer.class).single();
    }

}
