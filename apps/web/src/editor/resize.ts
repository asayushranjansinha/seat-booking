/**
 * What a shape becomes when one of its grips is dragged.
 *
 * <p>Its own module because it is arithmetic, and arithmetic inside a canvas effect is
 * arithmetic nothing can test. The rules here have real edge cases — a drag that crosses
 * the centre, a grid snap that must not quietly change a ratio, an anchor that has to
 * stay still while everything around it moves — and the only honest way to know they
 * hold is to check them.
 *
 * <p>The conventions are Figma's, because that is the editor everyone arrives here
 * already knowing: a corner resizes freely, Shift keeps the proportions, Alt resizes
 * about the centre, and the grip opposite the one being dragged does not move.
 */
import { snapValue } from '@/state/editorStore';
import type { ShapeJson } from '@/api/types';

/**
 * Which way a grip lies from the centre.
 *
 * <p>0-3 are the corners, anticlockwise from the lower left. 4-7 are the edge grips, and
 * their zero component is what marks the axis they leave alone.
 */
const GRIP_SIGNS = [
  [-1, -1], [1, -1], [1, 1], [-1, 1],
  [0, -1], [1, 0], [0, 1], [-1, 0],
] as const;

/** How many grips a shape can have. Corners are the first {@link CORNER_GRIPS}. */
export const CORNER_GRIPS = 4;
export const GRIP_COUNT = GRIP_SIGNS.length;

/** The smallest full dimension anything may be dragged down to, in metres. */
const MIN = 0.2;

export interface ResizeOptions {
  /** Shift: keep the proportions. */
  lockRatio: boolean;
  /** Alt: resize about the centre, leaving the origin where it is. */
  fromCenter: boolean;
  gridSnap: number;
  snapEnabled: boolean;
}

export interface ResizeResult {
  shape: ShapeJson;
  /**
   * How far the entity's own origin has to move, in the entity's own unrotated frame,
   * for the grip opposite the dragged one to stay where it was.
   *
   * <p>Zero when resizing from the centre. The caller rotates this into the parent's
   * frame; this module does not know where the entity sits.
   */
  offset: { x: number; y: number };
}

/** Half the width and half the height of whatever the shape is. */
function halfExtents(shape: ShapeJson): { hx: number; hy: number } {
  switch (shape.kind) {
    case 'RECT': return { hx: shape.w / 2, hy: shape.h / 2 };
    case 'CIRCLE': return { hx: shape.r, hy: shape.r };
    case 'ELLIPSE': return { hx: shape.rx, hy: shape.ry };
    case 'POLYGON': return {
      hx: Math.max(...shape.points.map(([x]) => Math.abs(x)), MIN / 2),
      hy: Math.max(...shape.points.map(([, y]) => Math.abs(y)), MIN / 2),
    };
    default: return { hx: MIN / 2, hy: MIN / 2 };
  }
}

/**
 * Resize a shape by dragging grip {@code index} to {@code p}, in the shape's own frame.
 *
 * <p>The anchor is the grip diagonally opposite, and it is the fixed point of the whole
 * operation: dragging the bottom-right corner leaves the top-left exactly where it was,
 * which is the thing that makes a resize feel like direct manipulation rather than a
 * scale factor being applied to an object. The shape itself only carries extents, so
 * holding the anchor still means moving the origin too — that is what {@code offset} is.
 *
 * <p>Alt takes the anchor back to the centre, which is the old behaviour and still the
 * right one when a table is meant to stay where it is and only change size.
 */
export function resizedShape(
  shape: ShapeJson, index: number, p: { x: number; y: number }, options: ResizeOptions,
): ResizeResult {
  const { fromCenter, gridSnap, snapEnabled } = options;
  const [sx, sy] = GRIP_SIGNS[((index % GRIP_COUNT) + GRIP_COUNT) % GRIP_COUNT]!;
  const { hx, hy } = halfExtents(shape);

  // A circle has one radius, so it cannot be anything but proportional.
  const lockRatio = options.lockRatio || shape.kind === 'CIRCLE';
  // An edge grip moves one axis by definition; locking the ratio there would make the
  // other axis move too, which is not what grabbing an edge asks for.
  const isCorner = sx !== 0 && sy !== 0;

  /** The full extent an axis wants, before snapping. */
  const wanted = (pv: number, h: number, s: number) => {
    if (s === 0) return 2 * h;
    // Anchored at -s*h, so the new full extent is simply the span from anchor to pointer.
    return fromCenter ? 2 * Math.abs(pv) : Math.abs(pv + s * h);
  };

  let fullX = wanted(p.x, hx, sx);
  let fullY = wanted(p.y, hy, sy);

  if (lockRatio && isCorner) {
    // One scale for both axes: the pointer projected onto the diagonal it is dragging,
    // measured from the anchor. Taking whichever axis moved further instead makes the
    // shape jump as the drag crosses the diagonal, because the axis in charge changes
    // halfway through.
    const qx = fromCenter ? p.x : p.x + sx * hx;
    const qy = fromCenter ? p.y : p.y + sy * hy;
    const cx = (fromCenter ? 1 : 2) * sx * hx;
    const cy = (fromCenter ? 1 : 2) * sy * hy;
    const len2 = cx * cx + cy * cy;
    const scale = len2 > 1e-9 ? Math.max(0.01, (qx * cx + qy * cy) / len2) : 1;
    fullX = 2 * hx * scale;
    fullY = 2 * hy * scale;
  }

  if (lockRatio) {
    // Snap the LONGER side and derive the other from the ratio. Snapping both would round
    // them to different fractions and quietly change the proportions, which is the whole
    // thing this branch is here to preserve.
    const ratio = fullX >= fullY ? fullY / Math.max(fullX, 1e-9) : fullX / Math.max(fullY, 1e-9);
    if (fullX >= fullY) {
      fullX = Math.max(MIN, snapValue(fullX, gridSnap, snapEnabled));
      fullY = Math.max(MIN, fullX * ratio);
    } else {
      fullY = Math.max(MIN, snapValue(fullY, gridSnap, snapEnabled));
      fullX = Math.max(MIN, fullY * ratio);
    }
  } else {
    if (sx !== 0) fullX = Math.max(MIN, snapValue(fullX, gridSnap, snapEnabled));
    if (sy !== 0) fullY = Math.max(MIN, snapValue(fullY, gridSnap, snapEnabled));
  }

  const nhx = fullX / 2;
  const nhy = fullY / 2;

  // Holding the anchor still moves the centre by exactly the change in half-extent,
  // in the direction of the grip being dragged.
  const offset = fromCenter
    ? { x: 0, y: 0 }
    : { x: sx * (nhx - hx), y: sy * (nhy - hy) };

  return { shape: rebuild(shape, nhx, nhy), offset };
}

/** The same kind of shape, at the new extents. */
function rebuild(shape: ShapeJson, nhx: number, nhy: number): ShapeJson {
  switch (shape.kind) {
    case 'RECT':
      return { kind: 'RECT', w: nhx * 2, h: nhy * 2 };
    case 'CIRCLE':
      return { kind: 'CIRCLE', r: nhx };
    case 'ELLIPSE':
      return { kind: 'ELLIPSE', rx: nhx, ry: nhy };
    case 'POLYGON': {
      // A traced outline has no width to type, so scaling it is the only way to resize it
      // at all. Its points are centred on the shape's own origin, so multiplying them
      // through keeps the outline and changes only its size.
      const { hx, hy } = halfExtents(shape);
      const kx = nhx / Math.max(hx, 1e-9);
      const ky = nhy / Math.max(hy, 1e-9);
      return { kind: 'POLYGON', points: shape.points.map(([x, y]) => [x * kx, y * ky]) };
    }
    default:
      return shape;
  }
}
