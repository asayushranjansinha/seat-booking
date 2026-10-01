import type { ArcSample, Ring, Vec2 } from './types.js';
import { add, dot, length, normalize, scale, sub } from './vec.js';

export { ringSignedArea } from './tessellate.js';
import { ringSignedArea } from './tessellate.js';

export function ringPerimeter(ring: Ring): number {
  let p = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) p += length(sub(ring[(i + 1) % n]!, ring[i]!));
  return p;
}

export function ringCentroid(ring: Ring): Vec2 {
  const a = ringSignedArea(ring);
  const n = ring.length;
  if (Math.abs(a) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Ray casting. Behaviour exactly on the boundary is unspecified and not fixtured. */
export function pointInRing(ring: Ring, pt: Vec2): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    if (a.y > pt.y !== b.y > pt.y) {
      const xCross = ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
      if (pt.x < xCross) inside = !inside;
    }
  }
  return inside;
}

/** Walk the ring to arc length `s`, wrapping modulo the perimeter (negative s included). */
export function pointAtArcLength(ring: Ring, s: number): ArcSample {
  const n = ring.length;
  const perimeter = ringPerimeter(ring);
  let target = s % perimeter;
  if (target < 0) target += perimeter;

  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const d = sub(q, p);
    const l = length(d);
    if (acc + l >= target || i === n - 1) {
      const t = l === 0 ? 0 : (target - acc) / l;
      const u = normalize(d);
      return {
        point: add(p, scale(d, t)),
        tangent: u,
        outwardNormal: { x: u.y, y: -u.x },
      };
    }
    acc += l;
  }
  throw new Error('unreachable: arc length walk fell off the ring');
}

/** Arc length of the closest point on the ring. Ties break to the lower edge index. */
export function projectToArcLength(ring: Ring, pt: Vec2): number {
  const n = ring.length;
  let bestD2 = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const d = sub(q, p);
    const l = length(d);
    if (l === 0) continue;
    let t = dot(sub(pt, p), d) / (l * l);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const diff = sub(pt, add(p, scale(d, t)));
    const d2 = dot(diff, diff);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestS = acc + t * l;
    }
    acc += l;
  }
  return bestS;
}
