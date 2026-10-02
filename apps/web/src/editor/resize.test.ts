/**
 * Dragging a grip.
 *
 * <p>Two things decide whether this feels like direct manipulation or like a number being
 * applied to an object. The first is the anchor: the grip opposite the one in your hand
 * must not move, by so much as a rounding error, at any point in the drag. The second is
 * the corner pulled mostly sideways under Shift — that is where "it keeps the
 * proportions" is either true or only nearly true.
 */
import { describe, expect, it } from 'vitest';
import { resizedShape, type ResizeOptions } from './resize';
import type { ShapeJson } from '@/api/types';

const base: ResizeOptions = {
  lockRatio: false, fromCenter: false, gridSnap: 0.25, snapEnabled: false,
};
const free = base;
const ratio: ResizeOptions = { ...base, lockRatio: true };
const centred: ResizeOptions = { ...base, fromCenter: true };
const snapped: ResizeOptions = { ...base, lockRatio: true, snapEnabled: true };
const snappedFree: ResizeOptions = { ...base, snapEnabled: true };

/** Corners run anticlockwise from the lower left, so 2 is the upper right. */
const LOWER_LEFT = 0;
const UPPER_RIGHT = 2;
/** Edge grips: 4 is the bottom, 5 the right. */
const RIGHT_EDGE = 5;

const ratioOf = (s: ShapeJson) => (s.kind === 'RECT' ? s.w / s.h : NaN);
const half = (s: ShapeJson) => (s.kind === 'RECT' ? { hx: s.w / 2, hy: s.h / 2 } : { hx: NaN, hy: NaN });

/**
 * Where the anchor ends up, in the frame the shape started in.
 *
 * <p>The origin moves by `offset` and the anchor sits a half-extent the other way from
 * it, so this is the one number that says whether the fixed point actually stayed fixed.
 */
function anchorAfter(
  out: { shape: ShapeJson; offset: { x: number; y: number } }, sx: number, sy: number,
) {
  const { hx, hy } = half(out.shape);
  return { x: out.offset.x - sx * hx, y: out.offset.y - sy * hy };
}

describe('the anchor does not move', () => {
  const desk: ShapeJson = { kind: 'RECT', w: 2.4, h: 1.2 };

  it('holds the opposite corner still while the dragged one follows the pointer', () => {
    // The desk spans -1.2..1.2 by -0.6..0.6, so dragging the upper right to (3, 0.6)
    // must leave the lower left exactly at (-1.2, -0.6) and put the right edge on x = 3.
    const out = resizedShape(desk, UPPER_RIGHT, { x: 3, y: 0.6 }, free);
    expect(out.shape).toEqual({ kind: 'RECT', w: 4.2, h: 1.2 });
    expect(out.offset.x).toBeCloseTo(0.9, 9);
    expect(out.offset.y).toBeCloseTo(0, 9);

    const a = anchorAfter(out, 1, 1);
    expect(a.x).toBeCloseTo(-1.2, 9);
    expect(a.y).toBeCloseTo(-0.6, 9);
  });

  it('holds it from the other corner too, where both signs flip', () => {
    const out = resizedShape(desk, LOWER_LEFT, { x: -2.4, y: -1.2 }, free);
    expect(out.shape.kind === 'RECT' && out.shape.w).toBeCloseTo(3.6, 9);
    expect(out.shape.kind === 'RECT' && out.shape.h).toBeCloseTo(1.8, 9);
    const a = anchorAfter(out, -1, -1);
    // The upper right stays where it was.
    expect(a.x).toBeCloseTo(1.2, 9);
    expect(a.y).toBeCloseTo(0.6, 9);
  });

  it('does not move anything when the grip is dropped back where it started', () => {
    const out = resizedShape(desk, UPPER_RIGHT, { x: 1.2, y: 0.6 }, free);
    expect(out.shape).toEqual(desk);
    expect(out.offset).toEqual({ x: 0, y: 0 });
  });

  it('holds the anchor under Shift as well, where the extents are derived not measured', () => {
    const out = resizedShape(desk, UPPER_RIGHT, { x: 3, y: 0.6 }, ratio);
    const a = anchorAfter(out, 1, 1);
    expect(a.x).toBeCloseTo(-1.2, 9);
    expect(a.y).toBeCloseTo(-0.6, 9);
  });

  it('holds the anchor even after the grid has rounded the size', () => {
    // Snapping changes the extent after the anchor has been worked out, so the offset has
    // to be derived from the SNAPPED size or the fixed point quietly drifts by the
    // rounding — which is exactly the kind of error nobody sees until a wall is 5mm off.
    const out = resizedShape(desk, UPPER_RIGHT, { x: 1.42, y: 0.71 }, snapped);
    const a = anchorAfter(out, 1, 1);
    expect(a.x).toBeCloseTo(-1.2, 9);
    expect(a.y).toBeCloseTo(-0.6, 9);
  });

  it('leaves the origin alone when Alt resizes about the centre', () => {
    const out = resizedShape(desk, UPPER_RIGHT, { x: 2.4, y: 1.2 }, centred);
    expect(out.shape).toEqual({ kind: 'RECT', w: 4.8, h: 2.4 });
    expect(out.offset).toEqual({ x: 0, y: 0 });
  });
});

describe('corner drags are free, and Shift keeps the proportions', () => {
  const desk: ShapeJson = { kind: 'RECT', w: 2.4, h: 1.2 };

  it('lets a plain drag change the two axes independently', () => {
    const out = resizedShape(desk, UPPER_RIGHT, { x: 3, y: 0.6 }, free);
    expect(out.shape.kind === 'RECT' && out.shape.w).toBeCloseTo(4.2, 9);
    expect(out.shape.kind === 'RECT' && out.shape.h).toBeCloseTo(1.2, 9);
    expect(ratioOf(out.shape)).toBeCloseTo(3.5, 9);
  });

  it('holds the ratio under Shift when the drag is almost entirely sideways', () => {
    // The case that matters. Pulled out along x and barely at all along y, independent
    // axes quietly turn a 2.4 x 1.2 desk into something a different shape entirely.
    const out = resizedShape(desk, UPPER_RIGHT, { x: 3, y: 0.6 }, ratio);
    expect(ratioOf(out.shape)).toBeCloseTo(2, 9);
    // 3.84, not 4.2. The scale is the pointer PROJECTED onto the diagonal measured from
    // the anchor, not whichever axis moved further — the two only differ off the
    // diagonal, which is where a max-of-the-two rule starts obeying a different axis
    // halfway through the drag and the shape visibly jumps.
    expect(out.shape.kind === 'RECT' && out.shape.w).toBeCloseTo(3.84, 9);
  });

  it('holds the ratio under Shift when the drag is almost entirely upward', () => {
    const out = resizedShape(desk, UPPER_RIGHT, { x: 1.2, y: 1.6 }, ratio);
    expect(ratioOf(out.shape)).toBeCloseTo(2, 9);
  });

  it('never collapses or flips when dragged past the anchor', () => {
    const out = resizedShape(desk, UPPER_RIGHT, { x: -5, y: -5 }, free);
    expect(out.shape.kind === 'RECT' && out.shape.w).toBeGreaterThan(0);
    expect(out.shape.kind === 'RECT' && out.shape.h).toBeGreaterThan(0);
  });

  it('snaps the longer side and derives the other, so the grid cannot skew the ratio', () => {
    // Snapping both independently rounds them to different fractions, and the ratio then
    // holds only by luck. The drag works out to 2.62 m wide; the grid rounds that to
    // 2.50 and the depth follows from the ratio rather than from its own rounding.
    const out = resizedShape(desk, UPPER_RIGHT, { x: 1.42, y: 0.71 }, snapped);
    expect(out.shape.kind === 'RECT' && out.shape.w).toBeCloseTo(2.5, 9);
    expect(out.shape.kind === 'RECT' && out.shape.h).toBeCloseTo(1.25, 9);
    expect(ratioOf(out.shape)).toBeCloseTo(2, 9);
  });

  it('snaps the longer side even when that is the height', () => {
    const tall: ShapeJson = { kind: 'RECT', w: 1, h: 4 };
    const out = resizedShape(tall, UPPER_RIGHT, { x: 0.45, y: 1.9 }, snapped);
    expect(out.shape.kind === 'RECT' && out.shape.h).toBeCloseTo(4, 9);
    expect(ratioOf(out.shape)).toBeCloseTo(0.25, 9);
  });
});

describe('edge grips move one axis', () => {
  const desk: ShapeJson = { kind: 'RECT', w: 2.4, h: 1.2 };

  it('changes only the axis it belongs to, whatever the pointer does on the other', () => {
    // The y of the pointer is wild on purpose: an edge grip has no business reading it.
    const out = resizedShape(desk, RIGHT_EDGE, { x: 3, y: 99 }, free);
    expect(out.shape).toEqual({ kind: 'RECT', w: 4.2, h: 1.2 });
    expect(out.offset.y).toBe(0);
  });

  it('ignores Shift, because grabbing an edge is already a one-axis request', () => {
    const out = resizedShape(desk, RIGHT_EDGE, { x: 3, y: 0 }, ratio);
    expect(out.shape).toEqual({ kind: 'RECT', w: 4.2, h: 1.2 });
  });

  it('anchors the opposite edge', () => {
    const out = resizedShape(desk, RIGHT_EDGE, { x: 3, y: 0 }, free);
    expect(anchorAfter(out, 1, 0).x).toBeCloseTo(-1.2, 9);
  });

  it('snaps on its own axis only', () => {
    const out = resizedShape(desk, RIGHT_EDGE, { x: 1.42, y: 0 }, snappedFree);
    expect(out.shape.kind === 'RECT' && out.shape.w).toBeCloseTo(2.5, 9);
    expect(out.shape.kind === 'RECT' && out.shape.h).toBeCloseTo(1.2, 9);
  });
});

describe('other shapes', () => {
  it('scales a traced outline rather than leaving it unresizable', () => {
    // A pen-drawn room had no grips at all: the only way to change its size was to delete
    // it and trace it again.
    const room: ShapeJson = { kind: 'POLYGON', points: [[-2, -1], [2, -1], [2, 1], [0, 3]] };
    // The outline reaches 2 along x and 3 along y, so its corner is (2, 3) and its anchor
    // is (-2, -3). Dragging to (4, 6) spans 6 by 9 — exactly 1.5x on both axes.
    const out = resizedShape(room, UPPER_RIGHT, { x: 4, y: 6 }, free);
    expect(out.shape.kind).toBe('POLYGON');
    if (out.shape.kind !== 'POLYGON') return;
    const factors = out.shape.points.map(([x, y], i) => {
      const [ox, oy] = room.kind === 'POLYGON' ? room.points[i]! : [1, 1];
      return Math.abs(ox) > 1e-9 ? x / ox : y / oy;
    });
    for (const f of factors) expect(f).toBeCloseTo(1.5, 9);
  });

  it('keeps a circle a circle, with or without Shift', () => {
    // One radius, so there is nothing to keep out of proportion and nothing for Shift to
    // change. Dragging the corner to (3, 4) is 1.375x along the diagonal from the anchor.
    const out = resizedShape({ kind: 'CIRCLE', r: 2 }, UPPER_RIGHT, { x: 3, y: 4 }, free);
    expect(out.shape).toEqual({ kind: 'CIRCLE', r: 2.75 });
    const shifted = resizedShape({ kind: 'CIRCLE', r: 2 }, UPPER_RIGHT, { x: 3, y: 4 }, ratio);
    expect(shifted.shape).toEqual(out.shape);
  });

  it('lets an ellipse be stretched on one axis from an edge', () => {
    // Squashing one axis is the only way to make an ellipse out of a round table, so the
    // edge grips have to reach it.
    const out = resizedShape({ kind: 'ELLIPSE', rx: 2, ry: 1 }, RIGHT_EDGE, { x: 5, y: 0 }, free);
    expect(out.shape).toEqual({ kind: 'ELLIPSE', rx: 3.5, ry: 1 });
  });

  it('keeps an ellipse proportional under Shift', () => {
    const out = resizedShape({ kind: 'ELLIPSE', rx: 2, ry: 1 }, UPPER_RIGHT, { x: 4, y: 2 }, ratio);
    expect(out.shape.kind === 'ELLIPSE' && out.shape.rx / out.shape.ry).toBeCloseTo(2, 9);
  });
});
