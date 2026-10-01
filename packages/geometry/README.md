# @seat-booking/geometry

The TypeScript half of the geometry engine. The Java half lives in `apps/api` and the two
are pinned to each other by `packages/geometry-fixtures`.

The browser needs this maths locally so dragging stays at 60fps; the server re-runs it
because a client cannot be trusted. A shared WASM core is over-engineering at this stage
and an API round-trip per drag frame is far too slow, so it is implemented twice and the
fixtures keep both honest.

```
npm test        # fixtures + behavioural properties
npm run typecheck
```

`src/placement.ts` is the one to read first — it is where the product requirement
("place a seat at an angle and the nearby seats move in the same proportion") is actually
delivered, and everything else exists to support it.
