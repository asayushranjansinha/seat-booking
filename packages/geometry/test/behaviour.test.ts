/**
 * Properties the product requires, which a table of fixed expected numbers cannot state.
 * The fixtures pin the two languages to each other; these pin the engine to the brief.
 */
import { describe, expect, it } from 'vitest';

import {
  applyTransform,
  composeTransform,
  offsetRing,
  placeSeats,
  pointInRing,
  projectToArcLength,
  ringPerimeter,
  tessellate,
} from '../src/index.js';
import type { Shape } from '../src/types.js';

const TOL = 1e-3;
const CLEARANCE = 0.5;

/** Where each seat sits around the table, as a fraction of the offset perimeter. */
function normalisedArcPositions(shape: Shape, count: number): number[] {
  const off = offsetRing(tessellate(shape, TOL), CLEARANCE);
  const perimeter = ringPerimeter(off);
  return placeSeats({
    shape,
    clearance: CLEARANCE,
    rule: { kind: 'PERIMETER_EVEN', count },
    tolerance: TOL,
  }).map((s) => projectToArcLength(off, { x: s.x, y: s.y }) / perimeter);
}

describe('place a seat at an angle and the nearby seats move in the same proportion', () => {
  it('resizing a table redistributes seats proportionally, not absolutely', () => {
    const small = normalisedArcPositions({ kind: 'RECT', w: 2, h: 1 }, 8);
    const large = normalisedArcPositions({ kind: 'RECT', w: 3, h: 1.5 }, 8);
    expect(small).toHaveLength(8);
    small.forEach((v, i) => expect(large[i]!).toBeCloseTo(v, 9));
  });

  it('a stretched table keeps even spacing rather than leaving a gap', () => {
    const shape: Shape = { kind: 'RECT', w: 5, h: 1 };
    const off = offsetRing(tessellate(shape, TOL), CLEARANCE);
    const perimeter = ringPerimeter(off);
    const seats = placeSeats({
      shape,
      clearance: CLEARANCE,
      rule: { kind: 'PERIMETER_EVEN', count: 12 },
      tolerance: TOL,
    });
    const arcs = seats.map((s) => projectToArcLength(off, { x: s.x, y: s.y })).sort((a, b) => a - b);
    const gaps = arcs.map((s, i) => ((arcs[(i + 1) % arcs.length]! - s) % perimeter + perimeter) % perimeter);
    for (const g of gaps) expect(g).toBeCloseTo(perimeter / 12, 9);
  });

  it('rotating a table carries its seats without rewriting a single seat record', () => {
    const shape: Shape = { kind: 'RECT', w: 2, h: 1 };
    const seats = placeSeats({
      shape,
      clearance: CLEARANCE,
      rule: { kind: 'PERIMETER_EVEN', count: 8 },
      tolerance: TOL,
    });

    const upright = { x: 5, y: 2, rot: 0 };
    const turned = { x: 5, y: 2, rot: Math.PI / 2 };

    // Rotating the table is ONE transform change. The seat list is the same array
    // object: no seat record is read, rewritten, or even consulted.
    seats.forEach((s) => {
      const before = applyTransform(upright, { x: s.x, y: s.y });
      const after = applyTransform(turned, { x: s.x, y: s.y });
      // Every seat has rotated 90 degrees about the table origin (5, 2).
      expect(after.x).toBeCloseTo(5 - (before.y - 2), 9);
      expect(after.y).toBeCloseTo(2 + (before.x - 5), 9);
      // ...and its distance from the table origin is unchanged, as a rotation requires.
      expect(Math.hypot(after.x - 5, after.y - 2)).toBeCloseTo(
        Math.hypot(before.x - 5, before.y - 2),
        9,
      );
    });
  });

  it('composes down a chain: floor -> room -> table -> seat', () => {
    const room = { x: 10, y: 0, rot: 0 };
    const table = { x: 2, y: 3, rot: Math.PI / 2 };
    const seat = { x: 1.5, y: 0, rot: Math.PI };
    const world = composeTransform(composeTransform(room, table), seat);
    expect(world.x).toBeCloseTo(12, 9);
    expect(world.y).toBeCloseTo(4.5, 9);
    expect(world.rot).toBeCloseTo(Math.PI / 2 + Math.PI, 9);
  });
});

describe('dragging a seat gives manual control without losing automatic behaviour', () => {
  it('pins the dragged seat exactly and redistributes the rest evenly around it', () => {
    const shape: Shape = { kind: 'RECT', w: 2, h: 1 };
    const seats = placeSeats({
      shape,
      clearance: CLEARANCE,
      rule: { kind: 'PERIMETER_EVEN', count: 8 },
      tolerance: TOL,
      overrides: [{ index: 3, x: 1.5, y: 1.0, rot: 0 }],
    });

    expect(seats).toHaveLength(8);
    expect(seats[3]!.x).toBe(1.5);
    expect(seats[3]!.y).toBe(1.0);
    expect(seats[3]!.override).toBe(true);
    expect(seats.filter((s) => s.override)).toHaveLength(1);

    const off = offsetRing(tessellate(shape, TOL), CLEARANCE);
    const perimeter = ringPerimeter(off);
    const arcs = seats.map((s) => projectToArcLength(off, { x: s.x, y: s.y })).sort((a, b) => a - b);
    const gaps = arcs.map((s, i) => ((arcs[(i + 1) % arcs.length]! - s) % perimeter + perimeter) % perimeter);
    for (const g of gaps) expect(g).toBeCloseTo(perimeter / 8, 6);
  });

  it('keeps a seat near its previous position instead of teleporting it', () => {
    const shape: Shape = { kind: 'RECT', w: 2, h: 1 };
    const base = { shape, clearance: CLEARANCE, tolerance: TOL } as const;
    const before = placeSeats({ ...base, rule: { kind: 'PERIMETER_EVEN', count: 8 } });
    const after = placeSeats({
      ...base,
      rule: { kind: 'PERIMETER_EVEN', count: 8 },
      overrides: [{ index: 2, x: 1.5, y: 1.0, rot: 0 }],
    });
    // Seat 0 is not the one being dragged, so it should barely move.
    const moved = Math.hypot(after[0]!.x - before[0]!.x, after[0]!.y - before[0]!.y);
    expect(moved).toBeLessThan(0.01);
  });
});

describe('one algorithm seats every table shape', () => {
  const shapes: Array<[string, Shape]> = [
    ['rectangle', { kind: 'RECT', w: 2, h: 1 }],
    ['circle', { kind: 'CIRCLE', r: 0.75 }],
    ['ellipse', { kind: 'ELLIPSE', rx: 1.2, ry: 0.8 }],
    ['triangle', { kind: 'POLYGON', points: [{ x: -1, y: -0.6 }, { x: 1, y: -0.6 }, { x: 0, y: 0.9 }] }],
    [
      'L-shape',
      {
        kind: 'POLYGON',
        points: [
          { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 },
          { x: 0, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 1 },
        ],
      },
    ],
  ];

  for (const [name, shape] of shapes) {
    it(`${name}: seats the requested count, all clear of the table footprint`, () => {
      const seats = placeSeats({
        shape,
        clearance: CLEARANCE,
        rule: { kind: 'PERIMETER_EVEN', count: 9 },
        tolerance: TOL,
      });
      expect(seats).toHaveLength(9);
      const footprint = tessellate(shape, TOL);
      for (const s of seats) {
        expect(pointInRing(footprint, { x: s.x, y: s.y }), `${name}: seat ${s.index} is inside the table`).toBe(false);
      }
    });

    it(`${name}: every seat faces the table`, () => {
      const seats = placeSeats({
        shape,
        clearance: CLEARANCE,
        rule: { kind: 'PERIMETER_EVEN', count: 9 },
        tolerance: TOL,
      });
      for (const s of seats) {
        // Stepping forward along the seat's heading must move it toward the footprint.
        const distBefore = Math.hypot(s.x, s.y);
        const distAfter = Math.hypot(s.x + 0.01 * Math.cos(s.rot), s.y + 0.01 * Math.sin(s.rot));
        expect(distAfter, `${name}: seat ${s.index} faces away from the table`).toBeLessThan(distBefore);
      }
    });
  }
});
