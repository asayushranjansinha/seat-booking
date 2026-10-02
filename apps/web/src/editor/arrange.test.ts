/**
 * Even arrangement.
 *
 * <p>The cases that matter are the ones where a plausible-looking implementation goes
 * wrong: chairs ignored when measuring, partitions ignored when grouping, and tables
 * silently reordered so the seating plan changes under the person who asked only for
 * tidier spacing.
 */
import { describe, expect, it } from 'vitest';
import { arrangeTablesEvenly, wouldChange } from './arrange';
import type { SceneJson, SeatJson, FurnitureJson, Vec2Json } from '@/api/types';

const ROOM = 'room-1';

function table(id: string, x: number, y: number, rot = 0): FurnitureJson {
  return {
    id, roomId: ROOM, kind: 'TABLE', label: id,
    shape: { kind: 'RECT', w: 2, h: 1 },
    transform: { x, y, rot },
    height: 0.75,
  };
}

/** Four chairs, one off each side, 0.5 m clear of a 2 × 1 table. */
function chairs(tableId: string): SeatJson[] {
  return [[0, 1], [0, -1], [1.5, 0], [-1.5, 0]].map(([x, y], i) => ({
    id: `${tableId}-s${i}`, roomId: ROOM, tableId,
    code: `${tableId}${i}`,
    shape: { kind: 'RECT', w: 0.4, h: 0.4 },
    localTransform: { x: x!, y: y!, rot: 0 },
    placement: { kind: 'PERIMETER_EVEN', count: 4, clearance: 0.5 },
    seatIndex: i, override: false, bookable: true, hourlyRate: null,
  }));
}

function scene(furniture: FurnitureJson[], opts: { subZones?: Vec2Json[][] } = {}): SceneJson {
  return {
    planVersionId: 'v', floorId: 'f', status: 'DRAFT', revision: 1,
    rooms: [{
      id: ROOM, name: 'Studio',
      shape: { kind: 'RECT', w: 20, h: 10 },
      transform: { x: 0, y: 0, rot: 0 },
      height: 2.7, hourlyRate: null, partitions: [], gates: [],
      subZones: opts.subZones?.map((ring, i) => ({
        index: i, name: `Zone ${i + 1}`, area: 0, ring,
      })),
    }],
    furniture,
    seats: furniture.flatMap((f) => chairs(f.id)),
  };
}

describe('arrangeTablesEvenly', () => {
  it('leaves the same gap everywhere, walls included', () => {
    // Three 2 x 1 tables, each 3.4 m wide once its chairs are counted, in a 20 m room:
    // 9.8 m of floor over four gaps, so 2.45 m against each wall and between each pair.
    const s = scene([table('a', -1, 3), table('b', 0.5, -2), table('c', 7, 1)]);
    const { moves } = arrangeTablesEvenly(s, ROOM);
    const xs = moves.map((m) => m.x).sort((p, q) => p - q);
    const gaps = [
      (xs[0]! - 1.7) - -10,
      (xs[1]! - 1.7) - (xs[0]! + 1.7),
      (xs[2]! - 1.7) - (xs[1]! + 1.7),
      10 - (xs[2]! + 1.7),
    ];
    for (const g of gaps) expect(g).toBeCloseTo(2.45, 9);
  });

  it('measures the chairs, not just the table', () => {
    // A 2 x 1 table is 2 m wide; with its chairs it needs 3.4 m. Five fit across a 20 m
    // room (17 m) and six do not (20.4 m). An implementation that measured only the
    // tables would see 12 m and 2 m of room to spare, and would put all six in one row
    // with their chairs sitting in each other's laps.
    const five = arrangeTablesEvenly(
      scene(Array.from({ length: 5 }, (_, i) => table(`t${i}`, i * 2 - 5, 0))), ROOM,
    );
    expect(new Set(five.moves.map((m) => m.y.toFixed(6))).size).toBe(1);
    expect(five.crowded).toEqual([]);
    const xs = five.moves.map((m) => m.x).sort((p, q) => p - q);
    for (let i = 1; i < xs.length; i++) {
      // 5 x 3.4 m of footprint in 20 m leaves 3 m over six gaps: half a metre each, so
      // the chair rings clear each other and the centres sit 3.9 m apart.
      expect(xs[i]! - xs[i - 1]!).toBeCloseTo(3.9, 9);
      expect((xs[i]! - 1.7) - (xs[i - 1]! + 1.7)).toBeCloseTo(0.5, 9);
    }

    const six = arrangeTablesEvenly(
      scene(Array.from({ length: 6 }, (_, i) => table(`t${i}`, i * 2 - 5, 0))), ROOM,
    );
    expect(new Set(six.moves.map((m) => m.y.toFixed(6))).size).toBe(2); // forced onto two rows
  });

  it('keeps each zone to its own side of a partition', () => {
    // Deliberately LOPSIDED. An even split is no test at all: arranging the whole room as
    // one grid also happens to put half the tables above the line and half below, so it
    // passes while ignoring the partition entirely. Here the divider sits at y = 3, so a
    // whole-room grid would drop the top three tables to y = 2.5 — through the partition
    // and into the wrong zone.
    const top: Vec2Json[] = [[-10, 3], [10, 3], [10, 5], [-10, 5]];
    const bottom: Vec2Json[] = [[-10, -5], [10, -5], [10, 3], [-10, 3]];
    const s = scene(
      [table('a', -4, 4), table('b', 0, 3.5), table('c', 4, 4),
       table('d', -4, -3), table('e', 0, -2), table('f', 4, -3)],
      { subZones: [top, bottom] },
    );
    const { moves } = arrangeTablesEvenly(s, ROOM);
    const at = (id: string) => moves.find((m) => m.tableId === id)!;
    for (const id of ['a', 'b', 'c']) expect(at(id).y).toBeGreaterThanOrEqual(3);
    for (const id of ['d', 'e', 'f']) expect(at(id).y).toBeLessThanOrEqual(3);
    // And the top zone is only 2 m deep, which three tables with chairs cannot fill
    // tidily — that has to be reported rather than quietly overlapped.
    const { crowded } = arrangeTablesEvenly(s, ROOM);
    expect(crowded.map((c) => c.zone)).toContain('Zone 1');
  });

  it('leaves the same gap between rows as against the top and bottom walls', () => {
    // Six tables become three columns by two rows. Each row is 2.4 m deep with its
    // chairs, so 4.8 m of the room's 10 m depth is used and the remaining 5.2 m is split
    // three ways: above the first row, between the two, and below the second.
    const s = scene(Array.from({ length: 6 }, (_, i) => table(`t${i}`, i * 2 - 5, 0)));
    const { moves } = arrangeTablesEvenly(s, ROOM);
    const ys = [...new Set(moves.map((m) => m.y))].sort((a, b) => b - a);
    expect(ys).toHaveLength(2);
    const expected = (10 - 4.8) / 3;
    expect(5 - (ys[0]! + 1.2)).toBeCloseTo(expected, 9);           // top wall to row one
    expect((ys[0]! - 1.2) - (ys[1]! + 1.2)).toBeCloseTo(expected, 9); // between the rows
    expect((ys[1]! - 1.2) - -5).toBeCloseTo(expected, 9);          // row two to the floor
  });

  it('does not reshuffle which table sits where', () => {
    // b is to the right of a. After arranging, it must still be to the right of a.
    const s = scene([table('a', -6, 1), table('b', 2, 1.2), table('c', 6, 0.9)]);
    const { moves } = arrangeTablesEvenly(s, ROOM);
    const at = (id: string) => moves.find((m) => m.tableId === id)!;
    expect(at('a').x).toBeLessThan(at('b').x);
    expect(at('b').x).toBeLessThan(at('c').x);
  });

  it('reports a zone that cannot hold its tables instead of overlapping them silently', () => {
    // Twenty tables, each needing 3 x 2 m with chairs, into 20 x 10 m: 6 x 5 = 30 cells
    // of the needed size do not exist, so this has to be reported.
    const s = scene(Array.from({ length: 40 }, (_, i) => table(`t${i}`, (i % 8) - 4, i / 8 - 2)));
    const { crowded } = arrangeTablesEvenly(s, ROOM);
    expect(crowded).toHaveLength(1);
    expect(crowded[0]!.tables).toBe(40);
    expect(crowded[0]!.fits).toBeLessThan(40);
  });

  it('measures a table that has been turned sideways', () => {
    // Upright, a 2 x 1 table with its chairs is 3.4 m across; turned 90 degrees it is
    // 2.4 m. Two of them in a 20 m room therefore sit CLOSER together when turned — the
    // tables are narrower, so the four equal gaps each get wider. Using the unrotated
    // width would give both pairs the same answer.
    const upright = arrangeTablesEvenly(scene([table('a', 0, 0), table('b', 3, 0)]), ROOM);
    const sideways = arrangeTablesEvenly(
      scene([table('a', 0, 0, Math.PI / 2), table('b', 3, 0, Math.PI / 2)]), ROOM,
    );
    const centres = (r: typeof upright) => Math.abs(r.moves[0]!.x - r.moves[1]!.x);
    expect(centres(upright)).toBeCloseTo(3.4 + (20 - 6.8) / 3, 9);
    expect(centres(sideways)).toBeCloseTo(2.4 + (20 - 4.8) / 3, 9);
    expect(centres(sideways)).toBeLessThan(centres(upright));
  });

  it('reports no change when the room is already arranged', () => {
    const s = scene([table('a', -2, 1), table('b', 7, -3)]);
    const first = arrangeTablesEvenly(s, ROOM);
    const moved: SceneJson = {
      ...s,
      furniture: s.furniture.map((f) => {
        const m = first.moves.find((x) => x.tableId === f.id)!;
        return { ...f, transform: { ...f.transform, x: m.x, y: m.y } };
      }),
    };
    expect(wouldChange(moved, arrangeTablesEvenly(moved, ROOM).moves)).toBe(false);
    expect(wouldChange(s, first.moves)).toBe(true);
  });

  it('leaves an empty room alone', () => {
    expect(arrangeTablesEvenly(scene([]), ROOM).moves).toEqual([]);
  });
});

describe('rooms that are not rectangles', () => {
  /** Scene with one room of an arbitrary outline. */
  function shaped(shape: SceneJson['rooms'][number]['shape'], furniture: FurnitureJson[]): SceneJson {
    const base = scene(furniture);
    return { ...base, rooms: [{ ...base.rooms[0]!, shape }] };
  }

  /**
   * The L that found this. A table centred in the BOUNDING BOX of an L-shaped room lands
   * in the bite taken out of its corner — outside the room, where there is no floor.
   */
  const L_SHAPE = {
    kind: 'POLYGON' as const,
    points: [[-6, -4], [6, -4], [6, 0], [0, 0], [0, 4], [-6, 4]] as Vec2Json[],
  };

  /** Is the point strictly inside the L? Written independently of the code under test. */
  const insideL = (x: number, y: number) =>
    (x >= -6 && x <= 6 && y >= -4 && y <= 0) || (x >= -6 && x <= 0 && y >= -4 && y <= 4);

  it('does not put a table in the notch of an L-shaped room', () => {
    const { moves } = arrangeTablesEvenly(shaped(L_SHAPE, [table('a', 1, 1)]), ROOM);
    expect(moves).toHaveLength(1);
    const { x, y } = moves[0]!;
    expect(insideL(x, y)).toBe(true);
    // The centre of the bounding box is (0, 0) — the inner corner. Anything that lands
    // there has used the box rather than the room.
    expect(Math.hypot(x, y)).toBeGreaterThan(0.5);
  });

  /** Every corner of the table's chair ring, which is what the validator checks. */
  const ringCorners = (m: { x: number; y: number }) =>
    [[-1.7, -1.2], [1.7, -1.2], [1.7, 1.2], [-1.7, 1.2]].map(([dx, dy]) =>
      ({ x: m.x + dx!, y: m.y + dy! }));

  it('keeps tables and chairs inside an L-shaped room when they fit', () => {
    const { moves, crowded } = arrangeTablesEvenly(
      shaped(L_SHAPE, [table('a', 1, 1), table('b', -1, 2)]), ROOM,
    );
    expect(crowded).toEqual([]);
    expect(moves).toHaveLength(2);
    for (const m of moves) {
      for (const c of ringCorners(m)) expect(insideL(c.x, c.y)).toBe(true);
    }
  });

  it('says so rather than pretending when the arms of the L are too small', () => {
    // Four tables need 13.6 x 4.8 m of chair-inclusive space. Neither arm of this L is
    // that big, so they cannot all be placed tidily. The arrangement still happens —
    // leaving the room untouched and silent would be worse — but it must be reported,
    // because the chairs will be overlapping and publishing is about to fail.
    const tables = Array.from({ length: 4 }, (_, i) => table(`t${i}`, i - 2, i - 1));
    const { moves, crowded } = arrangeTablesEvenly(shaped(L_SHAPE, tables), ROOM);
    expect(moves).toHaveLength(4);
    expect(crowded).toHaveLength(1);
    expect(crowded[0]!.tables).toBe(4);
    expect(crowded[0]!.fits).toBeLessThan(4);
    // Whatever else is true, no TABLE is put somewhere there is no floor.
    for (const m of moves) expect(insideL(m.x, m.y)).toBe(true);
  });

  /**
   * A room with a bite out of the middle of a wall — a lightwell, a lift core, a stage
   * recess. It is the shape that proves the containment test needs more than corners: a
   * rectangle spanning the two prongs of the U has all four corners on solid floor and its
   * top edge straight through the gap. An L never catches this, because an L's missing
   * piece is a corner and always swallows one.
   */
  const U_SHAPE = {
    kind: 'POLYGON' as const,
    points: [[-6, -4], [6, -4], [6, 4], [2, 4], [2, 0], [-2, 0], [-2, 4], [-6, 4]] as Vec2Json[],
  };

  const insideU = (x: number, y: number) =>
    x >= -6 && x <= 6 && y >= -4 && y <= 4 && !(x > -2 && x < 2 && y > 0);

  it('does not span the gap of a U-shaped room', () => {
    const { moves } = arrangeTablesEvenly(shaped(U_SHAPE, [table('a', 0, 1)]), ROOM);
    expect(moves).toHaveLength(1);
    for (const c of ringCorners(moves[0]!)) expect(insideU(c.x, c.y)).toBe(true);
  });

  it('keeps tables inside a round room, not in the corners of its box', () => {
    const r = 6;
    const { moves } = arrangeTablesEvenly(
      shaped({ kind: 'CIRCLE', r }, [table('a', 0, 0), table('b', 1, 1)]), ROOM,
    );
    for (const m of moves) {
      for (const [dx, dy] of [[-1.7, -1.2], [1.7, -1.2], [1.7, 1.2], [-1.7, 1.2]]) {
        expect(Math.hypot(m.x + dx!, m.y + dy!)).toBeLessThanOrEqual(r + 1e-6);
      }
    }
  });
});
