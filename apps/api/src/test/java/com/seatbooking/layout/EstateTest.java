package com.seatbooking.layout;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.seatbooking.DemoData;
import com.seatbooking.auth.CurrentUser;
import com.seatbooking.booking.BookingException;
import com.seatbooking.domain.Role;
import com.seatbooking.repo.AppUserRepository;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

/**
 * Managing the buildings and floors themselves.
 *
 * <p>The deletions are the interesting half. Seats are referenced by bookings through an
 * ON DELETE RESTRICT foreign key, so without a check the database refuses and the person
 * gets a constraint violation instead of an explanation.
 */
@SpringBootTest
@Transactional
class EstateTest {

    @Autowired private EstateService estate;
    @Autowired private AppUserRepository users;
    @Autowired private JdbcClient jdbc;

    private CurrentUser admin;

    @BeforeEach
    void setUp() {
        DemoData.require(jdbc);
        var user = users.findByEmailIgnoreCase("admin@demo.test").orElseThrow();
        admin = new CurrentUser(user.getId(), user.getOrganizationId(), user.getEmail(), Role.ADMIN);

        // Start from no bookings. These tests assert on exact counts and on who holds
        // what, so anything left behind by a person using the app would decide the
        // result. The class is @Transactional, so this is rolled back and their data
        // survives the test run untouched.
        jdbc.sql("DELETE FROM booking").update();
    }

    private UUID someBuilding() {
        return estate.list(admin).get(0).id();
    }

    @Test
    @DisplayName("a new building starts with no floors, and a new floor with no layout")
    void createBuildingAndFloor() {
        var building = estate.createBuilding(admin,
                new BuildingDtos.CreateBuildingRequest("Dock House", "4 Quay Street"));
        assertEquals("Dock House", building.name());
        assertTrue(building.floors().isEmpty());

        var floor = estate.createFloor(admin, building.id(),
                new BuildingDtos.CreateFloorRequest("Ground", 0));
        assertEquals(0, floor.level());
        // Nothing drawn yet: the editor treats this as a starting point, not an error.
        assertEquals(null, floor.publishedVersionId());
        assertEquals(0, floor.seats());
    }

    @Test
    @DisplayName("two floors cannot share a level, and the message says which level")
    void levelsAreUniquePerBuilding() {
        var building = estate.createBuilding(admin,
                new BuildingDtos.CreateBuildingRequest("Dock House", null));
        estate.createFloor(admin, building.id(), new BuildingDtos.CreateFloorRequest("Ground", 0));

        BookingException e = assertThrows(BookingException.class, () ->
                estate.createFloor(admin, building.id(), new BuildingDtos.CreateFloorRequest("Reception", 0)));
        assertEquals("LEVEL_TAKEN", e.getCode());
        assertTrue(e.getMessage().contains("level 0"));

        // A different level is fine, and so is a basement.
        estate.createFloor(admin, building.id(), new BuildingDtos.CreateFloorRequest("Basement", -1));
        assertEquals(2, estate.list(admin).stream()
                .filter(b -> b.id().equals(building.id())).findFirst().orElseThrow().floors().size());
    }

    @Test
    @DisplayName("renaming a floor to its own level is allowed, not a clash with itself")
    void renamingKeepsItsOwnLevel() {
        var building = estate.createBuilding(admin, new BuildingDtos.CreateBuildingRequest("Dock House", null));
        var floor = estate.createFloor(admin, building.id(), new BuildingDtos.CreateFloorRequest("Ground", 0));

        var renamed = estate.updateFloor(admin, floor.id(), new BuildingDtos.UpdateFloorRequest("Lobby", 0));
        assertEquals("Lobby", renamed.name());
        assertEquals(0, renamed.level());
    }

    @Test
    @DisplayName("an empty floor deletes cleanly")
    void deleteEmptyFloor() {
        var building = estate.createBuilding(admin, new BuildingDtos.CreateBuildingRequest("Dock House", null));
        var floor = estate.createFloor(admin, building.id(), new BuildingDtos.CreateFloorRequest("Ground", 0));

        estate.deleteFloor(admin, floor.id());
        assertTrue(estate.list(admin).stream()
                .filter(b -> b.id().equals(building.id())).findFirst().orElseThrow().floors().isEmpty());
    }

    @Test
    @DisplayName("deleting a floor is refused while it holds a live booking, and says who holds it")
    void deletingAFloorWithBookingsIsRefused() {
        UUID buildingId = someBuilding();
        UUID floorId = estate.list(admin).stream()
                .filter(b -> b.id().equals(buildingId)).findFirst().orElseThrow()
                .floors().get(0).id();

        UUID bookingId = bookAnySeatOn(floorId);

        BookingException e = assertThrows(BookingException.class, () -> estate.deleteFloor(admin, floorId));
        assertEquals("HAS_LIVE_BOOKINGS", e.getCode());
        assertTrue(e.getMessage().contains("user@demo.test"), e.getMessage());

        // Several bookings by ONE person must not be reported as several people, or an
        // admin goes looking for colleagues who were never involved.
        bookSeatOn(floorId, 1);
        BookingException again = assertThrows(BookingException.class, () -> estate.deleteFloor(admin, floorId));
        assertTrue(again.getMessage().contains("2 bookings"), again.getMessage());
        assertTrue(again.getMessage().contains("user@demo.test"), again.getMessage());
        assertFalse(again.getMessage().contains("2 people"), again.getMessage());

        // Nothing was destroyed on the way to refusing.
        assertEquals(1, count("SELECT count(*) FROM floor WHERE id = '" + floorId + "'"));
        assertEquals(1, count("SELECT count(*) FROM booking WHERE id = '" + bookingId + "'"));
    }

    @Test
    @DisplayName("deleting the building is refused for the same reason as its floor")
    void deletingABuildingWithBookingsIsRefused() {
        UUID buildingId = someBuilding();
        UUID floorId = estate.list(admin).stream()
                .filter(b -> b.id().equals(buildingId)).findFirst().orElseThrow()
                .floors().get(0).id();
        bookAnySeatOn(floorId);

        BookingException e = assertThrows(BookingException.class, () -> estate.deleteBuilding(admin, buildingId));
        assertEquals("HAS_LIVE_BOOKINGS", e.getCode());
        assertEquals(1, count("SELECT count(*) FROM building WHERE id = '" + buildingId + "'"));
    }

    @Test
    @DisplayName("a booking that has already finished does not block a delete")
    void pastBookingsDoNotBlock() {
        UUID buildingId = someBuilding();
        UUID floorId = estate.list(admin).stream()
                .filter(b -> b.id().equals(buildingId)).findFirst().orElseThrow()
                .floors().get(0).id();

        // Yesterday. The seat is free now, so there is nobody to inconvenience.
        jdbc.sql("""
                INSERT INTO booking (organization_id, seat_id, user_id, starts_at, ends_at, status, cost)
                SELECT s.organization_id, s.id, u.id,
                       now() - interval '1 day', now() - interval '23 hours', 'CONFIRMED', 0
                FROM seat s
                JOIN floor_plan_version v ON v.id = s.plan_version_id AND v.floor_id = :floorId
                CROSS JOIN app_user u
                WHERE u.email = 'user@demo.test'
                LIMIT 1
                """).param("floorId", floorId).update();

        // RESTRICT still applies to the row itself, so the past booking has to go with it.
        jdbc.sql("""
                DELETE FROM booking WHERE seat_id IN (
                  SELECT s.id FROM seat s
                  JOIN floor_plan_version v ON v.id = s.plan_version_id AND v.floor_id = :floorId)
                """).param("floorId", floorId).update();

        estate.deleteFloor(admin, floorId);
        assertEquals(0, count("SELECT count(*) FROM floor WHERE id = '" + floorId + "'"));
    }

    @Test
    @DisplayName("another organisation's building is simply not there")
    void otherOrganisationsAreInvisible() {
        UUID otherOrg = UUID.randomUUID();
        jdbc.sql("INSERT INTO organization (id, name) VALUES (:id, 'Rival Co')").param("id", otherOrg).update();
        UUID theirBuilding = UUID.randomUUID();
        jdbc.sql("INSERT INTO building (id, organization_id, name) VALUES (:id, :org, 'Theirs')")
                .param("id", theirBuilding).param("org", otherOrg).update();

        assertFalse(estate.list(admin).stream().anyMatch(b -> b.id().equals(theirBuilding)));

        BookingException e = assertThrows(BookingException.class,
                () -> estate.deleteBuilding(admin, theirBuilding));
        // Not found rather than forbidden: whether it exists is itself none of their business.
        assertEquals("NO_SUCH_BUILDING", e.getCode());
    }

    @Test
    @DisplayName("the summary counts rooms, seats and live bookings per floor")
    void summaryCounts() {
        UUID floorId = estate.list(admin).get(0).floors().get(0).id();
        var before = estate.list(admin).get(0).floors().get(0);
        assertTrue(before.rooms() > 0 && before.seats() > 0);
        assertEquals(0, before.liveBookings());

        bookAnySeatOn(floorId);
        assertEquals(1, estate.list(admin).get(0).floors().get(0).liveBookings());
    }

    private UUID bookAnySeatOn(UUID floorId) {
        return bookSeatOn(floorId, 0);
    }

    /** Book the nth seat, so two calls do not contend for the same one. */
    private UUID bookSeatOn(UUID floorId, int offset) {
        return jdbc.sql("""
                INSERT INTO booking (organization_id, seat_id, user_id, starts_at, ends_at, status, cost)
                SELECT s.organization_id, s.id, u.id,
                       now() + interval '2 days', now() + interval '2 days 2 hours', 'CONFIRMED', 0
                FROM seat s
                JOIN floor_plan_version v ON v.id = s.plan_version_id
                     AND v.floor_id = :floorId AND v.status = 'PUBLISHED'
                CROSS JOIN app_user u
                WHERE u.email = 'user@demo.test'
                ORDER BY s.code
                LIMIT 1 OFFSET :offset
                RETURNING id
                """).param("floorId", floorId).param("offset", offset).query(UUID.class).single();
    }

    private int count(String sql) {
        return jdbc.sql(sql).query(Integer.class).single();
    }
}
