package com.seatbooking.layout;

import com.seatbooking.geometry.Shape;
import com.seatbooking.geometry.Transform;
import com.seatbooking.geometry.Vec2;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.LineString;
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.geom.Polygon;
import org.locationtech.jts.operation.polygonize.Polygonizer;

/**
 * Derives the areas a room is divided into by its partitions.
 *
 * <p>A partition is drawn as a line, not as a region, so the zones it creates are
 * implied rather than stored. Unioning the room boundary with the partition lines nodes
 * them at every crossing, and {@link Polygonizer} then returns the faces of that
 * arrangement — which is exactly the set of areas a person would see when looking at the
 * drawn plan. Doing it any other way means asking the admin to trace each zone by hand.
 *
 * <p>Derived on read and never stored: the zones are a function of the geometry, so
 * persisting them would just be a cache that can disagree with the plan.
 */
public final class SubZones {

    private SubZones() {}

    /** A zone is named for the order it is read in, top-to-bottom then left-to-right. */
    public record SubZone(int index, String name, double area, List<List<Double>> ring) {}

    public static List<SubZone> derive(Shape roomShape, Transform roomWorld,
                                       List<List<Vec2>> partitionPolylines) {
        Polygon room = Jts.polygon(roomShape, roomWorld);
        if (partitionPolylines.isEmpty()) {
            return List.of();
        }

        // Union the boundary with the partitions so every crossing becomes a node. Without
        // this the polygonizer sees dangling edges and produces nothing.
        Geometry arrangement = room.getBoundary();
        for (List<Vec2> polyline : partitionPolylines) {
            if (polyline.size() < 2) {
                continue;
            }
            LineString line = Jts.lineString(polyline, roomWorld);
            arrangement = arrangement.union(line);
        }

        Polygonizer polygonizer = new Polygonizer();
        polygonizer.add(arrangement);

        List<Polygon> faces = new ArrayList<>();
        for (Object face : polygonizer.getPolygons()) {
            Polygon polygon = (Polygon) face;
            // A partition that stops short of the far wall leaves the room as one face;
            // faces outside the room are artefacts of the union and are dropped.
            Point interior = polygon.getInteriorPoint();
            if (room.covers(interior) && polygon.getArea() > 1e-6) {
                faces.add(polygon);
            }
        }

        // One face means the partitions did not actually divide anything.
        if (faces.size() < 2) {
            return List.of();
        }

        // Read order: top to bottom, then left to right, so names are stable between runs.
        faces.sort(Comparator
                .comparingDouble((Polygon p) -> -p.getCentroid().getY())
                .thenComparingDouble(p -> p.getCentroid().getX()));

        List<SubZone> zones = new ArrayList<>(faces.size());
        for (int i = 0; i < faces.size(); i++) {
            Polygon face = faces.get(i);
            List<List<Double>> ring = new ArrayList<>();
            Coordinate[] coords = face.getExteriorRing().getCoordinates();
            // JTS closes its rings; the wire format does not repeat the first point.
            for (int c = 0; c < coords.length - 1; c++) {
                ring.add(List.of(coords[c].x, coords[c].y));
            }
            zones.add(new SubZone(i, "Zone " + (char) ('A' + i), face.getArea(), ring));
        }
        return zones;
    }
}
