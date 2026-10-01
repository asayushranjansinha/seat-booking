package com.seatbooking.layout;

import com.seatbooking.geometry.Shape;
import com.seatbooking.geometry.Tessellation;
import com.seatbooking.geometry.Transform;
import com.seatbooking.geometry.Vec2;
import java.util.List;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.LineString;
import org.locationtech.jts.geom.Polygon;

/**
 * Bridges the shape model to JTS.
 *
 * <p>Everything reaches JTS as a plain polygon ring, because {@code tessellate} has
 * already reduced every shape kind to one. JTS then supplies {@code contains},
 * {@code intersects}, {@code isSimple} and {@code Polygonizer}, so no computational
 * geometry is hand-written on the path where correctness actually counts.
 */
public final class Jts {

    /** 1mm. Fine enough that tessellation error never decides a containment test. */
    public static final double TOLERANCE = 1e-3;

    private static final GeometryFactory FACTORY = new GeometryFactory();

    private Jts() {}

    /** Tessellate in local space, then lift every vertex into world space. */
    public static Polygon polygon(Shape shape, Transform world) {
        List<Vec2> ring = Tessellation.tessellate(shape, TOLERANCE);
        Coordinate[] coords = new Coordinate[ring.size() + 1];
        for (int i = 0; i < ring.size(); i++) {
            Vec2 p = world.apply(ring.get(i));
            coords[i] = new Coordinate(p.x(), p.y());
        }
        coords[ring.size()] = coords[0]; // JTS wants an explicitly closed ring
        return FACTORY.createPolygon(coords);
    }

    public static LineString lineString(List<Vec2> points, Transform world) {
        Coordinate[] coords = new Coordinate[points.size()];
        for (int i = 0; i < points.size(); i++) {
            Vec2 p = world.apply(points.get(i));
            coords[i] = new Coordinate(p.x(), p.y());
        }
        return FACTORY.createLineString(coords);
    }

    public static GeometryFactory factory() {
        return FACTORY;
    }
}
