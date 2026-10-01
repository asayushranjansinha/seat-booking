package com.seatbooking.geometry;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads the golden fixtures shared with the TypeScript engine.
 *
 * <p>Spring Boot 4 ships Jackson 3, which lives under {@code tools.jackson} rather than
 * {@code com.fasterxml.jackson.databind} and renames {@code asText()} to
 * {@code asString()}. Annotations stay on the old coordinates.
 *
 * <p>On the wire a point is the compact tuple [x, y]; in the domain model it is a
 * {@link Vec2}. That conversion lives here and nowhere else.
 */
final class Fixtures {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** Resolved from the module directory so it works under both Maven and an IDE. */
    static final Path DIR = Path.of("..", "..", "packages", "geometry-fixtures", "fixtures")
            .toAbsolutePath()
            .normalize();

    private Fixtures() {}

    record Case(String name, String op, JsonNode input, JsonNode expected) {}

    static List<Case> load(String file) {
        try {
            JsonNode doc = MAPPER.readTree(Files.readString(DIR.resolve(file)));
            List<Case> out = new ArrayList<>();
            for (JsonNode c : doc.get("cases")) {
                out.add(new Case(
                        c.get("name").asString(),
                        c.hasNonNull("op") ? c.get("op").asString() : null,
                        c.get("input"),
                        c.get("expected")));
            }
            return out;
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read fixture " + file + " from " + DIR, e);
        }
    }

    static Vec2 vec(JsonNode n) {
        return new Vec2(n.get(0).asDouble(), n.get(1).asDouble());
    }

    static List<Vec2> ring(JsonNode n) {
        List<Vec2> out = new ArrayList<>(n.size());
        for (JsonNode p : n) {
            out.add(vec(p));
        }
        return out;
    }

    static Shape shape(JsonNode n) {
        String kind = n.get("kind").asString();
        return switch (kind) {
            case "RECT" -> new Shape.Rect(n.get("w").asDouble(), n.get("h").asDouble());
            case "CIRCLE" -> new Shape.Circle(n.get("r").asDouble());
            case "ELLIPSE" -> new Shape.Ellipse(n.get("rx").asDouble(), n.get("ry").asDouble());
            case "POLYGON" -> new Shape.Polygon(ring(n.get("points")));
            default -> throw new IllegalArgumentException("unsupported shape kind: " + kind);
        };
    }

    static Transform transform(JsonNode n) {
        return new Transform(
                n.get("x").asDouble(), n.get("y").asDouble(), n.get("rot").asDouble());
    }

    static PlacementRule rule(JsonNode n) {
        String kind = n.get("kind").asString();
        return switch (kind) {
            case "PERIMETER_EVEN" -> new PlacementRule.PerimeterEven(
                    n.get("count").asInt(),
                    n.hasNonNull("startOffset") ? n.get("startOffset").asDouble() : 0);
            case "RADIAL" -> new PlacementRule.Radial(
                    n.get("count").asInt(),
                    n.hasNonNull("startAngle") ? n.get("startAngle").asDouble() : 0);
            case "EDGE_COUNTS" -> {
                Map<String, Integer> counts = new LinkedHashMap<>();
                n.get("counts").properties()
                        .forEach(e -> counts.put(e.getKey(), e.getValue().asInt()));
                yield new PlacementRule.EdgeCounts(counts);
            }
            case "MANUAL" -> new PlacementRule.Manual();
            default -> throw new IllegalArgumentException("unsupported placement rule: " + kind);
        };
    }

    static PlaceSeatsRequest placeSeatsRequest(JsonNode n) {
        List<SeatOverride> overrides = new ArrayList<>();
        if (n.hasNonNull("overrides")) {
            for (JsonNode o : n.get("overrides")) {
                overrides.add(new SeatOverride(
                        o.get("index").asInt(),
                        o.get("x").asDouble(),
                        o.get("y").asDouble(),
                        o.get("rot").asDouble()));
            }
        }
        return new PlaceSeatsRequest(
                shape(n.get("shape")),
                n.get("clearance").asDouble(),
                rule(n.get("rule")),
                overrides,
                n.hasNonNull("tolerance")
                        ? n.get("tolerance").asDouble()
                        : PlaceSeatsRequest.DEFAULT_TOLERANCE);
    }
}
