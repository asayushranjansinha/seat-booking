import type { Ring, Vec2 } from './types';
import { add, dot, length, outwardNormal, scale, sub } from './vec';

export const MITER_LIMIT = 4;

/**
 * Offset a CCW ring outward by `distance`, with miter joins that fall back to a bevel
 * past MITER_LIMIT.
 *
 * Deliberately hand-rolled rather than delegated to clipper2-js on the client and JTS
 * `buffer()` on the server: those two libraries are not guaranteed to agree
 * vertex-for-vertex, and this function sits directly under seat placement, where the two
 * implementations must produce identical output. JTS is still used server-side for
 * predicates (contains / intersects / Polygonizer), where tolerance-level agreement is
 * all that is needed.
 */
export function offsetRing(ring: Ring, distance: number): Ring {
  const n = ring.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]!;
    const cur = ring[i]!;
    const next = ring[(i + 1) % n]!;

    const n0 = outwardNormal(sub(cur, prev));
    const n1 = outwardNormal(sub(next, cur));
    const m = add(n0, n1);
    const mLen = length(m);

    // A 180-degree turn has no miter point; emit both offset corners.
    if (mLen < 1e-12) {
      out.push(add(cur, scale(n0, distance)));
      out.push(add(cur, scale(n1, distance)));
      continue;
    }

    const mUnit = scale(m, 1 / mLen);
    const cosHalf = dot(mUnit, n0);
    if (cosHalf <= 1 / MITER_LIMIT) {
      out.push(add(cur, scale(n0, distance)));
      out.push(add(cur, scale(n1, distance)));
    } else {
      out.push(add(cur, scale(mUnit, distance / cosHalf)));
    }
  }
  return out;
}
