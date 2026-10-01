import { offsetRing } from './offset.js';
import { pointAtArcLength, projectToArcLength, ringPerimeter } from './ring.js';
import { tessellate } from './tessellate.js';
import type { PlaceSeatsRequest, Ring, SeatPlacement, Vec2 } from './types.js';
import { add, normalize, outwardNormal, scale, sub } from './vec.js';

const TAU = 2 * Math.PI;
const DEFAULT_TOLERANCE = 1e-3;

/** Edge indices of a tessellated RECT, which is wound CCW from the bottom-left corner. */
const RECT_EDGE_NAMES: Readonly<Record<string, number>> = {
  bottom: 0,
  right: 1,
  top: 2,
  left: 3,
};

/** A seat faces the table, so its heading is the inward direction. */
const facing = (outward: Vec2): number => Math.atan2(-outward.y, -outward.x);

/**
 * Largest-remainder allocation of `m` seats across gaps, proportional to gap length.
 * Ties break to the lower gap index so both languages allocate identically.
 */
function allocate(m: number, lengths: readonly number[], total: number): number[] {
  const k = lengths.length;
  if (k === 0) return [];
  const quotas = lengths.map((l) => (m * l) / total);
  const base = quotas.map((q) => Math.floor(q));
  const left = m - base.reduce((a, b) => a + b, 0);
  const order = base
    .map((b, j) => ({ j, rem: quotas[j]! - b }))
    .sort((a, b) => (b.rem !== a.rem ? b.rem - a.rem : a.j - b.j));
  for (let i = 0; i < left; i++) base[order[i]!.j] = base[order[i]!.j]! + 1;
  return base;
}

/**
 * Place seats around a table in TABLE-LOCAL space.
 *
 * This is the function the product requirement rests on: because step one flattens any
 * outline to a ring, one algorithm seats round, rectangular and irregular tables alike,
 * and re-running it after a resize is what makes the seats redistribute in proportion.
 */
export function placeSeats(req: PlaceSeatsRequest): SeatPlacement[] {
  const tolerance = req.tolerance ?? DEFAULT_TOLERANCE;
  const overrides = new Map((req.overrides ?? []).map((o) => [o.index, o]));
  const pinned = (index: number): SeatPlacement => {
    const o = overrides.get(index)!;
    return { index, x: o.x, y: o.y, rot: o.rot, override: true };
  };

  switch (req.rule.kind) {
    case 'MANUAL':
      return [...overrides.keys()].sort((a, b) => a - b).map(pinned);

    case 'RADIAL': {
      let rx: number;
      let ry: number;
      if (req.shape.kind === 'CIRCLE') {
        rx = ry = req.shape.r;
      } else if (req.shape.kind === 'ELLIPSE') {
        rx = req.shape.rx;
        ry = req.shape.ry;
      } else {
        throw new Error('RADIAL placement requires a CIRCLE or ELLIPSE table');
      }
      const { count } = req.rule;
      const startAngle = req.rule.startAngle ?? 0;
      const out: SeatPlacement[] = [];
      for (let i = 0; i < count; i++) {
        if (overrides.has(i)) {
          out.push(pinned(i));
          continue;
        }
        const t = startAngle + (TAU * i) / count;
        const p = {
          x: (rx + req.clearance) * Math.cos(t),
          y: (ry + req.clearance) * Math.sin(t),
        };
        out.push({ index: i, x: p.x, y: p.y, rot: facing(normalize(p)), override: false });
      }
      return out;
    }

    case 'EDGE_COUNTS': {
      const ring: Ring = tessellate(req.shape, tolerance);
      const counts = new Map<number, number>();
      for (const [key, v] of Object.entries(req.rule.counts)) {
        const idx = key in RECT_EDGE_NAMES ? RECT_EDGE_NAMES[key]! : Number.parseInt(key, 10);
        counts.set(idx, v);
      }
      const out: SeatPlacement[] = [];
      let index = 0;
      const n = ring.length;
      for (const edge of [...counts.keys()].sort((a, b) => a - b)) {
        const m = counts.get(edge)!;
        const p = ring[edge]!;
        const d = sub(ring[(edge + 1) % n]!, p);
        const nrm = outwardNormal(d);
        for (let j = 0; j < m; j++) {
          if (overrides.has(index)) {
            out.push(pinned(index));
          } else {
            const t = (j + 0.5) / m;
            const c = add(add(p, scale(d, t)), scale(nrm, req.clearance));
            out.push({ index, x: c.x, y: c.y, rot: facing(nrm), override: false });
          }
          index++;
        }
      }
      return out;
    }

    case 'PERIMETER_EVEN': {
      const { count } = req.rule;
      const startOffset = req.rule.startOffset ?? 0;
      const off = offsetRing(tessellate(req.shape, tolerance), req.clearance);
      const perimeter = ringPerimeter(off);

      const free: number[] = [];
      for (let i = 0; i < count; i++) if (!overrides.has(i)) free.push(i);

      let slots: number[];
      if (overrides.size === 0) {
        slots = free.map((i) => (perimeter * (i + startOffset)) / count);
      } else {
        // Project each pinned seat onto the ring, then share the remaining seats out
        // across the gaps between them, proportionally to gap length.
        const pins = [...overrides.values()]
          .map((o) => projectToArcLength(off, { x: o.x, y: o.y }))
          .sort((a, b) => a - b);

        const gaps: Array<{ s0: number; len: number }> =
          pins.length === 1
            ? [{ s0: pins[0]!, len: perimeter }]
            : pins.map((s0, j) => {
                let len = (pins[(j + 1) % pins.length]! - s0) % perimeter;
                if (len < 0) len += perimeter;
                return { s0, len };
              });

        const alloc = allocate(free.length, gaps.map((g) => g.len), perimeter);
        slots = [];
        gaps.forEach((g, j) => {
          const m = alloc[j]!;
          for (let k = 0; k < m; k++) slots.push((g.s0 + (g.len * (k + 1)) / (m + 1)) % perimeter);
        });
        // Assign in ascending arc length, not gap order, so a seat keeps roughly the
        // position it already had. Otherwise pinning one seat makes every other seat's
        // identity jump around the table.
        slots.sort((a, b) => a - b);
      }

      const out = new Array<SeatPlacement>(count);
      for (const i of overrides.keys()) out[i] = pinned(i);
      free.forEach((i, slotIndex) => {
        const sample = pointAtArcLength(off, slots[slotIndex]!);
        out[i] = {
          index: i,
          x: sample.point.x,
          y: sample.point.y,
          rot: facing(sample.outwardNormal),
          override: false,
        };
      });
      return out;
    }
  }
}
