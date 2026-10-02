/**
 * Spacing and lining up a selection.
 *
 * <p>The cases that matter are the ones a plausible implementation gets wrong: moving the
 * things at the ends, measuring the table instead of the table-and-chairs, and spacing by
 * centres rather than by gaps — which looks right only while every object is the same
 * size, and this floor's are not.
 */
import { describe, expect, it } from 'vitest';
import { alignAcross, axisOf, spaceEvenly } from './distribute';
import type { FurnitureJson, SceneJson, SeatJson } from '@/api/types';
import type { SelectionItem } from '@/state/editorStore';

const ROOM = 'room-1';

/** A table `w` wide at (x, y), with no chairs unless asked for. */
function table(id: string, x: number, y: number, w = 2, h = 1): FurnitureJson {
  return {
    id, roomId: ROOM, kind: 'TABLE', label: id,
    shape: { kind: 'RECT', w, h },
    transform: { x, y, rot: 0 },
    height: 0.75,
  };
}

/** One chair, `offset` metres to the left of its table's centre. */
function chair(tableId: string, offset: number): SeatJson {
  return {
    id: `${tableId}-s`, roomId: ROOM, tableId,
    code: `${tableId}1`,
    shape: { kind: 'RECT', w: 0.4, h: 0.4 },
    localTransform: { x: offset, y: 0, rot: 0 },
    placement: { kind: 'PERIMETER_EVEN', count: 1, clearance: 0.45 },
    seatIndex: 0, override: false, bookable: true, hourlyRate: null,
  };
}

function scene(furniture: FurnitureJson[], seats: SeatJson[] = []): SceneJson {
  return {
    planVersionId: 'v', floorId: 'f', status: 'DRAFT', revision: 1,
    rooms: [{
      id: ROOM, name: 'Studio',
      shape: { kind: 'RECT', w: 60, h: 40 },
      transform: { x: 0, y: 0, rot: 0 },
      height: 2.7, hourlyRate: null, partitions: [], gates: [],
    }],
    furniture,
    seats,
  };
}

const pick = (...ids: string[]): SelectionItem[] =>
  ids.map((id) => ({ type: 'furniture', id }));

/** Where a table ends up after the shifts are applied. */
function placed(s: SceneJson, shifts: ReturnType<typeof spaceEvenly>, id: string): number {
  const base = s.furniture.find((f) => f.id === id)!.transform.x;
  return base + (shifts.find((x) => x.item.id === id)?.dx ?? 0);
}

describe('spaceEvenly', () => {
  it('leaves the two at the ends exactly where they are', () => {
    // Someone has put the first and last bench against the walls. Moving either of them
    // is not "evening out the gaps", it is re-siting the row.
    const s = scene([table('a', 0, 0), table('b', 5, 0), table('c', 20, 0)]);
    const shifts = spaceEvenly(s, pick('a', 'b', 'c'));
    expect(shifts.map((x) => x.item.id)).not.toContain('a');
    expect(shifts.map((x) => x.item.id)).not.toContain('c');
    expect(placed(s, shifts, 'b')).toBeCloseTo(10, 9);
  });

  it('equalises the GAPS, not the centres', () => {
    // The sizes have to differ at BOTH ends for this to prove anything: with three equal
    // tables, or even a symmetric arrangement, spacing by gaps and spacing by centres
    // give the same answer and the test passes either way.
    //
    // a is 2 wide, b is 6, c is 10. Even gaps put b's centre at 8; even centres would put
    // it at 10, leaving a gap of 4 on one side and 2 on the other.
    const s = scene([table('a', 0, 0, 2), table('b', 9, 0, 6), table('c', 20, 0, 10)]);
    const shifts = spaceEvenly(s, pick('a', 'b', 'c'));
    const x = { a: placed(s, shifts, 'a'), b: placed(s, shifts, 'b'), c: placed(s, shifts, 'c') };
    expect((x.b - 3) - (x.a + 1)).toBeCloseTo((x.c - 5) - (x.b + 3), 9);
    expect(x.b).toBeCloseTo(8, 9);
  });

  it('counts the chairs', () => {
    // Only the middle table has a chair, and it sticks out 2 m to the left. Giving every
    // table the same chair would prove nothing — the offset cancels and both answers
    // agree. Here the chair widens b alone, so measuring it changes where b goes.
    const s = scene(
      [table('a', 0, 0), table('b', 5, 0), table('c', 20, 0)],
      [chair('b', -2)],
    );
    const bare = scene([table('a', 0, 0), table('b', 5, 0), table('c', 20, 0)]);
    const withChairs = placed(s, spaceEvenly(s, pick('a', 'b', 'c')), 'b');
    const withoutChairs = placed(bare, spaceEvenly(bare, pick('a', 'b', 'c')), 'b');
    expect(withoutChairs).toBeCloseTo(10, 9);
    expect(withChairs).toBeCloseTo(10.6, 9);
  });

  it('does nothing when the gaps are already equal', () => {
    const s = scene([table('a', 0, 0), table('b', 10, 0), table('c', 20, 0)]);
    expect(spaceEvenly(s, pick('a', 'b', 'c'))).toEqual([]);
  });

  it('cannot move anything when there are only two', () => {
    // Not a guard so much as an identity: the ends never move, and with two things
    // everything IS an end. The `< 3` check is an early-out and the button's disabled
    // state; lowering it would change nothing here, which is why this asserts the
    // invariant rather than the threshold.
    const s = scene([table('a', 0, 0), table('b', 10, 0)]);
    expect(spaceEvenly(s, pick('a', 'b'))).toEqual([]);
    const uneven = scene([table('a', 0, 0), table('b', 3, 0)]);
    expect(spaceEvenly(uneven, pick('a', 'b'))).toEqual([]);
  });

  it('works down a column as readily as along a row', () => {
    const s = scene([table('a', 0, 0), table('b', 0, 5), table('c', 0, 20)]);
    const shifts = spaceEvenly(s, pick('a', 'b', 'c'));
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.dx).toBe(0);
    expect(shifts[0]!.dy).toBeCloseTo(5, 9);
  });

  it('ignores seats rather than pinning them into a line', () => {
    // A seat's position belongs to its table's rule. Moving one would pin it, and the
    // next regeneration would shuffle everything around it.
    const s = scene([table('a', 0, 0), table('b', 5, 0), table('c', 20, 0)], [chair('a', -2)]);
    const withSeat = spaceEvenly(s, [...pick('a', 'b', 'c'), { type: 'seat', id: 'a-s' }]);
    expect(withSeat.map((x) => x.item.type)).not.toContain('seat');
  });
});

describe('axisOf', () => {
  it('reads a wide selection as a row and a tall one as a column', () => {
    const row = scene([table('a', 0, 0), table('b', 20, 1)]);
    const column = scene([table('a', 0, 0), table('b', 1, 20)]);
    expect(axisOf([{ minX: 0, minY: 0, maxX: 20, maxY: 2 }])).toBe('x');
    expect(axisOf([{ minX: 0, minY: 0, maxX: 2, maxY: 20 }])).toBe('y');
    expect(row.furniture).toHaveLength(2);
    expect(column.furniture).toHaveLength(2);
  });
});

describe('alignAcross', () => {
  it('lines a row up on the middle of the selection, not on one end', () => {
    // Aligning to the topmost or the first would slide the whole row; the middle keeps it
    // where the person put it.
    const s = scene([table('a', 0, -2), table('b', 10, 0), table('c', 20, 2)]);
    const shifts = alignAcross(s, pick('a', 'b', 'c'));
    const y = (id: string) =>
      s.furniture.find((f) => f.id === id)!.transform.y
      + (shifts.find((x) => x.item.id === id)?.dy ?? 0);
    expect(y('a')).toBeCloseTo(0, 9);
    expect(y('b')).toBeCloseTo(0, 9);
    expect(y('c')).toBeCloseTo(0, 9);
  });

  it('does nothing when they are already in line', () => {
    const s = scene([table('a', 0, 3), table('b', 10, 3), table('c', 20, 3)]);
    expect(alignAcross(s, pick('a', 'b', 'c'))).toEqual([]);
  });
});
