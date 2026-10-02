/**
 * How much room something takes up on the floor.
 *
 * <p>Shared because two different features must agree on it. Arranging a room and spacing
 * a selection both have to answer "how wide is this table, really", and the honest answer
 * includes the chairs: a layout that spaces the benches perfectly and leaves their chairs
 * overlapping is one the validator refuses and a person can see is wrong.
 */
import { applyTransform, composeTransform, shapeFromJson, tessellate } from '@seat-booking/geometry';
import type { FurnitureJson, SceneJson, ShapeJson, TransformJson } from '@/api/types';
import type { SelectionItem } from '@/state/editorStore';

/** Matches the canvas, so a measurement agrees with the outline that is drawn. */
export const TOLERANCE = 1e-3;

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const width = (b: Box) => b.maxX - b.minX;
export const height = (b: Box) => b.maxY - b.minY;
export const centreX = (b: Box) => (b.minX + b.maxX) / 2;
export const centreY = (b: Box) => (b.minY + b.maxY) / 2;

export function boundsOf(points: ReadonlyArray<{ x: number; y: number }>): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export const union = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

export const ringOf = (shape: ShapeJson) => tessellate(shapeFromJson(shape), TOLERANCE);

/**
 * How much room a shape takes once turned, around its own origin.
 *
 * <p>A 2.4 × 1.2 table laid sideways needs 1.2 × 2.4. Using the unrotated size would
 * space a row of sideways tables as though they were narrow, and they would collide.
 */
export function rotatedBounds(shape: ShapeJson, rot: number): Box {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return boundsOf(ringOf(shape).map((p) => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  })));
}

/** Offset a box so it sits at a point. */
const at = (box: Box, p: { x: number; y: number }): Box => ({
  minX: box.minX + p.x,
  minY: box.minY + p.y,
  maxX: box.maxX + p.x,
  maxY: box.maxY + p.y,
});

/** Where a table sits on the floor, with its room's own placement taken into account. */
export function tableWorld(scene: SceneJson, table: FurnitureJson): TransformJson {
  const room = scene.rooms.find((r) => r.id === table.roomId);
  return room ? composeTransform(room.transform, table.transform) : table.transform;
}

/**
 * The patch of floor one selected thing occupies, in world metres.
 *
 * <p>For a table that is the table AND its chairs, because the chairs are what collide.
 */
export function worldBox(scene: SceneJson, item: SelectionItem): Box | null {
  if (item.type === 'room') {
    const room = scene.rooms.find((r) => r.id === item.id);
    return room ? at(rotatedBounds(room.shape, room.transform.rot), room.transform) : null;
  }

  if (item.type === 'furniture') {
    const table = scene.furniture.find((f) => f.id === item.id);
    if (!table) return null;
    const world = tableWorld(scene, table);
    let box = at(rotatedBounds(table.shape, world.rot), world);
    for (const seat of scene.seats) {
      if (seat.tableId !== table.id) continue;
      const seatWorld = composeTransform(world, seat.localTransform);
      box = union(box, at(rotatedBounds(seat.shape, seatWorld.rot), seatWorld));
    }
    return box;
  }

  const seat = scene.seats.find((s) => s.id === item.id);
  if (!seat) return null;
  const table = scene.furniture.find((f) => f.id === seat.tableId);
  const parent = table
    ? tableWorld(scene, table)
    : scene.rooms.find((r) => r.id === seat.roomId)?.transform ?? { x: 0, y: 0, rot: 0 };
  const world = composeTransform(parent, seat.localTransform);
  return at(rotatedBounds(seat.shape, world.rot), world);
}

/** Turn a world delta into a frame rotated by `angle`. */
export function rotateDelta(dx: number, dy: number, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

export { applyTransform };
