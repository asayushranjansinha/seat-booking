/**
 * Even out a selection that was placed by hand.
 *
 * <p>Different from arranging a room. Arranging decides where tables go; this only
 * adjusts the ones already chosen, and deliberately keeps the two at the ends exactly
 * where they are. Someone who has positioned the first and last bench against the walls
 * is asking for the gaps in between to be equalised, not for the row to be re-sited.
 *
 * <p>Both operations work on the full footprint — table plus chairs — because that is
 * what actually touches. Equal gaps measured between table edges leaves chair rings
 * overlapping wherever the tables are different sizes, which is most floors.
 */
import { pointInRing } from '@seat-booking/geometry';
import { usableArea, zonesOf } from '@/editor/arrange';
import { centreX, centreY, height, union, width, worldBox, type Box } from '@/editor/extent';
import type { SceneJson } from '@/api/types';
import type { SelectionItem } from '@/state/editorStore';

/** How far one thing has to move, in world metres. */
export interface Shift {
  item: SelectionItem;
  dx: number;
  dy: number;
}

/** Which way the selection runs. */
export type Axis = 'x' | 'y';

interface Measured {
  item: SelectionItem;
  box: Box;
}

/**
 * Only rooms and tables take part.
 *
 * <p>A seat's position is owned by its table's placement rule; nudging one into a line
 * would pin it, and the next regeneration would move everything around it. If someone has
 * swept up seats along with tables, the seats are left alone rather than quietly pinned.
 */
function measure(scene: SceneJson, selection: readonly SelectionItem[]): Measured[] {
  const out: Measured[] = [];
  for (const item of selection) {
    if (item.type === 'seat') continue;
    const box = worldBox(scene, item);
    if (box) out.push({ item, box });
  }
  return out;
}

/**
 * Which way a selection runs.
 *
 * <p>Decided by the selection's own proportions rather than asked for: a row of benches
 * is wider than it is tall, and nobody who has just swept up a row wants to be asked
 * whether it is a row.
 */
export function axisOf(boxes: readonly Box[]): Axis {
  if (boxes.length === 0) return 'x';
  const overall = boxes.reduce(union);
  return width(overall) >= height(overall) ? 'x' : 'y';
}

/**
 * The stretch of floor a selection is being spaced within.
 *
 * <p>The partition a row sits behind, or the room when there is no partition. Measured as
 * the largest rectangle that actually fits inside the outline, so an L-shaped room does
 * not offer up the bite out of its corner as somewhere to put a table.
 */
function containerOf(scene: SceneJson, measured: readonly Measured[]): Box | null {
  const first = measured.find((m) => m.item.type === 'furniture');
  if (!first) return null;
  const table = scene.furniture.find((f) => f.id === first.item.id);
  const room = scene.rooms.find((r) => r.id === table?.roomId);
  if (!room) return null;

  // Zone rings are stored in the room's frame; the boxes being spaced are in world. With
  // the room at an angle there is no axis-aligned answer at all, so spacing falls back to
  // the selection's own span rather than inventing one.
  if (room.transform.rot !== 0) return null;

  const centre = { x: centreX(first.box) - room.transform.x, y: centreY(first.box) - room.transform.y };
  const zones = zonesOf(room);
  const zone = zones.find((z) => pointInRing(z.ring, centre)) ?? zones[0];
  if (!zone) return null;

  const local = usableArea(zone.ring);
  return {
    minX: local.minX + room.transform.x,
    maxX: local.maxX + room.transform.x,
    minY: local.minY + room.transform.y,
    maxY: local.maxY + room.transform.y,
  };
}

/**
 * Space the selection evenly across the floor it sits on.
 *
 * <p>Every gap the same: wall to the first, between each pair, the last to the wall. An
 * earlier version equalised only the gaps BETWEEN things and pinned the two at the ends,
 * which is what Figma does to a selection floating on a canvas. On a floor plan it is the
 * wrong answer and it looks wrong: the tables end up perfectly spaced from each other and
 * visibly off-centre in the room, which is exactly the complaint it was meant to fix.
 *
 * <p>Falls back to holding the ends when there is no container to measure against — a
 * selection spanning two rooms, or sitting in a room that has been rotated.
 */
export function spaceEvenly(scene: SceneJson, selection: readonly SelectionItem[]): Shift[] {
  const measured = measure(scene, selection);
  if (measured.length < 2) return [];

  const axis = axisOf(measured.map((m) => m.box));
  const lo = (b: Box) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: Box) => (axis === 'x' ? b.maxX : b.maxY);
  const size = (b: Box) => hi(b) - lo(b);

  const ordered = [...measured].sort((a, b) => lo(a.box) - lo(b.box));
  const occupied = ordered.reduce((sum, m) => sum + size(m.box), 0);

  const container = containerOf(scene, ordered);
  // Spacing inside the room divides the floor into n + 1 gaps — one against each wall and
  // one between each pair. Without a container there is no wall to measure to, so the
  // selection's own span is divided into the n - 1 gaps between its members instead, and
  // the outermost two stay put.
  const sameRoomSpan = container
    ? hi(container) - lo(container)
    : hi(ordered[ordered.length - 1]!.box) - lo(ordered[0]!.box);
  const slots = container ? ordered.length + 1 : ordered.length - 1;
  if (slots <= 0) return [];

  // Negative when the things do not fit. Spacing cannot conjure room, so they go edge to
  // edge from the start and the person can see they have asked for more than there is.
  const gap = Math.max(0, (sameRoomSpan - occupied) / slots);

  // Spacing a row settles where it sits ALONG the floor; it says nothing about how far
  // down the floor it sits. Leaving that alone produced rows that were evenly spaced left
  // to right and visibly high or low in their own partition — 79 mm of floor above one
  // row and 130 below it. So the group is also centred across its container, as a whole:
  // every member moves by the same amount, which settles the row without flattening the
  // arrangement within it. Putting them all on one line is what "Line up" is for.
  const across = axis === 'x'
    ? { lo: (b: Box) => b.minY, hi: (b: Box) => b.maxY }
    : { lo: (b: Box) => b.minX, hi: (b: Box) => b.maxX };
  const groupBox = ordered.map((m) => m.box).reduce(union);
  const crossDelta = container
    ? ((across.lo(container) + across.hi(container)) / 2)
      - ((across.lo(groupBox) + across.hi(groupBox)) / 2)
    : 0;

  const shifts: Shift[] = [];
  let cursor = container ? lo(container) + gap : lo(ordered[0]!.box);
  for (const m of ordered) {
    const along = cursor - lo(m.box);
    const dx = axis === 'x' ? along : crossDelta;
    const dy = axis === 'x' ? crossDelta : along;
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
      shifts.push({ item: m.item, dx, dy });
    }
    cursor += size(m.box) + gap;
  }
  return shifts;
}

/**
 * Line the selection up across its run: a row onto one horizontal line, a column onto one
 * vertical one.
 *
 * <p>Aligned to the CENTRE of what is selected, so the row stays where it is rather than
 * jumping to wherever its topmost member happened to be.
 */
export function alignAcross(scene: SceneJson, selection: readonly SelectionItem[]): Shift[] {
  const measured = measure(scene, selection);
  if (measured.length < 2) return [];

  const axis = axisOf(measured.map((m) => m.box));
  const across = axis === 'x' ? centreY : centreX;
  const target = across(measured.map((m) => m.box).reduce(union));

  const shifts: Shift[] = [];
  for (const m of measured) {
    const delta = target - across(m.box);
    if (Math.abs(delta) > 1e-9) {
      shifts.push({ item: m.item, dx: axis === 'x' ? 0 : delta, dy: axis === 'x' ? delta : 0 });
    }
  }
  return shifts;
}
