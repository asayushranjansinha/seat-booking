package com.seatbooking.layout;

import com.seatbooking.geometry.PlaceSeatsRequest;
import com.seatbooking.geometry.Placement;
import com.seatbooking.geometry.PlacementRule;
import com.seatbooking.geometry.SeatOverride;
import com.seatbooking.geometry.SeatPlacement;
import com.seatbooking.geometry.Shape;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * Server-side seat placement.
 *
 * <p>The editor runs the identical algorithm locally so dragging stays at 60fps; this
 * endpoint exists because the server must be able to reproduce and re-validate what the
 * client claims it computed. Both are pinned to the same golden fixtures.
 */
@RestController
@RequestMapping("/api/geometry")
public class SeatGenerationController {

    public record PlaceSeatsBody(JsonNode shape, double clearance, JsonNode rule,
                                 List<SeatOverride> overrides, Double tolerance) {}

    @PostMapping("/place-seats")
    public List<SeatPlacement> placeSeats(@RequestBody PlaceSeatsBody body) {
        Shape shape = GeometryJson.shape(body.shape());
        PlacementRule rule = rule(body.rule());
        double tolerance = body.tolerance() != null
                ? body.tolerance()
                : PlaceSeatsRequest.DEFAULT_TOLERANCE;
        return Placement.placeSeats(new PlaceSeatsRequest(
                shape, body.clearance(), rule,
                body.overrides() == null ? List.of() : body.overrides(), tolerance));
    }

    private static PlacementRule rule(JsonNode n) {
        String kind = n.path("kind").asString();
        return switch (kind) {
            case "PERIMETER_EVEN" -> new PlacementRule.PerimeterEven(
                    n.path("count").asInt(), n.path("startOffset").asDouble(0));
            case "RADIAL" -> new PlacementRule.Radial(
                    n.path("count").asInt(), n.path("startAngle").asDouble(0));
            case "EDGE_COUNTS" -> {
                Map<String, Integer> counts = new java.util.LinkedHashMap<>();
                n.path("counts").properties()
                        .forEach(e -> counts.put(e.getKey(), e.getValue().asInt()));
                yield new PlacementRule.EdgeCounts(counts);
            }
            case "MANUAL" -> new PlacementRule.Manual();
            default -> throw new IllegalArgumentException("unsupported placement rule: " + kind);
        };
    }
}
