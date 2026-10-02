# Parametric Seat Booking — working conventions

A co-working seat-booking platform where the admin draws the building itself.

## The one idea everything hangs off

Every element stores a transform **local to its parent**. A seat's world position is
composed down the chain (floor -> room -> table -> seat). Rotating a table changes one
matrix and every seat follows. Never store absolute seat coordinates as the source of
truth; `world_x / world_y / world_rot` exist only as a denormalised read cache written
at publish time.

## Starting it

```bash
docker compose up -d                  # postgres 17 · redis · mailpit
cd apps/api && mvn spring-boot:run    # :8080 — Flyway migrates; seeds ONLY on an empty DB
cd apps/web && npm run dev            # :3000
```

Sign in at <http://localhost:3000>. Every demo account uses the password `password`, and
the sign-in page lists them — it asks the server, which answers only while the app is
running on the development JWT secret, so a real deployment shows nothing.

```bash
./tools/demo-reset.sh    # drop the schema and re-seed: 3 rooms, 4 tables, 27 seats
./tools/blank-slate.sh   # keep the accounts, delete everything else
./tools/add-people.sh    # add eight more people to whatever org exists
./tools/demo-race.sh     # 16 simultaneous bookings at one seat: 1 wins, 15 refused
./tools/mutation-check.sh
```

`demo-reset.sh` DROPS THE SCHEMA. The seeder only runs on an empty database, which is why
clearing rows does not bring the demo floor back.

## Layout

```
seat-booking/
├─ docker-compose.yml           postgres · redis · mailpit
├─ tools/                       demo and maintenance scripts
├─ packages/
│  ├─ geometry/                 the TS geometry engine
│  └─ geometry-fixtures/        shared golden test data (the spec)
└─ apps/
   ├─ web/    Next.js (TypeScript strict)
   │  └─ src/
   │     ├─ canvas/   three.js: scene graph, furniture symbols, picking, camera
   │     ├─ editor/   pure editing logic — see "What does NOT need a twin"
   │     ├─ state/    zustand store (+ zundo history)
   │     └─ components/
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

### What does NOT need a twin

`apps/web/src/editor/` holds geometry the browser runs **once**, to decide where to put
something, and then writes down as an ordinary transform the server already knows how to
store and validate. It needs no fixture and no Java counterpart, because nothing
re-derives it: the result IS the stored position.

| module | does |
|---|---|
| `arrange.ts` | lay a room's tables on a grid, inside the largest rectangle that fits the outline |
| `distribute.ts` | space / line up a selection within its partition |
| `clipboard.ts` | copy and paste a group, keeping its internal spacing |
| `resize.ts` | what a shape becomes when a grip is dragged |
| `shortcuts.ts` | which command a keystroke means |
| `extent.ts` | world boxes — table-plus-chairs — shared by the above |
| `pointer.ts` | where the pointer is, as a plain variable (see below) |

Keep that boundary sharp. The moment a calculation has to be reproduced from stored data
rather than read back from it, it belongs in `packages/geometry` with a fixture, in both
languages.

### Put arithmetic where a test can reach it

Four bugs in a row came from maths living inside the canvas effect, where no test can
call it: proportional resize, the view-switch camera, spacing, arranging. When something
is a calculation rather than a gesture, it goes in `editor/` and gets tested. The gesture
handlers in `EditorCanvas.tsx` should read as a list of decisions, not do sums.

## Conventions

- **Rings** are closed polygons stored **without** a repeated final point, wound CCW.
- **Angles** are radians everywhere in the model. Degrees only at the UI edge.
- **Units** are metres. Draw to scale: a 120 mm wall is 2.8 px on a floor-wide view
  because it is 120 mm. Do not flatter line weights.
- TypeScript: `strict`, no `any`, no default exports except Next.js pages/layouts.
- UI is Tailwind v4 + shadcn/ui. Design tokens live in `app/globals.css`; the canvas
  palette in `canvas/sceneGraph.ts` mirrors them as hex, because a WebGL material cannot
  read a CSS custom property. Change both together.
- **One glyph, one meaning.** Two buttons that look identical read as the same button.
  Repetition is fine when the meaning repeats (every spinner is `Loader2`).
- Feedback goes through `sonner` toasts, not inline status text.
- Java: constructor injection only, no field `@Autowired`. Records for DTOs.
- SQL migrations are explicit Flyway SQL — we use extensions, generated columns and
  exclusion constraints Hibernate DDL cannot express. Never `ddl-auto` beyond `validate`.
- Money is `numeric(12,2)`; never a float.

## Rules the DATABASE holds, not the application

A service-level check leaves a gap between the check and the insert, and that gap is
where two people get the same desk. Both of these are GiST exclusion constraints:

- `booking_no_overlap` — one booking per seat per period.
- `booking_one_desk_per_person` — one desk per person per period, **where
  `meeting_id IS NULL`**. That carve-out is the whole subtlety: booking a meeting writes
  one row per seat on the table, all owned by the organiser, so without it the rule would
  not stop anyone holding two desks — it would stop anyone booking a meeting at all.

A per-seat advisory lock (`pg_advisory_xact_lock`) queues contenders in front of the
constraint. It is a contention reducer, **not** the correctness mechanism; removing it
changes no outcome, only how often Postgres has to break a deadlock.

Seat codes are assigned **server-side on every save** (`SeatNumbering`), in reading order
across the floor. The browser cannot be the authority: two people editing one draft would
each renumber from their own view of it.

## The canvas is plain three.js, not react-three-fiber

R3F produced **zero draw calls** in this stack, verified against Next 15 and 16, React
19.2.8 and 19.3.0, Turbopack and webpack, with a single `react` and a single `three`
resolved through workspace `overrides`. Plain three.js rendered correctly in the same slot
in the same page, so the renderer is imperative and driven from the zustand store.

Things to know before touching `apps/web/src/canvas`:

- **Refresh `matrixWorld` before raycasting.** three.js updates world matrices during
  render, so a graph rebuilt since the last frame still carries identity matrices and
  every room hit-tests as if it sat at the origin.
- **A tool owns the press.** `onPointerDown` reads as a list of modes, most exclusive
  first — booking, 3D, not-editable, the sweep tool, the drawing tools — and only the
  pointer tool reaches picking, grips and dragging. When that rule lived in the ORDER of
  an if/else chain instead, one missed edit put a rubber band back on the pointer and
  took the grips away.
- **Pick the most specific thing, except what is already held.** Specificity is
  seat < furniture < gate < partition < room; anything already selected outranks all of
  it, so a press on a pile where one member is the group grabs the group.
- **Invisible pick targets must stay `visible`.** three.js skips invisible objects when
  raycasting. Hide them with `opacity: 0`.
- **The scene graph rebuilds on STORE changes only.** Refs the canvas draws from — the
  sweep box, the snap guides — must ask for a redraw themselves, and must be cleared
  BEFORE anything touches the store, because zustand notifies subscribers synchronously.
- **Draw symbols, not footprints.** A chair is a pad and a back built from proportions of
  the seat; the stored disc is what the validator measures and the pointer hits. An
  absolute 0.08 m detail is 1.9 px on a floor-wide view.

## Editing: tools and keys

`1` pointer · `2` sweep a box · `H` hand · `3/4/5` rect/round/pen room ·
`6/7` rect/round table · `8` door · `9` partition

`⌘C` copy · `⌘V` paste at the pointer · `⌘D` duplicate below · `⌘A` select all ·
`⌘Z` undo · `0` or `⇧1` fit the floor · arrows nudge, `⇧`+arrows nudge further ·
Space-drag, two-finger scroll, or the hand tool to pan · pinch or `⌘`-scroll to zoom.

A corner grip keeps proportions; **Shift** stretches one axis. That inverts Figma on
purpose: a floor plan is full of real objects with real proportions.

## State of play

Shipped: the geometry engines and fixtures; schema, auth, layout API and publish; the
editor; booking with live occupancy; meetings with real iCalendar invites; buildings and
floors; call cabins; one desk per person; multi-select, copy/paste, arrange, space and
line up; pan/zoom; plan and 3D drawn from one set of numbers.

Known gaps, in the order they would block a sale:

1. **No way to create a user.** No sign-up, no invite, no admin screen. Accounts come
   from the seeder or `tools/add-people.sh`, which is a script against the database.
2. **No mobile layout.** Fixed 320 px panels; unusable below ~1100 px.
3. **No reporting.** The planner is what the office manager uses; utilisation is what the
   person signing the cheque buys.
4. **Desk bookings reach no calendar.** Only meetings emit `.ics`.
5. **No check-in / no-show release** — the headline ROI claim of this product category.

Also outstanding: toilets as a floor element, alleyways between rooms (needs a decision —
a floor has no outline today, so "the space between rooms" has no outer edge), seat-level
rate overrides, and M4 hardening (invoices, Testcontainers, OpenAPI, accessibility).

## Testing

```bash
cd packages/geometry && npx vitest run     # 85 — the fixture spec
cd apps/web && npx vitest run              # 96 — editor logic
cd apps/api && mvn test                    # see the caveat below
cd apps/web && npm run build:check         # separate distDir, safe while dev runs
./tools/mutation-check.sh
```

**Write the test so it fails for the right reason.** Several tests in this repo passed
while proving nothing until the fixture was made to discriminate: a symmetric row cannot
tell gap-spacing from centre-spacing; identical chairs on every table cannot tell whether
chairs are measured at all; two anagrams cannot tell a hash from a sum. If a mutant
survives, the test is the thing that is wrong.

**The Java suite needs the seeded demo floor.** `LayoutLifecycleTest`, `MeetingFlowTest`
and `BookingConcurrencyTest` assert against three named rooms, a table called 'Round
Table' and seat C3. After `blank-slate.sh` they error with a message saying exactly that.
Tests about RULES rather than about the seed call `DemoData.requireAnyPublishedSeats()`
and run against whatever floor exists.
