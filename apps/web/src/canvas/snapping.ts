import { applyTransform, composeTransform, tessellate, shapeFromJson } from '@seat-booking/geometry';
import type { RoomJson, SceneJson, TransformJson } from '@/api/types';

export interface Vec2 {
  x: number;
  y: number;
}

/** How close, in metres, the pointer must be for a wall or edge to take hold. */
export const SNAP_DISTANCE = 0.3;

function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, t, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

/** A room's outline in world space, as a list of wall segments. */
export function wallsOf(room: RoomJson): Array<{ edgeIdx: number; a: Vec2; b: Vec2 }> {
  const ring = tessellate(shapeFromJson(room.shape), 1e-3).map((p) => applyTransform(room.transform, p));
  return ring.map((a, i) => ({ edgeIdx: i, a, b: ring[(i + 1) % ring.length]! }));
}

export interface WallHit {
  roomId: string;
  edgeIdx: number;
  /** Position along the wall, 0 to 1. */
  t: number;
  point: Vec2;
  distance: number;
  wallLength: number;
}

/** The wall nearest a world point, across every room. Used to place gates and partitions. */
export function nearestWall(scene: SceneJson, p: Vec2, maxDistance = Infinity): WallHit | null {
  let best: WallHit | null = null;
  for (const room of scene.rooms) {
    for (const wall of wallsOf(room)) {
      const hit = closestPointOnSegment(p, wall.a, wall.b);
      if (hit.distance <= maxDistance && (best === null || hit.distance < best.distance)) {
        best = {
          roomId: room.id,
          edgeIdx: wall.edgeIdx,
          t: hit.t,
          point: hit.point,
          distance: hit.distance,
          wallLength: Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y),
        };
      }
    }
  }
  return best;
}

/** Which room contains a world point, if any. */
export function roomAt(scene: SceneJson, p: Vec2): RoomJson | null {
  for (const room of scene.rooms) {
    const walls = wallsOf(room);
    let inside = false;
    for (const { a, b } of walls) {
      if (a.y > p.y !== b.y > p.y) {
        const xCross = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
        if (p.x < xCross) inside = !inside;
      }
    }
    if (inside) return room;
  }
  return null;
}

/**
 * Pull a dragged position onto a nearby wall or table edge.
 *
 * <p>Grid snapping alone is not enough in a drawing tool: a seat is meant to sit against
 * a table and a table against a wall, and a 0.25m grid will not land on either unless the
 * wall happens to be on the grid. This snaps to the geometry that is actually there, and
 * returns the lines it latched onto so the canvas can draw them.
 */
export function snapToGeometry(
  scene: SceneJson,
  world: Vec2,
  excludeId: string,
): { point: Vec2; guides: Array<[Vec2, Vec2]> } {
  const guides: Array<[Vec2, Vec2]> = [];
  let best: { point: Vec2; distance: number; segment: [Vec2, Vec2] } | null = null;

  const consider = (a: Vec2, b: Vec2) => {
    const hit = closestPointOnSegment(world, a, b);
    if (hit.distance <= SNAP_DISTANCE && (best === null || hit.distance < best.distance)) {
      best = { point: hit.point, distance: hit.distance, segment: [a, b] };
    }
  };

  for (const room of scene.rooms) {
    if (room.id === excludeId) continue;
    for (const wall of wallsOf(room)) consider(wall.a, wall.b);
  }

  for (const table of scene.furniture) {
    if (table.id === excludeId) continue;
    const room = scene.rooms.find((r) => r.id === table.roomId);
    if (!room) continue;
    const world2: TransformJson = composeTransform(room.transform, table.transform);
    const ring = tessellate(shapeFromJson(table.shape), 1e-3).map((p) => applyTransform(world2, p));
    ring.forEach((a, i) => consider(a, ring[(i + 1) % ring.length]!));
  }

  if (best === null) return { point: world, guides };
  const hit = best as { point: Vec2; distance: number; segment: [Vec2, Vec2] };
  guides.push(hit.segment);
  return { point: hit.point, guides };
}
