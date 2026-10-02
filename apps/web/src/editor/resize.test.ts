/**
 * Dragging a grip.
 *
 * <p>The case that matters is a corner pulled mostly sideways: that is where independent
 * axes quietly turn a 2.4 x 1.2 desk into something 2.4 x 0.3, and where "it keeps the
 * proportions" is either true or only nearly true.
 */
import { describe, expect, it } from 'vitest';
import { resizedShape } from './resize';
import type { ShapeJson } from '@/api/types';

const loose = { free: false, gridSnap: 0.25, snapEnabled: false };
const snapped = { free: false, gridSnap: 0.25, snapEnabled: true };

/** The lower-left corner is 0 and they run clockwise, so 2 is the upper-right one. */
const UPPER_RIGHT = 2;

const ratioOf = (s: ShapeJson) => (s.kind === 'RECT' ? s.w / s.h : NaN);

describe('corner drags keep the proportions', () => {
  const desk: ShapeJson = { kind: 'RECT', w: 2.4, h: 1.2 };

  it('holds the ratio when the drag is almost entirely sideways', () => {
    // The whole point. Pulled out along x and barely at all along y, the old rule made
    // the desk wider and left the depth where the pointer happened to be.
    const out = resizedShape(desk, UPPER_RIGHT, { x: 3, y: 0.6 }, loose);
    expect(ratioOf(out)).toBeCloseTo(2, 9);
    // 5.28, not 6. The scale is the pointer PROJECTED onto the diagonal, not whichever
    // axis moved further — and the two only differ off the diagonal, which is where a
    // max-of-the-two rule starts and stops obeying a different axis mid-drag.
    expect(out.kind === 'RECT' && out.w).toBeCloseTo(5.28, 9);
  });

  it('holds the ratio when the drag is almost entirely upward', () => {
    const out = resizedShape(desk, UPPER_RIGHT, { x: 1.2, y: 1.6 }, loose);
    expect(ratioOf(out)).toBeCloseTo(2, 9);
  });

  it('grows and shrinks along the diagonal it is dragged', () => {
    // Exactly on the corner is no change at all.
    const same = resizedShape(desk, UPPER_RIGHT, { x: 1.2, y: 0.6 }, loose);
    expect(same.kind === 'RECT' && same.w).toBeCloseTo(2.4, 9);

    const bigger = resizedShape(desk, UPPER_RIGHT, { x: 2.4, y: 1.2 }, loose);
    expect(bigger.kind === 'RECT' && bigger.w).toBeCloseTo(4.8, 9);

    const smaller = resizedShape(desk, UPPER_RIGHT, { x: 0.6, y: 0.3 }, loose);
    expect(smaller.kind === 'RECT' && smaller.w).toBeCloseTo(1.2, 9);
  });

  it('never collapses or flips when dragged past the centre', () => {
    const out = resizedShape(desk, UPPER_RIGHT, { x: -5, y: -5 }, loose);
    expect(out.kind === 'RECT' && out.w).toBeGreaterThan(0);
    expect(out.kind === 'RECT' && out.h).toBeGreaterThan(0);
  });

  it('works from every corner, not just the one the signs were written for', () => {
    // Dragging the lower-left corner down and left must also grow the desk.
    const out = resizedShape(desk, 0, { x: -2.4, y: -1.2 }, loose);
    expect(out.kind === 'RECT' && out.w).toBeCloseTo(4.8, 9);
    expect(ratioOf(out)).toBeCloseTo(2, 9);
  });

  it('snaps the longer side and derives the other, so the grid cannot skew it', () => {
    // Snapping both independently rounds them to different fractions: 2.5 and 1.25 keep
    // the ratio only by luck, and 2.5 x 1.0 would not.
    // The drag works out to 2.62 m wide; the grid rounds that to 2.50, and the depth
    // follows from the ratio rather than from its own rounding — 1.25, not the 1.00 that
    // snapping 0.655 x 2 on its own would have given.
    const out = resizedShape(desk, UPPER_RIGHT, { x: 1.31, y: 0.655 }, snapped);
    expect(out.kind === 'RECT' && out.w).toBeCloseTo(2.5, 9);
    expect(out.kind === 'RECT' && out.h).toBeCloseTo(1.25, 9);
    expect(ratioOf(out)).toBeCloseTo(2, 9);
  });

  it('snaps the longer side even when that is the height', () => {
    const tall: ShapeJson = { kind: 'RECT', w: 1, h: 4 };
    const out = resizedShape(tall, UPPER_RIGHT, { x: 0.7, y: 2.8 }, snapped);
    expect(out.kind === 'RECT' && out.h).toBeCloseTo(5.5, 9);
    expect(ratioOf(out)).toBeCloseTo(0.25, 9);
  });

  it('lets Shift stretch one way only', () => {
    const out = resizedShape(desk, UPPER_RIGHT, { x: 3, y: 0.6 }, { ...loose, free: true });
    expect(out.kind === 'RECT' && out.w).toBeCloseTo(6, 9);
    expect(out.kind === 'RECT' && out.h).toBeCloseTo(1.2, 9);
  });
});

describe('other shapes', () => {
  it('scales a traced outline rather than leaving it unresizable', () => {
    // A pen-drawn room had no grips at all: the only way to change its size was to delete
    // it and trace it again.
    const room: ShapeJson = { kind: 'POLYGON', points: [[-2, -1], [2, -1], [2, 1], [0, 3]] };
    const out = resizedShape(room, UPPER_RIGHT, { x: 4, y: 6 }, loose);
    expect(out.kind).toBe('POLYGON');
    if (out.kind !== 'POLYGON') return;
    // Every point moved by the same factor, so the outline is the same outline.
    const factors = out.points.map(([x, y], i) => {
      const [ox, oy] = room.kind === 'POLYGON' ? room.points[i]! : [1, 1];
      return Math.abs(ox) > 1e-9 ? x / ox : y / oy;
    });
    for (const f of factors) expect(f).toBeCloseTo(factors[0]!, 9);
    // The outline reaches 2 along x and 3 along y, so its corner is (2, 3): dragging to
    // (4, 6) is exactly twice as far down that diagonal. Measuring the extent wrongly
    // would still scale uniformly, just by the wrong amount.
    expect(factors[0]!).toBeCloseTo(2, 9);
  });

  it('keeps a circle a circle', () => {
    const out = resizedShape({ kind: 'CIRCLE', r: 2 }, 0, { x: 3, y: 4 }, loose);
    expect(out).toEqual({ kind: 'CIRCLE', r: 5 });
  });

  it('still lets an ellipse be stretched on one axis with Shift', () => {
    // The exception: squashing one axis is the only way to make an ellipse of a circle,
    // so Shift must not take that away.
    const out = resizedShape(
      { kind: 'ELLIPSE', rx: 2, ry: 1 }, 0, { x: 5, y: 0 }, { ...loose, free: true },
    );
    expect(out).toEqual({ kind: 'ELLIPSE', rx: 5, ry: 1 });
  });

  it('keeps an ellipse proportional without Shift', () => {
    const out = resizedShape({ kind: 'ELLIPSE', rx: 2, ry: 1 }, UPPER_RIGHT, { x: 4, y: 2 }, loose);
    expect(out.kind === 'ELLIPSE' && out.rx).toBeCloseTo(4, 9);
    expect(out.kind === 'ELLIPSE' && out.ry).toBeCloseTo(2, 9);
  });
});
