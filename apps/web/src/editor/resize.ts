/**
 * What a shape becomes when one of its grips is dragged.
 *
 * <p>Its own module because it is arithmetic, and arithmetic inside a canvas effect is
 * arithmetic nothing can test. The rules here have real edge cases — a drag that crosses
 * the centre, a grid snap that must not quietly change a ratio — and the only honest way
 * to know they hold is to check them.
 */
import { snapValue } from '@/state/editorStore';
import type { ShapeJson } from '@/api/types';

/** Which way a corner lies from the centre: 0 is lower-left, going round clockwise. */
const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

/** The smallest anything may be dragged down to, in metres. */
const MIN = 0.2;

export interface ResizeOptions {
  /** Shift: stretch one axis only, instead of keeping the proportions. */
  free: boolean;
  gridSnap: number;
  snapEnabled: boolean;
}

/**
 * Resize a shape by dragging grip {@code index} to {@code p}, in the shape's own frame.
 *
 * <p>Corners keep the proportions. Dragging one used to set the width from the pointer's
 * x and the height from its y, independently, so a sideways pull made a table wider
 * without making it longer and the thing you had carefully proportioned came out as a
 * different object. A corner now works out ONE scale — the pointer projected onto the
 * diagonal it is dragging — and applies it to both.
 *
 * <p>Shift stretches one way only. That is the opposite of Figma's default, on purpose: a
 * floor plan is full of real objects with real proportions, and a 1.2 m desk that is
 * suddenly 1.2 x 4 m is nearly always a slip rather than an intent. The axis grips on an
 * ellipse are the exception and stay per-axis under Shift, because stretching one axis is
 * the only way to make an ellipse out of a circle.
 */
export function resizedShape(
  shape: ShapeJson, index: number, p: { x: number; y: number }, options: ResizeOptions,
): ShapeJson {
  const { free, gridSnap, snapEnabled } = options;
  const fit = (v: number) => Math.max(MIN, snapValue(Math.abs(v), gridSnap, snapEnabled));

  /**
   * One scale factor for a corner drag: the pointer projected onto the diagonal.
   *
   * <p>Taking whichever axis moved further instead makes the shape jump as the drag
   * crosses the diagonal, because the axis in charge changes halfway through.
   */
  const diagonalScale = (hx: number, hy: number) => {
    const [sx, sy] = CORNER_SIGNS[((index % 4) + 4) % 4]!;
    const cx = sx * hx;
    const cy = sy * hy;
    const len2 = cx * cx + cy * cy;
    return len2 > 1e-9 ? Math.max(0.01, (p.x * cx + p.y * cy) / len2) : 1;
  };

  switch (shape.kind) {
    case 'RECT': {
      // The grip is a corner, so its distance from the centre is the half-extent.
      if (free) return { kind: 'RECT', w: fit(p.x * 2), h: fit(p.y * 2) };

      const scale = diagonalScale(shape.w / 2, shape.h / 2);
      // Snap the LONGER side and derive the other from the ratio. Snapping both would
      // round them to different fractions and quietly change the proportions, which is
      // the whole thing this is here to preserve.
      if (shape.w >= shape.h) {
        const w = fit(shape.w * scale);
        return { kind: 'RECT', w, h: Math.max(MIN, w * (shape.h / shape.w)) };
      }
      const h = fit(shape.h * scale);
      return { kind: 'RECT', w: Math.max(MIN, h * (shape.w / shape.h)), h };
    }

    case 'CIRCLE':
      // Already uniform: there is only one number to drag.
      return { kind: 'CIRCLE', r: fit(Math.hypot(p.x, p.y)) };

    case 'ELLIPSE': {
      if (free) {
        return index === 0
          ? { kind: 'ELLIPSE', rx: fit(p.x), ry: shape.ry }
          : { kind: 'ELLIPSE', rx: shape.rx, ry: fit(p.y) };
      }
      const scale = diagonalScale(shape.rx, shape.ry);
      const rx = fit(shape.rx * scale);
      return { kind: 'ELLIPSE', rx, ry: Math.max(MIN, rx * (shape.ry / shape.rx)) };
    }

    case 'POLYGON': {
      // A traced outline has no width to type, so scaling it is the only way to resize it
      // at all. Its points are centred on the shape's own origin, so multiplying them
      // through keeps the outline and changes only its size.
      const hx = Math.max(...shape.points.map(([x]) => Math.abs(x)), MIN);
      const hy = Math.max(...shape.points.map(([, y]) => Math.abs(y)), MIN);
      if (free) {
        const sx = Math.max(0.01, Math.abs(p.x) / hx);
        const sy = Math.max(0.01, Math.abs(p.y) / hy);
        return { kind: 'POLYGON', points: shape.points.map(([x, y]) => [x * sx, y * sy]) };
      }
      const scale = diagonalScale(hx, hy);
      // Snapped on the outline's own extent, so a traced room still lands on the grid.
      const snapped = Math.max(MIN, snapValue(hx * scale, gridSnap, snapEnabled)) / hx;
      return { kind: 'POLYGON', points: shape.points.map(([x, y]) => [x * snapped, y * snapped]) };
    }

    default:
      return shape;
  }
}
