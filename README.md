# Parametric Seat Booking

A co-working platform where the admin draws the building itself — arbitrary rooms, tables
and seats — and the seats behave parametrically rather than as frozen coordinates.

The requirement that shapes the whole system is this one: **place a seat at an angle, and
the nearby seats move in the same proportion.** Every element therefore stores a transform
local to its parent, and a seat's world position is composed down the chain. Rotating a
table changes one matrix and every seat follows; no seat record is rewritten, so nothing
can drift out of alignment.

## Running it

```bash
docker compose up -d                  # postgres 17, redis, mailpit
cd apps/api && mvn spring-boot:run    # :8080, Flyway migrates and seeds a demo floor
cd apps/web && npm run dev            # :3000
```

Sign in at <http://localhost:3000>. Every account uses the password `password`, and the
sign-in page lists the ones that exist — it asks the server, which answers only on the
development JWT secret, so a real deployment shows nothing.

## Giving a demo

`DEMO.md` is a 15-minute script with what to click and what to say.

```bash
./tools/demo-reset.sh    # DROPS THE SCHEMA and re-seeds: 3 rooms, 4 tables, 27 seats
./tools/blank-slate.sh   # keep the accounts, delete every building, booking and plan
./tools/add-people.sh    # add eight more people to whichever org exists
./tools/demo-race.sh     # 16 simultaneous bookings at one seat: 1 wins, 15 refused
```

The seeder only runs on an **empty** database, which is why clearing rows does not bring
the demo floor back and `demo-reset.sh` drops the schema instead.

## Building

```bash
cd apps/web
npm run dev           # :3000
npm run build:check   # verification build into .next-check, safe while dev is running
npm run clean         # if the page ever goes blank: clears both build dirs
```

`next build` and `next dev` share `.next`, so building while the dev server is live
overwrites the chunks it is serving and every page renders blank with
`__webpack_modules__[moduleId] is not a function`. `build:check` writes elsewhere.

## Tests

```bash
npm test --workspaces     # geometry fixtures + behaviour, editor history
cd apps/api && mvn test   # the same fixtures, plus schema and lifecycle tests
./tools/mutation-check.sh # proves the cross-language fixtures can actually fail
```

`LayoutLifecycleTest`, `MeetingFlowTest` and `BookingConcurrencyTest` assert against the
seeded demo floor — three named rooms, a table called 'Round Table', seat C3 — so run
`./tools/demo-reset.sh` first if you have cleared it. They say exactly that rather than
failing cryptically. Tests about RULES rather than about the seed run against whatever
floor is published.

## Layout

```
seat-booking/
├─ docker-compose.yml           postgres · redis · mailpit
├─ tools/oracle/                independent reference implementation, generates fixtures
├─ packages/
│  ├─ geometry-fixtures/        the shared spec: 70 golden cases
│  └─ geometry/                 the TypeScript engine
└─ apps/
   ├─ api/                      Spring Boot 4.1.1 · Java 21 · the Java engine
   └─ web/                      Next.js 15 · the layout editor
```

## What is built

| Milestone | State |
| --- | --- |
| **M1a** geometry engines, fixture-locked in both languages | done |
| **M1b** schema, auth, layout API, validation, publish | done |
| **M1c** layout editor | done |
| **M2** booking | done |
| **M3** meetings & email | done |
| **M4** hardening | not started |

**Plan mode** draws the building: rectangular, circular and pen-traced polygon rooms;
tables with parametric seat rules that redistribute live; gates placed onto walls;
partitions drawn wall to wall, with JTS deriving the named sub-zones they create; drag,
rotate and resize with grid, angle, wall and table-edge snapping; undo/redo; autosave;
the validation overlay; the 2D/3D toggle; and the draft/publish flow.

**Book mode** reads the published layout: a time scrubber over the next 6 days, seats
coloured for the window being viewed, booking and cancellation, cost from the modelled
rates, and live updates over SSE when someone else takes a seat.

**Editing** is multi-select throughout: shift-click or sweep a box, then move, duplicate
or delete the group as one. Arrange a room's tables on a grid, or space and line up a
selection — both by equal GAPS including the walls, measured on the table **and its
chairs**, because the chairs are what collide. Pan with space-drag or two fingers, zoom
with pinch, press `0` to frame the floor. A corner grip keeps proportions; Shift
stretches one axis.

**Call cabins** are rooms only managers and admins may book a seat in, enforced in the
service rather than by hiding a button. **One desk per person at a time** is a database
constraint, carved out for meetings — which book a whole table under one name.

**Buildings and floors** are managed from the header (admin only). A floor is where a
layout is drawn, so deleting one is refused while any of its seats still holds a live
booking — it names who holds them rather than failing on a foreign key.

**Meetings** let a manager hold a whole table and invite people by email. The meeting,
every seat's booking, the invites and the queued emails are one transaction: if a single
seat is taken the lot rolls back, because a half-held table is not what was asked for.
Mail goes through a transactional outbox, so SMTP never delays a booking and an outage
never loses an invite. Invitees answer from a link with no account.

Seat colour is never stored. A seat is only free or taken *relative to a window*, which
is why booking has a scrubber rather than a single live view.

## What is not built

In the order it would block a sale: **there is no way to create a user** — no sign-up, no
invite, no admin screen, so adding a person means running a script against the database.
Then: no mobile layout, no utilisation reporting, no calendar integration for desk
bookings, and no check-in or no-show release. `CLAUDE.md` keeps the full list.

## Two things worth reading before changing anything

`packages/geometry-fixtures/README.md` is the specification for the geometry engine and
explains why arc segment counts are derived using only `+ - * /` and `sqrt`.

`CLAUDE.md` records the conventions, and why the canvas is plain three.js rather than
react-three-fiber.
