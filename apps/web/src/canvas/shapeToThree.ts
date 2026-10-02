import * as THREE from 'three';
import { offsetRing, tessellate, shapeFromJson } from '@seat-booking/geometry';
import type { ShapeJson } from '@/api/types';

/** Matches the server's validation tolerance so the two never disagree about an outline. */
export const TESSELLATION_TOLERANCE = 1e-3;

/**
 * One tessellation feeds both views.
 *
 * <p>The 2D authoring view and the 3D walkthrough are built from the same ring, which is
 * why the 3D view cannot drift from the 2D truth: there is no second outline to keep in
 * step.
 */
export function ringFor(shape: ShapeJson): Array<{ x: number; y: number }> {
  return tessellate(shapeFromJson(shape), TESSELLATION_TOLERANCE).map((p) => ({ x: p.x, y: p.y }));
}

export function threeShape(shape: ShapeJson): THREE.Shape {
  const ring = ringFor(shape);
  const s = new THREE.Shape();
  ring.forEach((p, i) => (i === 0 ? s.moveTo(p.x, p.y) : s.lineTo(p.x, p.y)));
  s.closePath();
  return s;
}

/** Flat footprint, drawn on the ground plane for the top-down view. */
export function footprintGeometry(shape: ShapeJson): THREE.ShapeGeometry {
  return new THREE.ShapeGeometry(threeShape(shape));
}

/** The same footprint given height, for the 3D toggle. */
export function extrudedGeometry(shape: ShapeJson, height: number): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(threeShape(shape), {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });
}

/**
 * Walls, not a slab.
 *
 * <p>Extruding the filled footprint gives a solid block of floor, which reads as a plinth
 * rather than a room. Extruding the ring with an inset ring punched out of it gives a
 * wall band you can actually see into and orbit around, and it still comes from the same
 * tessellation as the 2D plan.
 */
export function wallGeometry(shape: ShapeJson, height: number, thickness = 0.12): THREE.ExtrudeGeometry {
  const ring = tessellate(shapeFromJson(shape), TESSELLATION_TOLERANCE);
  const outer = new THREE.Shape();
  ring.forEach((p, i) => (i === 0 ? outer.moveTo(p.x, p.y) : outer.lineTo(p.x, p.y)));
  outer.closePath();

  // Negative distance offsets inward, giving the inner face of the wall.
  const inner = offsetRing(ring, -thickness);
  const hole = new THREE.Path();
  inner.forEach((p, i) => (i === 0 ? hole.moveTo(p.x, p.y) : hole.lineTo(p.x, p.y)));
  hole.closePath();
  outer.holes.push(hole);

  return new THREE.ExtrudeGeometry(outer, { depth: height, bevelEnabled: false, curveSegments: 1 });
}

/** Outline points for drawing a crisp edge on top of a filled footprint. */
export function outlinePoints(shape: ShapeJson): THREE.Vector3[] {
  const ring = ringFor(shape);
  const pts = ring.map((p) => new THREE.Vector3(p.x, p.y, 0));
  if (pts.length > 0) pts.push(pts[0]!.clone());
  return pts;
}
