package com.seatbooking.layout;

import com.seatbooking.geometry.Shape;
import com.seatbooking.geometry.Transform;
import com.seatbooking.geometry.Vec2;
import java.util.ArrayList;
import java.util.List;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Wire format to geometry model. On the wire a point is the compact tuple [x, y], which
 * is the single representation shared with the TypeScript engine and the fixtures.
 */
public final class GeometryJson {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private GeometryJson() {}

    public static Shape shape(JsonNode n) {
        if (n == null || n.isNull()) {
            throw new IllegalArgumentException("shape is required");
        }
        String kind = n.path("kind").asString();
        return switch (kind) {
            case "RECT" -> new Shape.Rect(n.path("w").asDouble(), n.path("h").asDouble());
            case "CIRCLE" -> new Shape.Circle(n.path("r").asDouble());
            case "ELLIPSE" -> new Shape.Ellipse(n.path("rx").asDouble(), n.path("ry").asDouble());
            case "POLYGON" -> new Shape.Polygon(points(n.path("points")));
            default -> throw new IllegalArgumentException("unsupported shape kind: " + kind);
        };
    }

    public static Transform transform(JsonNode n) {
        if (n == null || n.isNull()) {
            throw new IllegalArgumentException("transform is required");
        }
        return new Transform(
                n.path("x").asDouble(), n.path("y").asDouble(), n.path("rot").asDouble());
    }

    public static List<Vec2> points(JsonNode n) {
        List<Vec2> out = new ArrayList<>();
        for (JsonNode p : n) {
            out.add(new Vec2(p.get(0).asDouble(), p.get(1).asDouble()));
        }
        return out;
    }

    public static String toJson(JsonNode node) {
        return node == null || node.isNull() ? null : node.toString();
    }

    public static JsonNode parse(String json) {
        return json == null ? null : MAPPER.readTree(json);
    }
}
