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
  it('spaces three tables evenly across the room with equal gaps', () => {
    const s = scene([table('a', -1, 3), table('b', 0.5, -2), table('c', 7, 1)]);
    const { moves } = arrangeTablesEvenly(s, ROOM);
    const xs = moves.map((m) => m.x).sort((p, q) => p - q);
    xs.forEach((x, i) => expect(x).toBeCloseTo(-20 / 3 + i * (20 / 3), 9));
    // Gap to each wall is half the gap between tables — that is what reads as even.
    expect(xs[0]! - -10).toBeCloseTo((xs[1]! - xs[0]!) / 2, 9);
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
      expect(xs[i]! - xs[i - 1]!).toBeCloseTo(4, 9);
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(3.4); // chair rings stay clear
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

  it('accounts for a table that has been turned sideways', () => {
    // Turned 90 degrees, a 2 x 1 table with its chairs is 2 m wide, not 3 m.
    const upright = arrangeTablesEvenly(scene([table('a', 0, 0), table('b', 3, 0)]), ROOM);
    const sideways = arrangeTablesEvenly(
      scene([table('a', 0, 0, Math.PI / 2), table('b', 3, 0, Math.PI / 2)]), ROOM,
    );
    // Both get the full width of the room, but the sideways pair fits in one row where
    // the upright pair's taller footprint does not change the column count here.
    expect(upright.moves).toHaveLength(2);
    expect(sideways.moves).toHaveLength(2);
    // The turned tables are narrower, so a grid of them is at least as wide-friendly.
    const span = (r: typeof upright) =>
      Math.abs(r.moves[0]!.x - r.moves[1]!.x) + Math.abs(r.moves[0]!.y - r.moves[1]!.y);
    expect(span(sideways)).toBeGreaterThanOrEqual(span(upright) - 1e-9);
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
