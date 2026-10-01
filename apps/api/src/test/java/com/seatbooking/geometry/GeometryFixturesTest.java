package com.seatbooking.geometry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import tools.jackson.databind.JsonNode;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Pins the Java geometry engine to the golden fixtures in packages/geometry-fixtures.
 * The TypeScript engine in packages/geometry is pinned to the SAME files, so these two
 * suites passing together is the real proof that the two implementations agree.
 *
 * <p>Do not fix a failure here by editing one implementation to match the other. Change
 * the fixture first; see packages/geometry-fixtures/README.md.
 */
class GeometryFixturesTest {

    /** Positions agree to 1e-6. Integers must agree exactly. */
    private static final double TOL = 1e-6;

    private static void assertVec(Vec2 got, JsonNode want, String what) {
        assertEquals(want.get(0).asDouble(), got.x(), TOL, what + ".x");
        assertEquals(want.get(1).asDouble(), got.y(), TOL, what + ".y");
    }

    private static void assertRing(List<Vec2> got, JsonNode want, String what) {
        // Vertex count must match EXACTLY. A differing count means the engines disagree
        // on a discrete decision (segment count, or whether a corner bevelled), which no
        // positional tolerance should ever paper over.
        assertEquals(want.size(), got.size(), what + ": vertex count");
        for (int i = 0; i < got.size(); i++) {
            assertVec(got.get(i), want.get(i), what + "[" + i + "]");
        }
    }

    @TestFactory
    Stream<DynamicTest> segmentCountForArc() {
        return Fixtures.load("segment-count.json").stream()
                .map(c -> dynamicTest(c.name(), () -> assertEquals(
                        c.expected().get("n").asInt(),
                        Tessellation.segmentCountForArc(
                                c.input().get("radius").asDouble(),
                                c.input().get("tolerance").asDouble()),
                        "segment count must match exactly, not within tolerance")));
    }

    @TestFactory
    Stream<DynamicTest> tessellate() {
        return Fixtures.load("tessellate.json").stream()
                .map(c -> dynamicTest(c.name(), () -> assertRing(
                        Tessellation.tessellate(
                                Fixtures.shape(c.input().get("shape")),
                                c.input().get("tolerance").asDouble()),
                        c.expected().get("ring"),
                        c.name())));
    }

    @TestFactory
    Stream<DynamicTest> transforms() {
        return Fixtures.load("transform.json").stream().map(c -> dynamicTest(c.name(), () -> {
            switch (c.op()) {
                case "compose" -> {
                    Transform got = Fixtures.transform(c.input().get("parent"))
                            .compose(Fixtures.transform(c.input().get("child")));
                    assertEquals(c.expected().get("x").asDouble(), got.x(), TOL, "x");
                    assertEquals(c.expected().get("y").asDouble(), got.y(), TOL, "y");
                    assertEquals(c.expected().get("rot").asDouble(), got.rot(), TOL, "rot");
                }
                case "apply" -> assertVec(
                        Fixtures.transform(c.input().get("transform"))
                                .apply(Fixtures.vec(c.input().get("point"))),
                        c.expected().get("point"),
                        c.name());
                case "invert" -> {
                    Transform got = Fixtures.transform(c.input().get("transform")).invert();
                    assertEquals(c.expected().get("x").asDouble(), got.x(), TOL, "x");
                    assertEquals(c.expected().get("y").asDouble(), got.y(), TOL, "y");
                    assertEquals(c.expected().get("rot").asDouble(), got.rot(), TOL, "rot");
                }
                default -> throw new IllegalStateException("unknown op " + c.op());
            }
        }));
    }

    @TestFactory
    Stream<DynamicTest> ringMetrics() {
        return Fixtures.load("ring-metrics.json").stream().map(c -> dynamicTest(c.name(), () -> {
            List<Vec2> ring = Fixtures.ring(c.input().get("ring"));
            assertEquals(c.expected().get("area").asDouble(),
                    Tessellation.ringSignedArea(ring), TOL, "area");
            assertEquals(c.expected().get("perimeter").asDouble(),
                    Rings.perimeter(ring), TOL, "perimeter");
            assertVec(Rings.centroid(ring), c.expected().get("centroid"), c.name() + " centroid");
        }));
    }

    @TestFactory
    Stream<DynamicTest> pointInRing() {
        return Fixtures.load("point-in-ring.json").stream()
                .map(c -> dynamicTest(c.name(), () -> assertEquals(
                        c.expected().get("inside").asBoolean(),
                        Rings.pointInRing(
                                Fixtures.ring(c.input().get("ring")),
                                Fixtures.vec(c.input().get("point"))),
                        c.name())));
    }

    @TestFactory
    Stream<DynamicTest> pointAtArcLength() {
        return Fixtures.load("arc-length.json").stream().map(c -> dynamicTest(c.name(), () -> {
            Rings.ArcSample got = Rings.pointAtArcLength(
                    Fixtures.ring(c.input().get("ring")), c.input().get("s").asDouble());
            assertVec(got.point(), c.expected().get("point"), c.name() + " point");
            assertVec(got.tangent(), c.expected().get("tangent"), c.name() + " tangent");
            assertVec(got.outwardNormal(), c.expected().get("outwardNormal"), c.name() + " normal");
        }));
    }

    @TestFactory
    Stream<DynamicTest> offsetRing() {
        return Fixtures.load("offset-ring.json").stream()
                .map(c -> dynamicTest(c.name(), () -> assertRing(
                        Offsets.offsetRing(
                                Fixtures.ring(c.input().get("ring")),
                                c.input().get("distance").asDouble()),
                        c.expected().get("ring"),
                        c.name())));
    }

    private static void assertSeats(Fixtures.Case c) {
        List<SeatPlacement> got = Placement.placeSeats(Fixtures.placeSeatsRequest(c.input()));
        JsonNode want = c.expected().get("seats");
        assertEquals(want.size(), got.size(), c.name() + ": seat count");
        for (int i = 0; i < got.size(); i++) {
            SeatPlacement s = got.get(i);
            JsonNode w = want.get(i);
            String at = c.name() + "[" + i + "]";
            assertEquals(w.get("index").asInt(), s.index(), at + ".index");
            assertEquals(w.get("override").asBoolean(), s.override(), at + ".override");
            assertEquals(w.get("x").asDouble(), s.x(), TOL, at + ".x");
            assertEquals(w.get("y").asDouble(), s.y(), TOL, at + ".y");
            assertEquals(w.get("rot").asDouble(), s.rot(), TOL, at + ".rot");
        }
    }

    @TestFactory
    Stream<DynamicTest> placeSeats() {
        return Fixtures.load("place-seats.json").stream()
                .map(c -> dynamicTest(c.name(), () -> assertSeats(c)));
    }

    @TestFactory
    Stream<DynamicTest> headlineRequirement() {
        return Fixtures.load("headline.json").stream()
                .map(c -> dynamicTest(c.name(), () -> assertSeats(c)));
    }

    @TestFactory
    Stream<DynamicTest> fixturesAreActuallyPresent() {
        return Stream.of(dynamicTest(
                "fixture directory resolves to " + Fixtures.DIR,
                () -> assertFalse(
                        Fixtures.load("headline.json").isEmpty(),
                        "no fixtures found: a silently empty suite proves nothing")));
    }
}
