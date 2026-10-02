/**
 * Cutting a room into even bands.
 *
 * <p>The thing worth checking is that the cuts are straight and evenly spaced whatever
 * the room is — hand-drawn partitions fail at exactly that, and a derived one is only
 * worth having if it cannot. The awkward cases are a circle, where every cut is a
 * different length, and a notched outline, where a naive sweep stops at the first
 * re-entrant corner and leaves the room half divided.
 */
import { describe, expect, it } from 'vitest';
import { cellsForGrid, dividingCuts, gridCuts, partitionsForBands, partitionsForGrid } from './divide';
import type { ShapeJson } from '@/api/types';

const ROOM: ShapeJson = { kind: 'RECT', w: 10, h: 6 };

describe('how many walls a division needs', () => {
  it('is one fewer than the number of bands', () => {
    expect(partitionsForBands(3)).toBe(2);
    expect(partitionsForBands(2)).toBe(1);
  });

  it('is nothing at all below two bands', () => {
    expect(partitionsForBands(1)).toBe(0);
    expect(partitionsForBands(0)).toBe(0);
  });
});

describe('dividing a rectangular room', () => {
  it('makes one fewer wall than the bands asked for', () => {
    expect(dividingCuts(ROOM, 'HORIZONTAL', 3)).toHaveLength(2);
    expect(dividingCuts(ROOM, 'HORIZONTAL', 2)).toHaveLength(1);
  });

  it('refuses to divide into fewer than two', () => {
    expect(dividingCuts(ROOM, 'HORIZONTAL', 1)).toEqual([]);
    expect(dividingCuts(ROOM, 'HORIZONTAL', 0)).toEqual([]);
  });

  it('spaces the walls evenly across the room', () => {
    // A 6 m room in three rows puts walls at -1 and +1, each row 2 m deep.
    const cuts = dividingCuts(ROOM, 'HORIZONTAL', 3);
    const ys = cuts.map(([a]) => a[1]).sort((p, q) => p - q);
    expect(ys[0]).toBeCloseTo(-1, 9);
    expect(ys[1]).toBeCloseTo(1, 9);
  });

  it('draws every wall perfectly level, which is the whole point', () => {
    // The hand-drawn tool snaps each end to the wall independently, so the two ends land
    // at whatever height each click happened to be. These are derived from one number.
    for (const [a, b] of dividingCuts(ROOM, 'HORIZONTAL', 4)) {
      expect(a[1]).toBeCloseTo(b[1], 12);
    }
    for (const [a, b] of dividingCuts(ROOM, 'VERTICAL', 4)) {
      expect(a[0]).toBeCloseTo(b[0], 12);
    }
  });

  it('spans the full width of the room, wall to wall', () => {
    for (const [a, b] of dividingCuts(ROOM, 'HORIZONTAL', 3)) {
      expect(Math.min(a[0], b[0])).toBeCloseTo(-5, 9);
      expect(Math.max(a[0], b[0])).toBeCloseTo(5, 9);
    }
  });

  it('turns the other way for columns', () => {
    const cuts = dividingCuts(ROOM, 'VERTICAL', 2);
    expect(cuts).toHaveLength(1);
    const [a, b] = cuts[0]!;
    // One wall down the middle of a 10 m room, spanning its 6 m depth.
    expect(a[0]).toBeCloseTo(0, 9);
    expect(Math.min(a[1], b[1])).toBeCloseTo(-3, 9);
    expect(Math.max(a[1], b[1])).toBeCloseTo(3, 9);
  });
});

describe('dividing the shapes a rectangle does not cover', () => {
  it('cuts a round room into chords that still reach the wall', () => {
    const cuts = dividingCuts({ kind: 'CIRCLE', r: 4 }, 'HORIZONTAL', 2);
    expect(cuts).toHaveLength(1);
    const [a, b] = cuts[0]!;
    // Straight through the middle, so this one is the diameter.
    expect(a[1]).toBeCloseTo(0, 6);
    expect(Math.abs(b[0] - a[0])).toBeCloseTo(8, 1);
  });

  it('gives a circle shorter chords away from the middle, not equal ones', () => {
    // Three bands puts cuts at y = -4/3 and +4/3 of a radius-4 circle. Half-chord is
    // sqrt(16 - 16/9) = 3.771, so each is about 7.54 long rather than the full 8.
    const cuts = dividingCuts({ kind: 'CIRCLE', r: 4 }, 'HORIZONTAL', 3);
    expect(cuts).toHaveLength(2);
    for (const [a, b] of cuts) {
      expect(Math.abs(b[0] - a[0])).toBeCloseTo(7.542, 1);
    }
  });

  // A U, opening upward: a bar across the bottom and a leg up each side.
  const U: ShapeJson = {
    kind: 'POLYGON',
    points: [[-5, -3], [5, -3], [5, 3], [3, 3], [3, -1], [-3, -1], [-3, 3], [-5, 3]],
  };

  it('spans a notched room completely instead of stopping at the first notch', () => {
    // At mid-height the cut meets FOUR walls — in and out of each leg. Taking the first
    // two crossings would end the wall inside the left leg and leave the room undivided;
    // taking the outermost two carries it across the gap, which is what dividing a room
    // in two has to mean.
    const cuts = dividingCuts(U, 'HORIZONTAL', 2);
    expect(cuts).toHaveLength(1);
    const [a, b] = cuts[0]!;
    expect(a[1]).toBeCloseTo(0, 9);
    expect(Math.min(a[0], b[0])).toBeCloseTo(-5, 9);
    expect(Math.max(a[0], b[0])).toBeCloseTo(5, 9);
  });

  it('still only spans where the room actually is', () => {
    // The other way round, the honest answer is short: down the middle of a U there is
    // nothing above the bottom bar, so the wall stops at its top edge rather than
    // reaching for the outline's full height.
    const [a, b] = dividingCuts(U, 'VERTICAL', 2)[0]!;
    expect(a[0]).toBeCloseTo(0, 9);
    expect(Math.min(a[1], b[1])).toBeCloseTo(-3, 9);
    expect(Math.max(a[1], b[1])).toBeCloseTo(-1, 9);
  });

  it('scales a traced outline the same way it scales a rectangle', () => {
    const traced: ShapeJson = { kind: 'POLYGON', points: [[-4, -2], [4, -2], [4, 2], [-4, 2]] };
    const cuts = dividingCuts(traced, 'HORIZONTAL', 4);
    expect(cuts).toHaveLength(3);
    const ys = cuts.map(([a]) => a[1]).sort((p, q) => p - q);
    expect(ys[0]).toBeCloseTo(-1, 9);
    expect(ys[1]).toBeCloseTo(0, 9);
    expect(ys[2]).toBeCloseTo(1, 9);
  });
});

describe('dividing a room into a grid of cabins', () => {
  it('counts the walls and the cabins a grid needs', () => {
    // Four columns need three walls down, three rows need two across: five in all,
    // leaving twelve cabins.
    expect(partitionsForGrid(4, 3)).toBe(5);
    expect(cellsForGrid(4, 3)).toBe(12);
  });

  it('cuts both directions in one go', () => {
    const cuts = gridCuts(ROOM, 4, 3);
    expect(cuts).toHaveLength(5);
    const vertical = cuts.filter(([a, b]) => Math.abs(a[0] - b[0]) < 1e-9);
    const horizontal = cuts.filter(([a, b]) => Math.abs(a[1] - b[1]) < 1e-9);
    expect(vertical).toHaveLength(3);
    expect(horizontal).toHaveLength(2);
  });

  it('spaces both directions evenly across the room', () => {
    const cuts = gridCuts(ROOM, 4, 3);
    const xs = cuts
      .filter(([a, b]) => Math.abs(a[0] - b[0]) < 1e-9)
      .map(([a]) => a[0]).sort((p, q) => p - q);
    const ys = cuts
      .filter(([a, b]) => Math.abs(a[1] - b[1]) < 1e-9)
      .map(([a]) => a[1]).sort((p, q) => p - q);
    // A 10 m width in four columns: walls at -2.5, 0, 2.5.
    expect(xs).toHaveLength(3);
    expect(xs[0]).toBeCloseTo(-2.5, 9);
    expect(xs[1]).toBeCloseTo(0, 9);
    expect(xs[2]).toBeCloseTo(2.5, 9);
    // A 6 m depth in three rows: walls at -1 and 1.
    expect(ys[0]).toBeCloseTo(-1, 9);
    expect(ys[1]).toBeCloseTo(1, 9);
  });

  it('makes every wall span the room, so the cuts actually cross', () => {
    // Crossing is what turns five walls into twelve faces when the server polygonises
    // them. A wall that stopped short would leave two cabins joined.
    for (const [a, b] of gridCuts(ROOM, 4, 3)) {
      if (Math.abs(a[0] - b[0]) < 1e-9) {
        expect(Math.min(a[1], b[1])).toBeCloseTo(-3, 9);
        expect(Math.max(a[1], b[1])).toBeCloseTo(3, 9);
      } else {
        expect(Math.min(a[0], b[0])).toBeCloseTo(-5, 9);
        expect(Math.max(a[0], b[0])).toBeCloseTo(5, 9);
      }
    }
  });

  it('cuts only one way when the other count is one', () => {
    expect(gridCuts(ROOM, 4, 1)).toHaveLength(3);
    expect(gridCuts(ROOM, 1, 3)).toHaveLength(2);
  });

  it('does nothing at all for a single cabin', () => {
    expect(gridCuts(ROOM, 1, 1)).toEqual([]);
    expect(cellsForGrid(1, 1)).toBe(1);
    expect(partitionsForGrid(1, 1)).toBe(0);
  });
});
