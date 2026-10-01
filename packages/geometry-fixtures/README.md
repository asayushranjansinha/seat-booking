# geometry-fixtures — the shared spec

These fixtures are the **specification** for the geometry engine. Two implementations
exist (TypeScript in `apps/web`, Java in `apps/api`) and both are pinned here.
Vitest and JUnit read these same JSON files. Divergence fails CI in both languages.

To change behaviour: **change the fixture first**, then make both languages agree.
Never edit one implementation to match the other.

## Provenance

The expected values are produced by `tools/oracle/oracle.py` — an independent reference
implementation in a third language, written from the formulas below rather than from
either shipped implementation. A fixture that was generated *by* the code under test
cannot catch a bug in that code; this one can.

Regenerate with `npm run fixtures:gen` (never by hand).

## Conventions

- **Units** metres. **Angles** radians. **Rings** closed polygons stored *without* a
  repeated final vertex, wound **counter-clockwise**.
- For a CCW ring the interior lies to the **left** of each directed edge, so the
  **outward** normal of an edge with direction `d = (dx, dy)` is `(dy, -dx)` normalised.
- Position comparisons use absolute tolerance **1e-6**. Integer outputs (segment counts,
  seat counts, edge indices) must match **exactly**.

## Determinism across languages

`sin`, `cos`, `atan2`, `acos` are *not* correctly rounded by IEEE-754, so JS and Java may
differ in the last ulp. That is harmless at 1e-6 for positions — but **fatal for anything
feeding an integer decision**, because a 1-ulp difference can flip a `ceil`.

Therefore every integer is derived using only `+ - * /` and `sqrt`, which IEEE-754 *does*
require to be correctly rounded. In particular the arc segment count is

```
segmentCountForArc(r, tol):
    n = ceil(PI * sqrt(r / (2 * tol)))     # sagitta error r(1-cos(PI/n)) ~= r*PI^2/(2n^2)
    n = 4 * ceil(n / 4)                    # multiple of 4 keeps quadrant symmetry
    clamp to [12, 512]
```

`offsetRing` is hand-rolled identically in both languages rather than delegated to
clipper2-js / JTS `buffer()`, because those two libraries are not guaranteed to agree
vertex-for-vertex. JTS is still used on the Java side for *predicates*
(`contains`, `intersects`, `Polygonizer`), where tolerance-level agreement suffices.

## Function surface covered

| Fixture file | Function |
| --- | --- |
| `segment-count.json` | `segmentCountForArc(radius, tolerance) -> int` |
| `tessellate.json` | `tessellate(shape, tolerance) -> Ring` |
| `transform.json` | `composeTransform`, `applyTransform`, `invertTransform` |
| `ring-metrics.json` | `ringArea`, `ringPerimeter`, `ringCentroid`, `pointInRing` |
| `arc-length.json` | `pointAtArcLength(ring, s) -> {point, tangent, outwardNormal}` |
| `offset-ring.json` | `offsetRing(ring, distance) -> Ring` (miter joins, limit 4) |
| `place-seats.json` | `placeSeats(request) -> SeatPlacement[]` |
| `headline.json` | resize / rotate / override behaviour — the product requirement |

## Shapes

```ts
type Shape =
  | { kind: 'RECT';    w: number; h: number }
  | { kind: 'CIRCLE';  r: number }
  | { kind: 'ELLIPSE'; rx: number; ry: number }
  | { kind: 'POLYGON'; points: Vec2[] }
```

`PATH` (bezier) is deliberately **not** in M1. It sits behind the same `tessellate` seam
so it can be added later without touching anything downstream.

`RECT` tessellates centred on the origin, CCW from the bottom-left corner, so its edge
indices are stable and nameable:

```
0 = bottom   1 = right   2 = top   3 = left
```

## Placement rules

`placeSeats` returns seats in **table-local** space. `rot` is the seat's facing — the
angle of the vector pointing from the seat toward the table.

- **`PERIMETER_EVEN`** `{ count, startOffset }` — offset the table ring outward by
  `clearance`, then place `count` seats at arc lengths `P * (i + startOffset) / count`.
  Resizing the table changes `P`, so the seats redistribute in proportion. This is the
  rule that delivers the headline requirement.
- **`EDGE_COUNTS`** `{ counts }` — keyed by edge index (or `top`/`right`/`bottom`/`left`
  for `RECT`). Seats sit on the edge's outward offset at parameters `(j + 0.5) / m`, so
  `m` seats are centred across the edge. Operates on the *original* edges, not the offset
  ring, so indices stay stable even where a miter bevels.
- **`RADIAL`** `{ count, startAngle }` — for `CIRCLE` / `ELLIPSE`; seats at
  `((rx + clearance) cos t, (ry + clearance) sin t)`.
- **`MANUAL`** — every seat is an override.

### Overrides — the rule that makes manual and automatic coexist

Dragging a seat sets `override: true` on that placement. Regeneration then:

1. projects each overridden seat onto the offset ring to get its arc length,
2. sorts them, splitting the ring into cyclic gaps,
3. allocates the free seats across gaps **proportionally to gap length**, using the
   largest-remainder method with ties broken by ascending gap index (so the allocation is
   identical in both languages),
4. places `m` free seats inside a gap of length `L` at `s_start + L*(j+1)/(m+1)`, which
   keeps them clear of the pinned seats at either end,
5. sorts the resulting slots by **ascending arc length** before assigning free seats to
   them in index order. Without this step a free seat is assigned the first slot after
   the first *pin*, so pinning one seat makes every other seat's identity jump around
   the table — seat A3 visibly teleports when you drag A2.

So the admin gets proportional behaviour **and** full manual control, rather than having
to choose between them.
