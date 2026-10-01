# Parametric Seat Booking — working conventions

A co-working seat-booking platform where the admin draws the building itself.
Architecture & build plan: Rev A, 2026-10-01.

## The one idea everything hangs off

Every element stores a transform **local to its parent**. A seat's world position is
composed down the chain (floor -> room -> table -> seat). Rotating a table changes one
matrix and every seat follows. Never store absolute seat coordinates as the source of
truth; `world_x / world_y / world_rot` exist only as a denormalised read cache written
at publish time.

## Layout

```
seat-booking/
├─ docker-compose.yml           postgres · redis · mailpit
├─ packages/geometry-fixtures/  shared golden test data (the spec)
└─ apps/
   ├─ web/    Next.js (TypeScript strict)
   └─ api/    Spring Boot (Maven, Java 21)
```

## Geometry is implemented twice, on purpose

The browser needs it locally for 60fps dragging; the server must re-validate because a
client cannot be trusted. Both implementations are pinned to the golden fixtures in
`packages/geometry-fixtures/fixtures/` — read by Vitest **and** JUnit at `1e-6`.

Rules:
- **Fixtures are the spec.** Change behaviour by changing a fixture first, then make both
  languages agree. Never edit one implementation to match the other without a fixture.
- Segment counts for curved shapes must match **exactly** across languages. Derive them
  only with `+ - * /` and `sqrt` (IEEE-754 correctly rounded in both). Never with
  `acos`/`atan2`, which are not.
- Vertex positions compare at `1e-6`; ulp-level `sin`/`cos` differences are expected.
- The Java side uses JTS for predicates (`contains`, `intersects`, `buffer`,
  `Polygonizer`). Do not hand-write computational geometry where correctness counts.

## Conventions

- **Rings** are closed polygons stored **without** a repeated final point, wound CCW.
- **Angles** are radians everywhere in the model. Degrees only at the UI edge.
- **Units** are metres.
- TypeScript: `strict`, no `any`, no default exports except Next.js pages/layouts.
- Java: constructor injection only, no field `@Autowired`. Records for DTOs.
- SQL migrations are explicit Flyway SQL — we use extensions, generated columns and
  exclusion constraints Hibernate DDL cannot express. Never `ddl-auto` beyond `validate`.
- Money is `numeric(12,2)`; never a float.

## Milestones

- **M1a** geometry engines + fixtures green in both languages  <- current
- **M1b** schema, auth, layout API, publish
- **M1c** editor UI
- **M2** booking · **M3** meetings & email · **M4** hardening

Deferred from M1 deliberately: bezier `PATH` shapes. The four concrete shapes ship behind
the same `tessellate` seam so paths slot in later without touching downstream code.
