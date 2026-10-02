/**
 * Cutting a room into even bands.
 *
 * <p>Drawing a partition by hand asks for two clicks on two walls, and the line between
 * them is only as square as the two clicks were. At the scale a floor is drawn, a few
 * pixels of difference between the ends is a visibly crooked wall — and a room of desk
 * rows needs several of them, each crooked in its own direction.
 *
 * <p>So this is the other way to make one: say how many bands the room should have, and
 * the cuts are derived from the outline rather than aimed at it. They are exactly
 * parallel, exactly evenly spaced, and they meet the boundary because they are computed
 * from where they cross it.
 *
 * <p>Its own module because it is arithmetic, and arithmetic inside a React handler is
 * arithmetic nothing can test.
 */
import { shapeFromJson, tessellate, type Vec2 } from '@seat-booking/geometry';
import type { ShapeJson, Vec2Json } from '@/api/types';

/** Which way the partitions RUN. Horizontal ones stack the room into rows. */
export type DivideAxis = 'HORIZONTAL' | 'VERTICAL';

/** How finely a curve is flattened before it is cut: well under a wall's thickness. */
const TOLERANCE = 0.02;

/** How many partitions it takes to make this many bands. */
export function partitionsForBands(bands: number): number {
  return Math.max(0, Math.floor(bands) - 1);
}

/** How many partitions a columns-by-rows grid needs. */
export function partitionsForGrid(columns: number, rows: number): number {
  return partitionsForBands(columns) + partitionsForBands(rows);
}

/** How many cells a columns-by-rows grid leaves behind. */
export function cellsForGrid(columns: number, rows: number): number {
  return Math.max(1, Math.floor(columns)) * Math.max(1, Math.floor(rows));
}

/**
 * Where a straight cut crosses the outline.
 *
 * <p>Takes the OUTERMOST pair of crossings rather than consecutive ones, so an L-shaped
 * or notched room gets a partition that spans it completely instead of one that stops at
 * the first re-entrant corner. A cut through a notch therefore crosses the gap as well,
 * which is the honest reading of "divide this room in three".
 */
function cutAt(ring: readonly Vec2[], at: number, axis: DivideAxis): [Vec2Json, Vec2Json] | null {
  const along = (p: Vec2) => (axis === 'HORIZONTAL' ? p.x : p.y);
  const across = (p: Vec2) => (axis === 'HORIZONTAL' ? p.y : p.x);

  const hits: number[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const dp = across(p) - at;
    const dq = across(q) - at;
    // Half-open on purpose: a vertex sitting exactly on the line belongs to one of its
    // two edges, not both, or every such vertex would register as a doubled crossing.
    if ((dp <= 0 && dq > 0) || (dq <= 0 && dp > 0)) {
      hits.push(along(p) + (dp / (dp - dq)) * (along(q) - along(p)));
    }
  }
  if (hits.length < 2) return null;

  const lo = Math.min(...hits);
  const hi = Math.max(...hits);
  // A cut that grazes a corner has two crossings and no length. It would be a partition
  // of nothing, and the validator would reject it.
  if (hi - lo < 1e-6) return null;

  return axis === 'HORIZONTAL' ? [[lo, at], [hi, at]] : [[at, lo], [at, hi]];
}

/**
 * The cuts that divide a room into {@code bands} even strips, in the room's own frame.
 *
 * <p>Spaced across the outline's extent, so the bands are equal in depth whatever shape
 * the room is. Returns one fewer than the band count — three rows need two walls — and
 * nothing at all for a band count below two.
 */
export function dividingCuts(
  shape: ShapeJson, axis: DivideAxis, bands: number,
): Array<[Vec2Json, Vec2Json]> {
  const n = Math.floor(bands);
  if (n < 2) return [];

  const ring = tessellate(shapeFromJson(shape), TOLERANCE);
  if (ring.length < 3) return [];

  const across = (p: Vec2) => (axis === 'HORIZONTAL' ? p.y : p.x);
  const values = ring.map(across);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi - lo < 1e-6) return [];

  const cuts: Array<[Vec2Json, Vec2Json]> = [];
  for (let i = 1; i < n; i += 1) {
    const seg = cutAt(ring, lo + ((hi - lo) * i) / n, axis);
    if (seg) cuts.push(seg);
  }
  return cuts;
}

/**
 * The cuts that divide a room into a grid of cabins, in the room's own frame.
 *
 * <p>Both directions in one go, because they have to be: a room is cut into four columns
 * and three rows at the same time or not at all, and doing it in two passes means the
 * second one has to know not to throw the first one away.
 *
 * <p>The two sets cross, which is exactly what makes the cells. The server unions every
 * partition with the room boundary before polygonising, so each crossing becomes a node
 * and the faces come back as the twelve cabins rather than as five overlapping strips.
 *
 * <p>A count of one in either direction simply contributes nothing, so 4 x 1 is four
 * columns and no rows.
 */
export function gridCuts(
  shape: ShapeJson, columns: number, rows: number,
): Array<[Vec2Json, Vec2Json]> {
  return [
    ...dividingCuts(shape, 'VERTICAL', columns),
    ...dividingCuts(shape, 'HORIZONTAL', rows),
  ];
}
