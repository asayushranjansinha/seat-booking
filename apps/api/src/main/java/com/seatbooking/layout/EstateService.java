package com.seatbooking.layout;

import com.seatbooking.auth.CurrentUser;
import com.seatbooking.booking.BookingException;
import com.seatbooking.domain.Building;
import com.seatbooking.domain.Floor;
import com.seatbooking.domain.PlanStatus;
import com.seatbooking.repo.BuildingRepository;
import com.seatbooking.repo.FloorPlanVersionRepository;
import com.seatbooking.repo.FloorRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The buildings and floors a layout is drawn on.
 *
 * <p>Deliberately separate from {@link LayoutService}: that owns what is inside a floor,
 * this owns the floors themselves.
 *
 * <p>Reads here go through plain SQL because they aggregate across four tables, while
 * writes go through JPA. That mix has one rule: FLUSH after every save or delete.
 * Hibernate defers its statements to commit, so an unflushed insert is invisible to the
 * very next query in the same transaction — a new floor would not be seen by the check
 * that two floors cannot share a level, and a deleted one would still be counted. Deleting either is the interesting part, because a
 * floor's seats may be holding bookings and {@code booking.seat_id} is ON DELETE RESTRICT.
 * Without a check the database refuses the delete with a constraint violation, which
 * reaches the person as a 500 that explains nothing.
 */
@Service
public class EstateService {

    private final BuildingRepository buildings;
    private final FloorRepository floors;
    private final FloorPlanVersionRepository versions;
    private final JdbcClient jdbc;

    public EstateService(BuildingRepository buildings, FloorRepository floors,
                         FloorPlanVersionRepository versions, JdbcClient jdbc) {
        this.buildings = buildings;
        this.floors = floors;
        this.versions = versions;
        this.jdbc = jdbc;
    }

    // ------------------------------------------------------------------------ reading

    @Transactional(readOnly = true)
    public List<BuildingDtos.BuildingSummary> list(CurrentUser caller) {
        return buildings.findByOrganizationId(caller.organizationId()).stream()
                .map(b -> new BuildingDtos.BuildingSummary(
                        b.getId(), b.getName(), b.getAddress(), summarise(b.getId())))
                .toList();
    }

    private List<BuildingDtos.FloorSummary> summarise(UUID buildingId) {
        return jdbc.sql("""
                SELECT f.id, f.name, f.level,
                       pub.id AS published_id, dft.id AS draft_id, pub.published_at,
                       (SELECT count(*) FROM room r WHERE r.plan_version_id = pub.id) AS rooms,
                       (SELECT count(*) FROM seat s WHERE s.plan_version_id = pub.id) AS seats,
                       (SELECT count(*) FROM booking b
                          JOIN seat s2 ON s2.id = b.seat_id
                         WHERE s2.plan_version_id = pub.id
                           AND b.status <> 'CANCELLED' AND b.ends_at > now()) AS live_bookings
                FROM floor f
                LEFT JOIN floor_plan_version pub
                       ON pub.floor_id = f.id AND pub.status = 'PUBLISHED'
                LEFT JOIN floor_plan_version dft
                       ON dft.floor_id = f.id AND dft.status = 'DRAFT'
                WHERE f.building_id = :buildingId
                ORDER BY f.level
                """)
                .param("buildingId", buildingId)
                .query((rs, n) -> new BuildingDtos.FloorSummary(
                        rs.getObject(1, UUID.class), rs.getString(2), rs.getInt(3),
                        rs.getObject(4, UUID.class), rs.getObject(5, UUID.class),
                        rs.getInt(7), rs.getInt(8), rs.getInt(9),
                        rs.getTimestamp(6) == null ? null : rs.getTimestamp(6).toInstant()))
                .list();
    }

    // ----------------------------------------------------------------------- buildings

    @Transactional
    public BuildingDtos.BuildingSummary createBuilding(CurrentUser caller, BuildingDtos.CreateBuildingRequest request) {
        Building building = buildings.saveAndFlush(
                new Building(caller.organizationId(), request.name().trim(), blankToNull(request.address())));
        return new BuildingDtos.BuildingSummary(
                building.getId(), building.getName(), building.getAddress(), List.of());
    }

    @Transactional
    public BuildingDtos.BuildingSummary updateBuilding(CurrentUser caller, UUID id, BuildingDtos.UpdateBuildingRequest request) {
        Building building = ownedBuilding(caller, id);
        jdbc.sql("UPDATE building SET name = :name, address = :address WHERE id = :id")
                .param("name", request.name().trim())
                .param("address", blankToNull(request.address()))
                .param("id", id)
                .update();
        return new BuildingDtos.BuildingSummary(
                building.getId(), request.name().trim(), blankToNull(request.address()), summarise(id));
    }

    /**
     * Delete a building and everything on it.
     *
     * <p>Refused outright while any floor still holds a live booking. The alternative is
     * cancelling other people's bookings as a side effect of tidying up an estate, which
     * nobody would expect from a rename-and-delete screen.
     */
    @Transactional
    public void deleteBuilding(CurrentUser caller, UUID id) {
        ownedBuilding(caller, id);
        List<LayoutService.AffectedBooking> live = liveBookings(
                "v.floor_id IN (SELECT id FROM floor WHERE building_id = :id)", id);
        if (!live.isEmpty()) {
            throw blocked(live, "building");
        }
        buildings.deleteById(id);
        buildings.flush();
    }

    // -------------------------------------------------------------------------- floors

    @Transactional
    public BuildingDtos.FloorSummary createFloor(CurrentUser caller, UUID buildingId, BuildingDtos.CreateFloorRequest request) {
        ownedBuilding(caller, buildingId);
        requireFreeLevel(buildingId, request.level(), null);
        Floor floor = floors.saveAndFlush(new Floor(
                caller.organizationId(), buildingId, request.name().trim(), request.level()));
        // A new floor has no layout at all, which the editor now treats as a starting
        // point rather than an error.
        return new BuildingDtos.FloorSummary(
                floor.getId(), floor.getName(), floor.getLevel(), null, null, 0, 0, 0, null);
    }

    @Transactional
    public BuildingDtos.FloorSummary updateFloor(CurrentUser caller, UUID floorId, BuildingDtos.UpdateFloorRequest request) {
        Floor floor = ownedFloor(caller, floorId);
        requireFreeLevel(floor.getBuildingId(), request.level(), floorId);
        jdbc.sql("UPDATE floor SET name = :name, level = :level WHERE id = :id")
                .param("name", request.name().trim())
                .param("level", request.level())
                .param("id", floorId)
                .update();
        return summarise(floor.getBuildingId()).stream()
                .filter(f -> f.id().equals(floorId))
                .findFirst()
                .orElseThrow();
    }

    @Transactional
    public void deleteFloor(CurrentUser caller, UUID floorId) {
        ownedFloor(caller, floorId);
        List<LayoutService.AffectedBooking> live = liveBookings("v.floor_id = :id", floorId);
        if (!live.isEmpty()) {
            throw blocked(live, "floor");
        }
        floors.deleteById(floorId);
        floors.flush();
    }

    /** Discard a floor's draft, throwing away unpublished work on purpose. */
    @Transactional
    public void discardDraft(CurrentUser caller, UUID floorId) {
        ownedFloor(caller, floorId);
        versions.findByFloorIdAndStatus(floorId, PlanStatus.DRAFT)
                .ifPresent(draft -> {
                    versions.deleteById(draft.getId());
                    versions.flush();
                });
    }

    // ------------------------------------------------------------------------- guards

    private Building ownedBuilding(CurrentUser caller, UUID id) {
        return buildings.findById(id)
                .filter(b -> b.getOrganizationId().equals(caller.organizationId()))
                .orElseThrow(() -> new BookingException(
                        HttpStatus.NOT_FOUND, "NO_SUCH_BUILDING", "No such building."));
    }

    private Floor ownedFloor(CurrentUser caller, UUID id) {
        return floors.findById(id)
                .filter(f -> f.getOrganizationId().equals(caller.organizationId()))
                .orElseThrow(() -> new BookingException(
                        HttpStatus.NOT_FOUND, "NO_SUCH_FLOOR", "No such floor."));
    }

    /**
     * Levels are unique per building in the schema, so a clash would otherwise surface as
     * a constraint violation rather than an explanation.
     */
    private void requireFreeLevel(UUID buildingId, int level, UUID exceptFloorId) {
        // The casts are required: Postgres cannot infer the type of a bare parameter used
        // only as `? IS NULL`, and rejects the statement as bad grammar.
        Integer clash = jdbc.sql("""
                SELECT count(*) FROM floor
                WHERE building_id = :buildingId AND level = :level
                  AND (CAST(:exceptId AS uuid) IS NULL OR id <> CAST(:exceptId AS uuid))
                """)
                .param("buildingId", buildingId)
                .param("level", level)
                .param("exceptId", exceptFloorId)
                .query(Integer.class).single();
        if (clash != null && clash > 0) {
            throw new BookingException(HttpStatus.CONFLICT, "LEVEL_TAKEN",
                    "This building already has a floor at level " + level + ".");
        }
    }

    private List<LayoutService.AffectedBooking> liveBookings(String floorPredicate, UUID id) {
        return jdbc.sql("""
                SELECT b.id, s.code, u.email, b.starts_at, b.ends_at
                FROM booking b
                JOIN seat s ON s.id = b.seat_id
                JOIN floor_plan_version v ON v.id = s.plan_version_id
                JOIN app_user u ON u.id = b.user_id
                WHERE %s
                  AND b.status <> 'CANCELLED'
                  AND b.ends_at > now()
                ORDER BY b.starts_at
                """.formatted(floorPredicate))
                .param("id", id)
                .query((rs, n) -> new LayoutService.AffectedBooking(
                        rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getTimestamp(4).toInstant(), rs.getTimestamp(5).toInstant()))
                .list();
    }

    private static BookingException blocked(List<LayoutService.AffectedBooking> live, String what) {
        // Count PEOPLE, not bookings. One manager holding a six-seat table is one person,
        // and saying "held by 6 people" sends an admin looking for five colleagues who
        // were never involved.
        List<String> people = live.stream()
                .map(LayoutService.AffectedBooking::userEmail)
                .distinct()
                .toList();
        String who = people.size() == 1
                ? people.get(0)
                : people.size() + " people";
        return new BookingException(HttpStatus.CONFLICT, "HAS_LIVE_BOOKINGS",
                "This " + what + " still has " + live.size() + " booking"
                        + (live.size() == 1 ? "" : "s") + " held by " + who
                        + ". Cancel them first, or wait until they have passed.");
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
