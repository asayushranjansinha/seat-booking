/**
 * Pins the TypeScript geometry engine to the golden fixtures in
 * packages/geometry-fixtures. The Java engine in apps/api is pinned to the SAME files.
 * If these two suites ever disagree, CI fails in both languages — which is the only
 * thing keeping two implementations of the same maths honest.
 *
 * Do not fix a failure here by editing an implementation to match the other one.
 * Change the fixture first (see packages/geometry-fixtures/README.md).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  applyTransform,
  composeTransform,
  invertTransform,
  offsetRing,
  placeSeats,
  pointAtArcLength,
  pointInRing,
  ringCentroid,
  ringPerimeter,
  ringSignedArea,
  segmentCountForArc,
  shapeFromJson,
  tessellate,
} from '../src/index';
import type { ShapeJson } from '../src/codec';
import type { PlaceSeatsRequest, Ring, Transform, Vec2 } from '../src/types';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../geometry-fixtures/fixtures');
const TOL = 1e-6;

interface Fixture<I, E> {
  fn: string;
  note?: string;
  cases: Array<{ name: string; op?: string; input: I; expected: E }>;
}

function load<I, E>(file: string): Fixture<I, E> {
  return JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as Fixture<I, E>;
}

const toVec = (p: [number, number]): Vec2 => ({ x: p[0], y: p[1] });
const toRing = (pts: Array<[number, number]>): Ring => pts.map(toVec);

function expectVec(got: Vec2, want: [number, number], what: string): void {
  expect(got.x, `${what}.x`).toBeCloseTo(want[0], 6);
  expect(got.y, `${what}.y`).toBeCloseTo(want[1], 6);
}

function expectRing(got: Ring, want: Array<[number, number]>, what: string): void {
  // Vertex count must match EXACTLY. A differing count means the two implementations
  // disagree on a discrete decision (segment count, or whether a corner bevelled),
  // which no positional tolerance should ever paper over.
  expect(got.length, `${what}: vertex count`).toBe(want.length);
  got.forEach((p, i) => expectVec(p, want[i]!, `${what}[${i}]`));
}

describe('segmentCountForArc', () => {
  const fx = load<{ radius: number; tolerance: number }, { n: number }>('segment-count.json');
  for (const c of fx.cases) {
    it(c.name, () => {
      // Integer output: exact, never approximate.
      expect(segmentCountForArc(c.input.radius, c.input.tolerance)).toBe(c.expected.n);
    });
  }
});

describe('tessellate', () => {
  const fx = load<{ shape: ShapeJson; tolerance: number }, { ring: Array<[number, number]> }>(
    'tessellate.json',
  );
  for (const c of fx.cases) {
    it(c.name, () =>
      expectRing(
        tessellate(shapeFromJson(c.input.shape), c.input.tolerance),
        c.expected.ring,
        c.name,
      ),
    );
  }
});

describe('transform', () => {
  type In = { parent?: Transform; child?: Transform; transform?: Transform; point?: [number, number] };
  const fx = load<In, Transform & { point?: [number, number] }>('transform.json');
  for (const c of fx.cases) {
    it(c.name, () => {
      if (c.op === 'compose') {
        const got = composeTransform(c.input.parent!, c.input.child!);
        expect(got.x).toBeCloseTo(c.expected.x, 6);
        expect(got.y).toBeCloseTo(c.expected.y, 6);
        expect(got.rot).toBeCloseTo(c.expected.rot, 6);
      } else if (c.op === 'apply') {
        expectVec(applyTransform(c.input.transform!, toVec(c.input.point!)), c.expected.point!, c.name);
      } else {
        const got = invertTransform(c.input.transform!);
        expect(got.x).toBeCloseTo(c.expected.x, 6);
        expect(got.y).toBeCloseTo(c.expected.y, 6);
        expect(got.rot).toBeCloseTo(c.expected.rot, 6);
      }
    });
  }
});

describe('ring metrics', () => {
  const fx = load<
    { ring: Array<[number, number]> },
    { area: number; perimeter: number; centroid: [number, number] }
  >('ring-metrics.json');
  for (const c of fx.cases) {
    it(c.name, () => {
      const ring = toRing(c.input.ring);
      expect(ringSignedArea(ring)).toBeCloseTo(c.expected.area, 6);
      expect(ringPerimeter(ring)).toBeCloseTo(c.expected.perimeter, 6);
      expectVec(ringCentroid(ring), c.expected.centroid, `${c.name} centroid`);
    });
  }
});

describe('pointInRing', () => {
  const fx = load<{ ring: Array<[number, number]>; point: [number, number] }, { inside: boolean }>(
    'point-in-ring.json',
  );
  for (const c of fx.cases) {
    it(c.name, () =>
      expect(pointInRing(toRing(c.input.ring), toVec(c.input.point))).toBe(c.expected.inside),
    );
  }
});

describe('pointAtArcLength', () => {
  const fx = load<
    { ring: Array<[number, number]>; s: number },
    { point: [number, number]; tangent: [number, number]; outwardNormal: [number, number] }
  >('arc-length.json');
  for (const c of fx.cases) {
    it(c.name, () => {
      const got = pointAtArcLength(toRing(c.input.ring), c.input.s);
      expectVec(got.point, c.expected.point, `${c.name} point`);
      expectVec(got.tangent, c.expected.tangent, `${c.name} tangent`);
      expectVec(got.outwardNormal, c.expected.outwardNormal, `${c.name} normal`);
    });
  }
});

describe('offsetRing', () => {
  const fx = load<
    { ring: Array<[number, number]>; distance: number },
    { ring: Array<[number, number]> }
  >('offset-ring.json');
  for (const c of fx.cases) {
    it(c.name, () =>
      expectRing(offsetRing(toRing(c.input.ring), c.input.distance), c.expected.ring, c.name),
    );
  }
});

interface SeatsExpected {
  seats: Array<{ index: number; x: number; y: number; rot: number; override: boolean }>;
}

/** A placeSeats request as it appears in a fixture, i.e. with a wire-format shape. */
type PlaceSeatsRequestJson = Omit<PlaceSeatsRequest, 'shape'> & { shape: ShapeJson };

function checkSeats(input: PlaceSeatsRequestJson, expected: SeatsExpected, name: string): void {
  const got = placeSeats({ ...input, shape: shapeFromJson(input.shape) });
  expect(got.length, `${name}: seat count`).toBe(expected.seats.length);
  got.forEach((s, i) => {
    const w = expected.seats[i]!;
    expect(s.index, `${name}[${i}].index`).toBe(w.index);
    expect(s.override, `${name}[${i}].override`).toBe(w.override);
    expect(s.x, `${name}[${i}].x`).toBeCloseTo(w.x, 6);
    expect(s.y, `${name}[${i}].y`).toBeCloseTo(w.y, 6);
    expect(s.rot, `${name}[${i}].rot`).toBeCloseTo(w.rot, 6);
  });
}

describe('placeSeats', () => {
  const fx = load<PlaceSeatsRequestJson, SeatsExpected>('place-seats.json');
  for (const c of fx.cases) {
    it(c.name, () => checkSeats(c.input, c.expected, c.name));
  }
});

describe('headline requirement', () => {
  const fx = load<PlaceSeatsRequestJson, SeatsExpected>('headline.json');
  for (const c of fx.cases) {
    it(c.name, () => checkSeats(c.input, c.expected, c.name));
  }
});
