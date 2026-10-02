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
  it('makes every gap the same, the two against the walls included', () => {
    // The whole point, and a change from the first version. Three 2 m tables in a 60 m
    // room leave 54 m of floor over four gaps: 13.5 m against each wall and between each
    // pair. Equalising only the gaps BETWEEN them — which is what a drawing tool does to
    // shapes floating on a canvas — leaves the row visibly off-centre in the room.
    const s = scene([table('a', -20, 0), table('b', -5, 0), table('c', 10, 0)]);
    const shifts = spaceEvenly(s, pick('a', 'b', 'c'));
    const x = { a: placed(s, shifts, 'a'), b: placed(s, shifts, 'b'), c: placed(s, shifts, 'c') };
    const gaps = [
      (x.a - 1) - -30,        // left wall to the first
      (x.b - 1) - (x.a + 1),
      (x.c - 1) - (x.b + 1),
      30 - (x.c + 1),         // the last to the right wall
    ];
    for (const g of gaps) expect(g).toBeCloseTo(13.5, 9);
  });

  it('leaves the same amount of room against each wall', () => {
    // The report that prompted this: the gaps between the tables were even to the pixel
    // and there was twice as much floor on the right as on the left.
    const s = scene([table('a', -25, 0), table('b', -20, 0), table('c', -15, 0)]);
    const shifts = spaceEvenly(s, pick('a', 'b', 'c'));
    const left = (placed(s, shifts, 'a') - 1) - -30;
    const right = 30 - (placed(s, shifts, 'c') + 1);
    expect(left).toBeCloseTo(right, 9);
  });

  it('equalises the GAPS, not the centres', () => {
    // The sizes have to differ for this to prove anything: with equal tables, spacing by
    // gaps and spacing by centres give the same answer and the test passes either way.
    // a is 2 wide, b is 6, c is 10 — 18 m of table in 60 m of room, so every gap is 10.5.
    const s = scene([table('a', 0, 0, 2), table('b', 9, 0, 6), table('c', 20, 0, 10)]);
    const shifts = spaceEvenly(s, pick('a', 'b', 'c'));
    const x = { a: placed(s, shifts, 'a'), b: placed(s, shifts, 'b'), c: placed(s, shifts, 'c') };
    expect((x.b - 3) - (x.a + 1)).toBeCloseTo((x.c - 5) - (x.b + 3), 9);
    // Centres would be at -19.5, 0 and 19.5; gaps put them here instead.
    expect(x.a).toBeCloseTo(-30 + 10.5 + 1, 9);
    expect(x.b).toBeCloseTo(-30 + 10.5 + 2 + 10.5 + 3, 9);
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
    // 60 m of room. Without the chair there is 54 m over four gaps (13.5 each) and b
    // lands dead centre. The chair widens b to 3.2 m, so the gaps shrink to 13.2 and b's
    // CENTRE shifts right — the chair hangs off its left side, so the table has to sit
    // further right for its footprint to start in the same place.
    expect(withoutChairs).toBeCloseTo(0, 9);
    expect(withChairs).toBeCloseTo(0.6, 9);
  });

  it('does nothing when they are already evenly spaced in the room', () => {
    // 60 m of room, three 2 m tables, so 13.5 m in every gap.
    const at = (i: number) => -30 + 13.5 * (i + 1) + 2 * i + 1;
    const s = scene([table('a', at(0), 0), table('b', at(1), 0), table('c', at(2), 0)]);
    expect(spaceEvenly(s, pick('a', 'b', 'c'))).toEqual([]);
  });

  it('spaces two things across the room as readily as three', () => {
    // Under the old rule two things could never move, because both were ends. Spacing in
    // the room gives them three gaps to share, so a pair bunched in one corner spreads
    // out like any other count.
    const s = scene([table('a', -25, 0), table('b', -20, 0)]);
    const shifts = spaceEvenly(s, pick('a', 'b'));
    const left = (placed(s, shifts, 'a') - 1) - -30;
    const right = 30 - (placed(s, shifts, 'b') + 1);
    expect(left).toBeCloseTo(right, 9);
    expect(left).toBeCloseTo((60 - 4) / 3, 9);
  });

  it('holds the ends when there is no room to measure against', () => {
    // A selection spanning two rooms has no single container, so it falls back to the old
    // behaviour rather than guessing which room's walls to use.
    const s = scene([table('a', 0, 0), table('b', 5, 0), table('c', 20, 0)]);
    s.rooms.push({ ...s.rooms[0]!, id: 'room-2', transform: { x: 100, y: 0, rot: 0 } });
    s.furniture[2] = { ...s.furniture[2]!, roomId: 'room-2', transform: { x: -80, y: 0, rot: 0 } };
    s.rooms[0] = { ...s.rooms[0]!, transform: { x: 0, y: 0, rot: 0.3 } }; // rotated: no axis-aligned answer
    const shifts = spaceEvenly(s, pick('a', 'b', 'c'));
    expect(shifts.map((x) => x.item.id)).not.toContain('a');
    expect(shifts.map((x) => x.item.id)).not.toContain('c');
  });

  it('works down a column as readily as along a row', () => {
    // The room is 40 m deep, so a column is spaced against the top and bottom walls.
    const s = scene([table('a', 0, -15, 2, 1), table('b', 0, 0, 2, 1), table('c', 0, 5, 2, 1)]);
    const shifts = spaceEvenly(s, pick('a', 'b', 'c'));
    expect(shifts.every((x) => x.dx === 0)).toBe(true);
    const y = (id: string) =>
      s.furniture.find((f) => f.id === id)!.transform.y
      + (shifts.find((x) => x.item.id === id)?.dy ?? 0);
    const gaps = [
      (y('a') - 0.5) - -20, (y('b') - 0.5) - (y('a') + 0.5),
      (y('c') - 0.5) - (y('b') + 0.5), 20 - (y('c') + 0.5),
    ];
    for (const g of gaps) expect(g).toBeCloseTo((40 - 3) / 4, 9);
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
