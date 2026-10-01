import type { Ring, Shape, Vec2 } from './types';

const TAU = 2 * Math.PI;

/**
 * Number of segments used to approximate a full circle of the given radius within
 * `tolerance` metres of sagitta error.
 *
 * This value feeds an INTEGER decision, so it must be byte-identical in TypeScript and
 * Java. `sin`, `cos` and `acos` are not correctly rounded by IEEE-754 and can differ in
 * the last ulp between runtimes, which is enough to flip a `ceil`. Only `+ - * /` and
 * `sqrt` are guaranteed correctly rounded, so the count is derived from the small-angle
 * sagitta approximation  e = r(1 - cos(PI/n)) ~= r*PI^2/(2n^2)  solved for n, which
 * needs nothing but a square root.
 */
export function segmentCountForArc(radius: number, tolerance: number): number {
  let n = Math.ceil(Math.PI * Math.sqrt(radius / (2 * tolerance)));
  n = 4 * Math.floor((n + 3) / 4); // multiple of 4 keeps quadrant symmetry
  if (n < 12) n = 12;
  if (n > 512) n = 512;
  return n;
}

/** Twice the signed area. Positive for a CCW ring. */
export function ringSignedArea(ring: Ring): number {
  let s = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    s += p.x * q.y - q.x * p.y;
  }
  return 0.5 * s;
}

/**
 * Reduce any shape to a polygon ring. Rendering, offsetting, hit-testing, overlap
 * validation and 3D extrusion all run on the output of this one function, which is what
 * keeps "any shape" from being a feature with a cost spread across the codebase.
 */
export function tessellate(shape: Shape, tolerance: number): Ring {
  switch (shape.kind) {
    case 'RECT': {
      const w = shape.w / 2;
      const h = shape.h / 2;
      // CCW from bottom-left, so edge indices are stable: 0=bottom 1=right 2=top 3=left
      return [
        { x: -w, y: -h },
        { x: w, y: -h },
        { x: w, y: h },
        { x: -w, y: h },
      ];
    }
    case 'CIRCLE': {
      const n = segmentCountForArc(shape.r, tolerance);
      const out: Vec2[] = new Array<Vec2>(n);
      for (let i = 0; i < n; i++) {
        const t = (TAU * i) / n;
        out[i] = { x: shape.r * Math.cos(t), y: shape.r * Math.sin(t) };
      }
      return out;
    }
    case 'ELLIPSE': {
      const n = segmentCountForArc(Math.max(shape.rx, shape.ry), tolerance);
      const out: Vec2[] = new Array<Vec2>(n);
      for (let i = 0; i < n; i++) {
        const t = (TAU * i) / n;
        out[i] = { x: shape.rx * Math.cos(t), y: shape.ry * Math.sin(t) };
      }
      return out;
    }
    case 'POLYGON': {
      const pts = shape.points.map((p) => ({ x: p.x, y: p.y }));
      if (ringSignedArea(pts) < 0) pts.reverse();
      return pts;
    }
  }
}
