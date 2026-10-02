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
 * Equalise the gaps, leaving the two at the ends alone.
 *
 * <p>Returns an empty list when there is nothing to do — fewer than three things, or
 * everything already evenly spaced — so the caller can say "already even" rather than
 * reporting a change it did not make.
 */
export function spaceEvenly(scene: SceneJson, selection: readonly SelectionItem[]): Shift[] {
  const measured = measure(scene, selection);
  if (measured.length < 3) return [];

  const axis = axisOf(measured.map((m) => m.box));
  const lo = (b: Box) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: Box) => (axis === 'x' ? b.maxX : b.maxY);
  const size = (b: Box) => hi(b) - lo(b);

  const ordered = [...measured].sort((a, b) => lo(a.box) - lo(b.box));
  const span = hi(ordered[ordered.length - 1]!.box) - lo(ordered[0]!.box);
  const occupied = ordered.reduce((sum, m) => sum + size(m.box), 0);
  // Negative when the things already overlap each other. Spacing cannot fix that — it
  // would have to move the ends — so it lays them edge to edge and leaves the rest to
  // the person, who can see they have asked for more room than the row has.
  const gap = Math.max(0, (span - occupied) / (ordered.length - 1));

  const shifts: Shift[] = [];
  let cursor = lo(ordered[0]!.box);
  for (const m of ordered) {
    const delta = cursor - lo(m.box);
    if (Math.abs(delta) > 1e-9) {
      shifts.push({ item: m.item, dx: axis === 'x' ? delta : 0, dy: axis === 'x' ? 0 : delta });
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
