package com.seatbooking.layout;

import com.seatbooking.domain.Furniture;
import com.seatbooking.domain.FurnitureKind;
import com.seatbooking.domain.FloorPlanVersion;
import com.seatbooking.domain.Gate;
import com.seatbooking.domain.GateType;
import com.seatbooking.domain.PlanStatus;
import com.seatbooking.domain.Room;
import com.seatbooking.domain.RoomPartition;
import com.seatbooking.domain.Seat;
import com.seatbooking.geometry.Transform;
import com.seatbooking.geometry.Vec2;
import com.seatbooking.repo.FloorPlanVersionRepository;
import com.seatbooking.repo.FurnitureRepository;
import com.seatbooking.repo.GateRepository;
import com.seatbooking.repo.RoomPartitionRepository;
import com.seatbooking.repo.RoomRepository;
import com.seatbooking.repo.SeatRepository;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class LayoutService {

    private static final Logger log = LoggerFactory.getLogger(LayoutService.class);

    private final FloorPlanVersionRepository versions;
    private final RoomRepository rooms;
    private final RoomPartitionRepository partitions;
    private final GateRepository gates;
    private final FurnitureRepository furniture;
    private final SeatRepository seats;
    private final LayoutValidator validator;
    private final JdbcClient jdbc;
    private final EntityManager entityManager;

    public LayoutService(FloorPlanVersionRepository versions, RoomRepository rooms,
                         RoomPartitionRepository partitions, GateRepository gates,
                         FurnitureRepository furniture, SeatRepository seats,
                         LayoutValidator validator, JdbcClient jdbc,
                         EntityManager entityManager) {
        this.versions = versions;
        this.rooms = rooms;
        this.partitions = partitions;
        this.gates = gates;
        this.furniture = furniture;
        this.seats = seats;
        this.validator = validator;
        this.jdbc = jdbc;
        this.entityManager = entityManager;
    }

    // ------------------------------------------------------------------------ reading

    @Transactional(readOnly = true)
    public SceneDto getScene(UUID planVersionId) {
        FloorPlanVersion version = version(planVersionId);

        List<Room> roomRows = rooms.findByPlanVersionId(planVersionId);
        List<UUID> roomIds = roomRows.stream().map(Room::getId).toList();

        Map<UUID, List<SceneDto.PartitionDto>> partitionsByRoom = new HashMap<>();
        Map<UUID, List<SceneDto.GateDto>> gatesByRoom = new HashMap<>();
        if (!roomIds.isEmpty()) {
            for (RoomPartition p : partitions.findByRoomIdIn(roomIds)) {
                partitionsByRoom.computeIfAbsent(p.getRoomId(), k -> new ArrayList<>())
                        .add(new SceneDto.PartitionDto(
                                p.getId(), GeometryJson.parse(p.getPolyline()), p.getThickness()));
            }
            for (Gate g : gates.findByRoomIdIn(roomIds)) {
                gatesByRoom.computeIfAbsent(g.getRoomId(), k -> new ArrayList<>())
                        .add(new SceneDto.GateDto(g.getId(), g.getWallEdgeIdx(), g.getOffsetT(),
                                g.getWidth(), g.getType().name()));
            }
        }

        List<SceneDto.RoomDto> roomDtos = roomRows.stream()
                .map(r -> new SceneDto.RoomDto(
                        r.getId(), r.getName(),
                        GeometryJson.parse(r.getShape()), GeometryJson.parse(r.getTransform()),
                        r.getHeight(), r.getHourlyRate(),
                        partitionsByRoom.getOrDefault(r.getId(), List.of()),
                        gatesByRoom.getOrDefault(r.getId(), List.of())))
                .toList();

        List<SceneDto.FurnitureDto> furnitureDtos = furniture.findByPlanVersionId(planVersionId).stream()
                .map(f -> new SceneDto.FurnitureDto(
                        f.getId(), f.getRoomId(), f.getKind().name(), f.getLabel(),
                        GeometryJson.parse(f.getShape()), GeometryJson.parse(f.getTransform()),
                        f.getHeight()))
                .toList();

        List<SceneDto.SeatDto> seatDtos = seats.findByPlanVersionId(planVersionId).stream()
                .map(s -> new SceneDto.SeatDto(
                        s.getId(), s.getRoomId(), s.getTableId(), s.getCode(),
                        GeometryJson.parse(s.getShape()), GeometryJson.parse(s.getLocalTransform()),
                        GeometryJson.parse(s.getPlacement()), s.getSeatIndex(), s.isOverride(),
                        s.isBookable(), s.getHourlyRate()))
                .toList();

        return new SceneDto(version.getId(), version.getFloorId(), version.getStatus().name(),
                version.getRevision(), roomDtos, furnitureDtos, seatDtos);
    }

    // ------------------------------------------------------------------------ writing

    /**
     * Replace the whole scene graph in one transaction.
     *
     * <p>Guarded by {@code expectedRevision}, surfaced to clients as an ETag. Two admins
     * editing the same draft is not hypothetical, and without this the later save would
     * silently discard the earlier one.
     */
    @Transactional
    public SceneDto saveScene(UUID planVersionId, SceneDto scene, Long expectedRevision) {
        FloorPlanVersion version = version(planVersionId);

        if (version.getStatus() != PlanStatus.DRAFT) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Only a DRAFT version can be edited. Create a new draft from the published version first.");
        }
        if (expectedRevision != null && expectedRevision != version.getRevision()) {
            throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED,
                    "This layout changed since you loaded it (revision " + version.getRevision()
                            + ", you sent " + expectedRevision + "). Reload before saving.");
        }

        UUID orgId = version.getOrganizationId();

        // Ids the client sends are reused ONLY when they already belong to this version.
        // An id belonging to another version (which is exactly what a cloned draft carries)
        // must be remapped, otherwise save() merges onto that other version's row and
        // silently relocates it, destroying the version it came from.
        IdResolver ids = new IdResolver(ownedIds(planVersionId));

        // Rooms cascade to partitions, gates, furniture and seats, so one delete clears
        // the graph for this version.
        rooms.deleteByPlanVersionId(planVersionId);
        rooms.flush();
        // The bulk delete above runs as SQL and its cascade is invisible to the
        // persistence context, which is still holding the partitions and gates that
        // ownedIds() just loaded. Without this clear, Hibernate flushes an UPDATE for
        // rows the cascade already removed and fails with a phantom optimistic lock.
        entityManager.clear();

        for (SceneDto.RoomDto r : nullSafe(scene.rooms())) {
            Room room = new Room(orgId, planVersionId, r.name(),
                    GeometryJson.toJson(r.shape()), GeometryJson.toJson(r.transform()));
            room.setId(ids.resolve(r.id()));
            if (r.height() != null) {
                room.setHeight(r.height());
            }
            room.setHourlyRate(r.hourlyRate());
            rooms.save(room);

            for (SceneDto.PartitionDto p : nullSafe(r.partitions())) {
                RoomPartition partition = new RoomPartition(orgId, room.getId(),
                        GeometryJson.toJson(p.polyline()),
                        p.thickness() != null ? p.thickness() : new BigDecimal("0.100"));
                partition.setId(ids.resolve(p.id()));
                partitions.save(partition);
            }
            for (SceneDto.GateDto g : nullSafe(r.gates())) {
                Gate gate = new Gate(orgId, room.getId(), g.wallEdgeIdx(), g.offsetT(), g.width(),
                        GateType.valueOf(g.type()));
                gate.setId(ids.resolve(g.id()));
                gates.save(gate);
            }
        }
        rooms.flush();

        for (SceneDto.FurnitureDto f : nullSafe(scene.furniture())) {
            Furniture item = new Furniture(orgId, planVersionId, ids.reference(f.roomId()),
                    FurnitureKind.valueOf(f.kind()), f.label(),
                    GeometryJson.toJson(f.shape()), GeometryJson.toJson(f.transform()));
            item.setId(ids.resolve(f.id()));
            if (f.height() != null) {
                item.setHeight(f.height());
            }
            furniture.save(item);
        }
        furniture.flush();

        for (SceneDto.SeatDto s : nullSafe(scene.seats())) {
            Seat seat = new Seat(orgId, planVersionId, ids.reference(s.roomId()),
                    ids.reference(s.tableId()), s.code(),
                    GeometryJson.toJson(s.shape()), GeometryJson.toJson(s.localTransform()),
                    s.seatIndex());
            seat.setId(ids.resolve(s.id()));
            seat.setPlacement(GeometryJson.toJson(s.placement()));
            seat.setOverride(s.override());
            seat.setBookable(s.bookable());
            seat.setHourlyRate(s.hourlyRate());
            seats.save(seat);
        }

        FloorPlanVersion reloaded = version(planVersionId);
        reloaded.bumpRevision();
        versions.save(reloaded);
        return getScene(planVersionId);
    }

    // --------------------------------------------------------------------- validation

    @Transactional(readOnly = true)
    public List<Violation> validate(UUID planVersionId) {
        return validator.validate(getScene(planVersionId));
    }

    // ------------------------------------------------------------------------- drafts

    /**
     * Clone the floor's published version into an editable draft. If a draft already
     * exists it is returned as-is rather than silently discarding the admin's work.
     */
    @Transactional
    public SceneDto createDraft(UUID floorId, UUID organizationId, UUID userId) {
        Optional<FloorPlanVersion> existingDraft =
                versions.findByFloorIdAndStatus(floorId, PlanStatus.DRAFT);
        if (existingDraft.isPresent()) {
            return getScene(existingDraft.get().getId());
        }

        FloorPlanVersion draft = new FloorPlanVersion(organizationId, floorId,
                versions.maxVersionNo(floorId) + 1, PlanStatus.DRAFT, userId);
        versions.save(draft);
        versions.flush();

        Optional<FloorPlanVersion> published =
                versions.findByFloorIdAndStatus(floorId, PlanStatus.PUBLISHED);
        if (published.isPresent()) {
            SceneDto source = getScene(published.get().getId());
            // Reuse the published ids so a draft's seats stay recognisably the same
            // seats; the seat_code_unique_per_version constraint is scoped per version,
            // and the primary key is regenerated on save for the new version anyway.
            saveScene(draft.getId(), source, null);
        }
        return getScene(draft.getId());
    }

    // ------------------------------------------------------------------------ publish

    public record PublishResult(boolean published, List<Violation> violations,
                                List<AffectedBooking> affectedBookings, SceneDto scene) {}

    public record AffectedBooking(UUID bookingId, String seatCode, String userEmail,
                                  Instant startsAt, Instant endsAt) {}

    /**
     * Make the draft live, atomically.
     *
     * <p>Refused when the layout has errors, and refused when it would delete a seat that
     * holds a future booking: the caller gets the list of bookings that would be orphaned
     * rather than a bare failure. This costs little now and would be a rewrite later.
     */
    @Transactional
    public PublishResult publish(UUID planVersionId) {
        FloorPlanVersion draft = version(planVersionId);
        if (draft.getStatus() != PlanStatus.DRAFT) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Only a DRAFT version can be published.");
        }

        SceneDto scene = getScene(planVersionId);

        List<Violation> violations = validator.validate(scene).stream()
                .filter(v -> v.severity() == Violation.Severity.ERROR)
                .toList();
        if (!violations.isEmpty()) {
            return new PublishResult(false, violations, List.of(), scene);
        }

        List<AffectedBooking> affected = bookingsOnSeatsAboutToDisappear(draft.getFloorId(), planVersionId);
        if (!affected.isEmpty()) {
            return new PublishResult(false, List.of(), affected, scene);
        }

        // Denormalise world transforms so read paths never recompute the chain.
        writeWorldTransforms(scene);

        // Carry live bookings onto the incoming version's seats. Without this they would
        // be left pointing at the version about to be archived, so a booked seat would
        // vanish from the floor the moment a layout was republished.
        int moved = repointLiveBookings(draft.getFloorId(), planVersionId);
        if (moved > 0) {
            log.info("Re-pointed {} live booking(s) onto plan version {}", moved, planVersionId);
        }

        versions.findByFloorIdAndStatus(draft.getFloorId(), PlanStatus.PUBLISHED)
                .ifPresent(current -> {
                    current.setStatus(PlanStatus.ARCHIVED);
                    versions.save(current);
                });
        versions.flush();

        draft.setStatus(PlanStatus.PUBLISHED);
        draft.setPublishedAt(Instant.now());
        draft.bumpRevision();
        versions.save(draft);

        return new PublishResult(true, List.of(), List.of(), getScene(planVersionId));
    }

    /**
     * Future bookings on seats whose code exists in the published version but not in the
     * draft about to replace it. Matched on code rather than id, because a seat's identity
     * to a person who booked it is the code on the back of the chair.
     */
    private List<AffectedBooking> bookingsOnSeatsAboutToDisappear(UUID floorId, UUID draftId) {
        return jdbc.sql("""
                SELECT b.id, s.code, u.email, b.starts_at, b.ends_at
                FROM booking b
                JOIN seat s ON s.id = b.seat_id
                JOIN floor_plan_version v ON v.id = s.plan_version_id
                JOIN app_user u ON u.id = b.user_id
                WHERE v.floor_id = :floorId
                  AND v.status = 'PUBLISHED'
                  AND b.status <> 'CANCELLED'
                  AND b.ends_at > now()
                  AND s.code NOT IN (SELECT code FROM seat WHERE plan_version_id = :draftId)
                ORDER BY b.starts_at
                """)
                .param("floorId", floorId)
                .param("draftId", draftId)
                .query((rs, n) -> new AffectedBooking(
                        rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getTimestamp(4).toInstant(), rs.getTimestamp(5).toInstant()))
                .list();
    }

    /**
     * Move every live booking from the outgoing published version's seats to the matching
     * seats in the incoming one, matched on code.
     *
     * <p>Only future, non-cancelled bookings move. A booking that has already happened
     * stays attached to the layout it happened under, which is the honest record of where
     * that person actually sat.
     */
    private int repointLiveBookings(UUID floorId, UUID incomingVersionId) {
        return jdbc.sql("""
                UPDATE booking b
                SET seat_id = incoming.id
                FROM seat outgoing
                JOIN floor_plan_version v
                  ON v.id = outgoing.plan_version_id
                 AND v.floor_id = :floorId
                 AND v.status = 'PUBLISHED'
                JOIN seat incoming
                  ON incoming.plan_version_id = :incomingId
                 AND incoming.code = outgoing.code
                WHERE b.seat_id = outgoing.id
                  AND b.status <> 'CANCELLED'
                  AND b.ends_at > now()
                """)
                .param("floorId", floorId)
                .param("incomingId", incomingVersionId)
                .update();
    }

    /** Compose room -> table -> seat once, at publish time, and cache the result. */
    private void writeWorldTransforms(SceneDto scene) {
        Map<UUID, Transform> roomWorld = new HashMap<>();
        for (SceneDto.RoomDto r : nullSafe(scene.rooms())) {
            roomWorld.put(r.id(), GeometryJson.transform(r.transform()));
        }
        Map<UUID, Transform> tableWorld = new HashMap<>();
        for (SceneDto.FurnitureDto f : nullSafe(scene.furniture())) {
            Transform parent = roomWorld.getOrDefault(f.roomId(), Transform.IDENTITY);
            tableWorld.put(f.id(), parent.compose(GeometryJson.transform(f.transform())));
        }

        List<Seat> rows = seats.findByPlanVersionId(scene.planVersionId());
        Map<UUID, SceneDto.SeatDto> byId = new HashMap<>();
        for (SceneDto.SeatDto s : nullSafe(scene.seats())) {
            byId.put(s.id(), s);
        }
        for (Seat row : rows) {
            SceneDto.SeatDto dto = byId.get(row.getId());
            if (dto == null) {
                continue;
            }
            Transform parent = dto.tableId() != null
                    ? tableWorld.getOrDefault(dto.tableId(), Transform.IDENTITY)
                    : roomWorld.getOrDefault(dto.roomId(), Transform.IDENTITY);
            Transform world = parent.compose(GeometryJson.transform(dto.localTransform()));
            Vec2 origin = world.apply(Vec2.ZERO);
            row.setWorld(origin.x(), origin.y(), world.rot());
            seats.save(row);
        }
    }

    /** Every child id currently belonging to this plan version. */
    private Set<UUID> ownedIds(UUID planVersionId) {
        Set<UUID> owned = new HashSet<>();
        List<Room> roomRows = rooms.findByPlanVersionId(planVersionId);
        List<UUID> roomIds = roomRows.stream().map(Room::getId).toList();
        owned.addAll(roomIds);
        if (!roomIds.isEmpty()) {
            partitions.findByRoomIdIn(roomIds).forEach(p -> owned.add(p.getId()));
            gates.findByRoomIdIn(roomIds).forEach(g -> owned.add(g.getId()));
        }
        furniture.findByPlanVersionId(planVersionId).forEach(f -> owned.add(f.getId()));
        seats.findByPlanVersionId(planVersionId).forEach(s -> owned.add(s.getId()));
        return owned;
    }

    private FloorPlanVersion version(UUID id) {
        return versions.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "No such plan version: " + id));
    }

    private static <T> List<T> nullSafe(List<T> list) {
        return list == null ? List.of() : list;
    }
}
