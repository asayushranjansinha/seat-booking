/**
 * Lay a room's tables out on an even grid.
 *
 * <p>Drawn by hand, tables end up approximately aligned — close enough to look deliberate
 * from a distance and wrong the moment anyone measures. Dragging each one into place is
 * slow and never exact, so this computes the whole arrangement at once.
 *
 * <h2>What "evenly" has to mean here</h2>
 *
 * <p>Not "evenly spaced tables". A table is never alone: it carries a ring of chairs that
 * the validator insists must stay inside the room, must not sit on another table, and
 * must not overlap another table's chairs. Spacing the tables evenly while ignoring their
 * chairs produces a layout that looks tidy and refuses to publish. So the unit being
 * spaced is the table PLUS its chair ring, and every cell is the size of the largest one
 * in the zone — a uniform grid is the only kind that reads as even.
 *
 * <h2>Zones, not rooms</h2>
 *
 * <p>A partition divides a room into sub-zones, and tables belong to the side of the
 * partition they were drawn on. Arranging across the whole room would march them straight
 * through the divider. Each zone is therefore arranged independently, and a room with no
 * partitions is simply one zone.
 *
 * <p>Nothing here is sent to the server: it writes ordinary table positions, which the
 * server already knows how to store and validate. That is why it does not need a
 * cross-language twin the way the placement engine does.
 */
import { pointInRing, ringFromJson } from '@seat-booking/geometry';
import {
  boundsOf, height, ringOf, rotatedBounds, width, type Box,
} from '@/editor/extent';
import type { RoomJson, SceneJson, ShapeJson } from '@/api/types';

export interface Move {
  tableId: string;
  x: number;
  y: number;
}

export interface ArrangeResult {
  moves: Move[];
  /**
   * Zones where the tables and their chairs cannot fit at the spacing they need.
   *
   * <p>The arrangement is still produced — refusing outright would leave someone with a
   * messy room and no explanation — but it is reported so the UI can say why the result
   * still looks cramped rather than letting the validator deliver the news later.
   */
  crowded: { zone: string; tables: number; fits: number }[];
}


/**
 * The space one table occupies, chairs included, as a half-width and half-height.
 *
 * <p>Measured from the chairs actually on the table rather than from the placement rule's
 * clearance, because a seat that was dragged out to the side is still a seat the validator
 * will check.
 */
function footprint(scene: SceneJson, tableId: string, shape: ShapeJson, rot: number) {
  const box = rotatedBounds(shape, rot);
  const corners: Array<{ x: number; y: number }> = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.maxY },
  ];
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (const seat of scene.seats) {
    if (seat.tableId !== tableId) continue;
    const seatBox = rotatedBounds(seat.shape, seat.localTransform.rot);
    // The seat sits in the table's frame, so its own offset turns with the table.
    const cx = seat.localTransform.x * cos - seat.localTransform.y * sin;
    const cy = seat.localTransform.x * sin + seat.localTransform.y * cos;
    corners.push({ x: cx + seatBox.minX, y: cy + seatBox.minY });
    corners.push({ x: cx + seatBox.maxX, y: cy + seatBox.maxY });
  }
  const all = boundsOf(corners);
  // Symmetric about the table's own origin: the grid centres tables, so the half-extent
  // that matters is the larger side. A chair on one side only still needs its space.
  return {
    halfW: Math.max(Math.abs(all.minX), Math.abs(all.maxX)),
    halfH: Math.max(Math.abs(all.minY), Math.abs(all.maxY)),
  };
}

/** Do two segments cross? Used to prove a rectangle never leaves the room's outline. */
function segmentsCross(
  a1: { x: number; y: number }, a2: { x: number; y: number },
  b1: { x: number; y: number }, b2: { x: number; y: number },
): boolean {
  const d = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = d(b1, b2, a1);
  const d2 = d(b1, b2, a2);
  const d3 = d(a1, a2, b1);
  const d4 = d(a1, a2, b2);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * Is this rectangle wholly inside the outline?
 *
 * <p>Corners alone are not enough: in an L-shaped room a rectangle can have all four
 * corners inside and still span the missing bite out of the middle. So the outline must
 * also not cross any of its edges.
 */
function rectInsideRing(ring: ReadonlyArray<{ x: number; y: number }>, box: Box): boolean {
  // Tested a hair inside. A rectangular room's usable area IS its outline, so the corners
  // land exactly ON the ring, where a crossing count is a coin toss and a shared edge
  // counts as an intersection. Without this the commonest room in the product loses a
  // strip of itself and every table sits slightly off centre.
  const EPS = 1e-7;
  const corners = [
    { x: box.minX + EPS, y: box.minY + EPS }, { x: box.maxX - EPS, y: box.minY + EPS },
    { x: box.maxX - EPS, y: box.maxY - EPS }, { x: box.minX + EPS, y: box.maxY - EPS },
  ];
  if (!corners.every((c) => pointInRing(ring, c))) return false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    for (let c = 0; c < 4; c++) {
      if (segmentsCross(a, b, corners[c]!, corners[(c + 1) % 4]!)) return false;
    }
  }
  return true;
}

/** Largest all-true axis-aligned rectangle in a boolean grid, by the usual histogram scan. */
function largestTrueRect(grid: boolean[][], cols: number, rows: number) {
  const heights = new Array<number>(cols).fill(0);
  let best = { area: 0, left: 0, right: -1, top: 0, bottom: -1 };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = grid[r]![c] ? heights[c]! + 1 : 0;
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const h = c === cols ? 0 : heights[c]!;
      while (stack.length > 0 && heights[stack[stack.length - 1]!]! >= h) {
        const top = stack.pop()!;
        const left = stack.length === 0 ? 0 : stack[stack.length - 1]! + 1;
        const area = heights[top]! * (c - left);
        if (area > best.area) {
          best = { area, left, right: c - 1, top: r - heights[top]! + 1, bottom: r };
        }
      }
      stack.push(c);
    }
  }
  return best;
}

/**
 * The part of a zone a grid of tables can actually use.
 *
 * <p>The bounding box is the obvious answer and the wrong one. An L-shaped room's box
 * includes the bite taken out of its corner, and a round room's box includes four corners
 * that are solidly outside the wall — so the arrangement puts tables where there is no
 * floor. (That is exactly what it did: a single table in an L-shaped room landed in the
 * notch, because the notch is where the middle of the box is.)
 *
 * <p>So: find the largest rectangle that fits inside the outline, by marking a coarse grid
 * and taking the biggest solid block of it, then push each side back out to the true
 * boundary wherever that is still inside. The push-out matters — without it a plain
 * rectangular room would lose up to a cell of width to the discretisation and the tables
 * would sit very slightly off-centre forever.
 */
function usableArea(ring: ReadonlyArray<{ x: number; y: number }>): Box {
  const box = boundsOf(ring);
  if (rectInsideRing(ring, box)) return box; // the common case: a rectangular room

  const STEP = 0.2;
  const MAX = 160;
  const cols = Math.min(MAX, Math.max(1, Math.ceil(width(box) / STEP)));
  const rows = Math.min(MAX, Math.max(1, Math.ceil(height(box) / STEP)));
  const cw = width(box) / cols;
  const ch = height(box) / rows;

  const grid: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < cols; c++) {
      // Rows run down the room, so row 0 is the top one.
      const cell = {
        minX: box.minX + c * cw,
        maxX: box.minX + (c + 1) * cw,
        minY: box.maxY - (r + 1) * ch,
        maxY: box.maxY - r * ch,
      };
      row.push(rectInsideRing(ring, cell));
    }
    grid.push(row);
  }

  const best = largestTrueRect(grid, cols, rows);
  if (best.area === 0) return box; // nothing fits; let the caller report it as crowded

  let found: Box = {
    minX: box.minX + best.left * cw,
    maxX: box.minX + (best.right + 1) * cw,
    minY: box.maxY - (best.bottom + 1) * ch,
    maxY: box.maxY - best.top * ch,
  };
  // Recover the discretisation loss one side at a time, keeping each push only if the
  // rectangle is still wholly inside.
  for (const side of ['minX', 'maxX', 'minY', 'maxY'] as const) {
    const stretched = { ...found, [side]: box[side] };
    if (rectInsideRing(ring, stretched)) found = stretched;
  }
  return found;
}

/**
 * How many columns to use.
 *
 * <p>Three considerations, in this order of stubbornness.
 *
 * <p>It must FIT: a grid that reaches through the wall is not a tidy grid, and every
 * table in it fails validation.
 *
 * <p>It should fill its rows. Three tables at two columns leaves one stranded alone on a
 * second row, and that reads as a mistake no matter how well the block matches the shape
 * of the room. A column count that divides the tables exactly is worth a lot of
 * proportion.
 *
 * <p>Then it should match the room's proportions, so a long thin zone gets a long thin
 * grid rather than a square one floating in the middle of it.
 */
function columnsFor(count: number, zone: Box, cellW: number, cellH: number): number {
  const target = width(zone) / Math.max(height(zone), 1e-9);
  let best = 1;
  let bestScore = Infinity;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const fits = cols * cellW <= width(zone) + 1e-9 && rows * cellH <= height(zone) + 1e-9;
    const ragged = count % cols !== 0;
    const ratio = (cols * cellW) / Math.max(rows * cellH, 1e-9);
    const score =
      (fits ? 0 : 1000) + (ragged ? 10 : 0) + Math.abs(Math.log(ratio / target));
    if (score < bestScore) {
      bestScore = score;
      best = cols;
    }
  }
  return best;
}

/** The ring of each sub-zone, in room-local coordinates, or the room itself if undivided. */
function zonesOf(room: RoomJson): { name: string; ring: ReadonlyArray<{ x: number; y: number }> }[] {
  const subZones = room.subZones ?? [];
  if (subZones.length > 1) {
    return subZones.map((z) => ({ name: z.name, ring: ringFromJson(z.ring) }));
  }
  return [{ name: room.name, ring: ringOf(room.shape) }];
}

/**
 * Arrange every table in a room onto an even grid, one grid per sub-zone.
 *
 * <p>Returns the moves rather than applying them, so the caller can put the whole
 * arrangement into a single undo step.
 */
export function arrangeTablesEvenly(scene: SceneJson, roomId: string): ArrangeResult {
  const room = scene.rooms.find((r) => r.id === roomId);
  if (!room) return { moves: [], crowded: [] };

  const tables = scene.furniture.filter((f) => f.roomId === roomId);
  if (tables.length === 0) return { moves: [], crowded: [] };

  const zones = zonesOf(room);
  const moves: Move[] = [];
  const crowded: ArrangeResult['crowded'] = [];

  // A table belongs to the zone its centre is in. One that sits exactly on a partition
  // belongs to the first zone that claims it, which is as good an answer as any and at
  // least a stable one.
  const claimed = new Set<string>();
  const groups = zones.map((zone) => {
    const mine = tables.filter(
      (t) => !claimed.has(t.id) && pointInRing(zone.ring, { x: t.transform.x, y: t.transform.y }),
    );
    for (const t of mine) claimed.add(t.id);
    return { zone, tables: mine };
  });
  // Anything outside every zone — drawn on a partition line, or left behind when the room
  // was reshaped — joins the first zone rather than being silently skipped.
  const strays = tables.filter((t) => !claimed.has(t.id));
  if (strays.length > 0 && groups[0]) groups[0].tables.push(...strays);

  for (const { zone, tables: group } of groups) {
    if (group.length === 0) continue;

    // Not boundsOf(): see usableArea. A room is rarely the rectangle its extents suggest.
    const bounds = usableArea(zone.ring);
    const prints = group.map((t) => footprint(scene, t.id, t.shape, t.transform.rot));
    // One cell size for the whole zone. Sizing each cell to its own table would space the
    // tables unequally, which is the thing being fixed.
    const cellW = Math.max(...prints.map((p) => p.halfW)) * 2;
    const cellH = Math.max(...prints.map((p) => p.halfH)) * 2;

    const cols = columnsFor(group.length, bounds, cellW, cellH);
    const rows = Math.ceil(group.length / cols);

    const fitsAcross = Math.max(1, Math.floor(width(bounds) / Math.max(cellW, 1e-9)));
    const fitsDown = Math.max(1, Math.floor(height(bounds) / Math.max(cellH, 1e-9)));
    if (cols * cellW > width(bounds) + 1e-9 || rows * cellH > height(bounds) + 1e-9) {
      crowded.push({ zone: zone.name, tables: group.length, fits: fitsAcross * fitsDown });
    }

    // Tables keep the order they appear to be in now — top row first, left to right — so
    // arranging a room changes the spacing and not the seating plan.
    //
    // Sorting by y alone will not do it. Three tables meant to be one row are never at
    // exactly the same y once they have been placed by hand, and 1.2 against 0.9 is not a
    // second row, it is a wobble. So the tables are banded into rows of `cols` by height
    // first, and only then read left to right within each band — which is how someone
    // looking at the room would describe where things are.
    const byHeight = [...group].sort((a, b) => b.transform.y - a.transform.y);
    const ordered = byHeight.flatMap((_, i) =>
      i % cols === 0
        ? byHeight.slice(i, i + cols).sort((a, b) => a.transform.x - b.transform.x)
        : [],
    );

    // Equal gaps, including half a gap against each wall: stepping by the full span and
    // centring within each step is what makes the margins look deliberate.
    const stepX = width(bounds) / cols;
    const stepY = height(bounds) / rows;

    ordered.forEach((table, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      moves.push({
        tableId: table.id,
        x: bounds.minX + stepX * (col + 0.5),
        // Rows run down the room, and y grows upward, so the first row is the top one.
        y: bounds.maxY - stepY * (row + 0.5),
      });
    });
  }

  return { moves, crowded };
}

/** Whether anything would actually move, so the UI can stay quiet when it would not. */
export function wouldChange(scene: SceneJson, moves: readonly Move[]): boolean {
  return moves.some((m) => {
    const t = scene.furniture.find((f) => f.id === m.tableId);
    if (!t) return false;
    return Math.abs(t.transform.x - m.x) > 1e-6 || Math.abs(t.transform.y - m.y) > 1e-6;
  });
}

