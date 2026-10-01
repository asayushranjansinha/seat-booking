package com.seatbooking.layout;

import com.seatbooking.domain.AppUser;
import com.seatbooking.domain.Building;
import com.seatbooking.domain.Floor;
import com.seatbooking.domain.Organization;
import com.seatbooking.domain.Role;
import com.seatbooking.geometry.PlaceSeatsRequest;
import com.seatbooking.geometry.Placement;
import com.seatbooking.geometry.PlacementRule;
import com.seatbooking.geometry.SeatPlacement;
import com.seatbooking.geometry.Shape;
import com.seatbooking.repo.AppUserRepository;
import com.seatbooking.repo.BuildingRepository;
import com.seatbooking.repo.FloorRepository;
import com.seatbooking.repo.OrganizationRepository;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seeds a demo floor so the editor opens on real content rather than an empty canvas.
 *
 * <p>Built through the ordinary scene-save and publish path rather than raw inserts, so
 * the seed exercises validation and world-transform denormalisation exactly as a real
 * admin would. If the seed stops working, something real is broken.
 */
@Component
public class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);

    /** Distance from a table outline to a seat CENTRE. */
    private static final double CLEARANCE = 0.45;
    private static final double SEAT_RADIUS = 0.22;

    private final OrganizationRepository organizations;
    private final AppUserRepository users;
    private final BuildingRepository buildings;
    private final FloorRepository floors;
    private final LayoutService layouts;
    private final PasswordEncoder passwordEncoder;

    public DemoDataSeeder(OrganizationRepository organizations, AppUserRepository users,
                          BuildingRepository buildings, FloorRepository floors,
                          LayoutService layouts, PasswordEncoder passwordEncoder) {
        this.organizations = organizations;
        this.users = users;
        this.buildings = buildings;
        this.floors = floors;
        this.layouts = layouts;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (organizations.count() > 0) {
            return;
        }
        log.info("Seeding demo organisation, users and floor");

        Organization org = organizations.save(new Organization("Acme Coworking"));
        UUID orgId = org.getId();

        AppUser admin = users.save(new AppUser(orgId, "admin@demo.test", "Avery Admin",
                passwordEncoder.encode("password"), Role.ADMIN));
        users.save(new AppUser(orgId, "manager@demo.test", "Morgan Manager",
                passwordEncoder.encode("password"), Role.MANAGER));
        users.save(new AppUser(orgId, "user@demo.test", "Uma User",
                passwordEncoder.encode("password"), Role.USER));

        Building building = buildings.save(new Building(orgId, "Riverside HQ", "12 Wharf Road"));
        Floor floor = floors.save(new Floor(orgId, building.getId(), "Level 1", 1));

        SceneDto draft = layouts.createDraft(floor.getId(), orgId, admin.getId());
        SceneDto scene = buildDemoScene(draft.planVersionId(), floor.getId());
        SceneDto saved = layouts.saveScene(draft.planVersionId(), scene, draft.revision());

        List<Violation> problems = layouts.validate(saved.planVersionId());
        if (!problems.isEmpty()) {
            // Loud rather than silent: a seed that publishes an invalid layout would hide
            // a real validator bug behind "it looked fine in the editor".
            log.error("Demo seed produced {} validation problems; not publishing", problems.size());
            problems.forEach(p -> log.error("  {} [{}] {}", p.severity(), p.code(), p.message()));
            return;
        }

        LayoutService.PublishResult result = layouts.publish(saved.planVersionId());
        log.info("Demo floor published={} rooms={} tables={} seats={}",
                result.published(), saved.rooms().size(), saved.furniture().size(), saved.seats().size());
    }

    private SceneDto buildDemoScene(UUID planVersionId, UUID floorId) {
        UUID studioId = UUID.randomUUID();
        UUID roundId = UUID.randomUUID();
        UUID annexId = UUID.randomUUID();

        // A rectangular room, a circular room and an L-shaped polygon room: the three
        // cases the geometry engine has to handle with one code path.
        SceneDto.RoomDto studio = new SceneDto.RoomDto(
                studioId, "Open Studio",
                json("{\"kind\":\"RECT\",\"w\":12,\"h\":8}"),
                json("{\"x\":0,\"y\":0,\"rot\":0}"),
                new BigDecimal("2.900"), new BigDecimal("12.00"),
                List.of(new SceneDto.PartitionDto(UUID.randomUUID(),
                        json("[[0,-4],[0,4]]"), new BigDecimal("0.120"))),
                List.of(
                        // Edge 0 is the bottom wall; see Tessellation.tessellate(RECT).
                        new SceneDto.GateDto(UUID.randomUUID(), 0, bd("0.50"), bd("1.60"), "DOOR"),
                        new SceneDto.GateDto(UUID.randomUUID(), 2, bd("0.25"), bd("0.90"), "EMERGENCY")));

        SceneDto.RoomDto round = new SceneDto.RoomDto(
                roundId, "Round Room",
                json("{\"kind\":\"CIRCLE\",\"r\":4}"),
                json("{\"x\":18,\"y\":0,\"rot\":0}"),
                new BigDecimal("2.900"), new BigDecimal("18.00"),
                List.of(), List.of());

        SceneDto.RoomDto annex = new SceneDto.RoomDto(
                annexId, "The Annex",
                json("{\"kind\":\"POLYGON\",\"points\":[[0,0],[8,0],[8,4],[4,4],[4,8],[0,8]]}"),
                json("{\"x\":-4,\"y\":12,\"rot\":0}"),
                new BigDecimal("2.700"), new BigDecimal("9.00"),
                List.of(), List.of());

        List<SceneDto.FurnitureDto> furniture = new ArrayList<>();
        List<SceneDto.SeatDto> seats = new ArrayList<>();

        // Rectangular table, per-edge seat counts: 3 across each long side, 1 at each end.
        UUID benchId = UUID.randomUUID();
        furniture.add(table(benchId, studioId, "Bench A",
                "{\"kind\":\"RECT\",\"w\":2.4,\"h\":1.2}", "{\"x\":-3,\"y\":0,\"rot\":0}"));
        seats.addAll(seatsFor(studioId, benchId, "A",
                new Shape.Rect(2.4, 1.2),
                new PlacementRule.EdgeCounts(Map.of("bottom", 3, "top", 3, "left", 1, "right", 1))));

        // The same table rotated 30 degrees, seated by arc length. Its seats are stored in
        // table-local space, so the rotation is carried by one transform.
        UUID angledId = UUID.randomUUID();
        furniture.add(table(angledId, studioId, "Bench B",
                "{\"kind\":\"RECT\",\"w\":2.4,\"h\":1.2}", "{\"x\":3,\"y\":0,\"rot\":0.5235987755982988}"));
        seats.addAll(seatsFor(studioId, angledId, "B",
                new Shape.Rect(2.4, 1.2), new PlacementRule.PerimeterEven(8)));

        // Round table, radial seating.
        UUID roundTableId = UUID.randomUUID();
        furniture.add(table(roundTableId, roundId, "Round Table",
                "{\"kind\":\"CIRCLE\",\"r\":0.9}", "{\"x\":0,\"y\":0,\"rot\":0}"));
        seats.addAll(seatsFor(roundId, roundTableId, "C",
                new Shape.Circle(0.9), new PlacementRule.Radial(6)));

        // A triangular table: seats follow the offset outline, which is the point of
        // flattening every shape to a ring first.
        UUID wedgeId = UUID.randomUUID();
        furniture.add(table(wedgeId, annexId, "Wedge",
                "{\"kind\":\"POLYGON\",\"points\":[[-0.9,-0.6],[0.9,-0.6],[0,0.9]]}",
                "{\"x\":2,\"y\":2,\"rot\":0}"));
        seats.addAll(seatsFor(annexId, wedgeId, "D",
                new Shape.Polygon(GeometryJson.points(json("[[-0.9,-0.6],[0.9,-0.6],[0,0.9]]"))),
                new PlacementRule.PerimeterEven(5)));

        return new SceneDto(planVersionId, floorId, "DRAFT", 0,
                List.of(studio, round, annex), furniture, seats);
    }

    private SceneDto.FurnitureDto table(UUID id, UUID roomId, String label, String shape, String transform) {
        return new SceneDto.FurnitureDto(id, roomId, "TABLE", label,
                json(shape), json(transform), new BigDecimal("0.740"));
    }

    /** Runs the real placement engine, exactly as the editor does. */
    private List<SceneDto.SeatDto> seatsFor(UUID roomId, UUID tableId, String prefix,
                                            Shape tableShape, PlacementRule rule) {
        List<SeatPlacement> placements = Placement.placeSeats(
                new PlaceSeatsRequest(tableShape, CLEARANCE, rule, List.of(), Jts.TOLERANCE));

        List<SceneDto.SeatDto> out = new ArrayList<>(placements.size());
        for (SeatPlacement p : placements) {
            out.add(new SceneDto.SeatDto(
                    UUID.randomUUID(), roomId, tableId,
                    prefix + (p.index() + 1),
                    json("{\"kind\":\"CIRCLE\",\"r\":" + SEAT_RADIUS + "}"),
                    json(String.format("{\"x\":%s,\"y\":%s,\"rot\":%s}", p.x(), p.y(), p.rot())),
                    json(ruleJson(rule)),
                    p.index(), p.override(), true, new BigDecimal("4.50")));
        }
        return out;
    }

    private static String ruleJson(PlacementRule rule) {
        return switch (rule) {
            case PlacementRule.PerimeterEven r ->
                    "{\"kind\":\"PERIMETER_EVEN\",\"count\":" + r.count()
                            + ",\"startOffset\":" + r.startOffset() + ",\"clearance\":" + CLEARANCE + "}";
            case PlacementRule.Radial r ->
                    "{\"kind\":\"RADIAL\",\"count\":" + r.count()
                            + ",\"startAngle\":" + r.startAngle() + ",\"clearance\":" + CLEARANCE + "}";
            case PlacementRule.EdgeCounts r -> {
                StringBuilder sb = new StringBuilder("{\"kind\":\"EDGE_COUNTS\",\"counts\":{");
                boolean first = true;
                for (var e : r.counts().entrySet()) {
                    if (!first) {
                        sb.append(',');
                    }
                    sb.append('"').append(e.getKey()).append("\":").append(e.getValue());
                    first = false;
                }
                yield sb.append("},\"clearance\":").append(CLEARANCE).append('}').toString();
            }
            case PlacementRule.Manual ignored -> "{\"kind\":\"MANUAL\"}";
        };
    }

    private static tools.jackson.databind.JsonNode json(String raw) {
        return GeometryJson.parse(raw);
    }

    private static BigDecimal bd(String v) {
        return new BigDecimal(v);
    }
}
