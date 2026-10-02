/**
 * Things that look like what they are.
 *
 * <p>Everything on this canvas used to be its footprint and nothing else: a table was a
 * filled rectangle, a chair a disc with a whisker, a door a short coloured line, a
 * partition a hairline. All correct, all unreadable — a plan you have to be told how to
 * read is one a client cannot check, and "is that a chair or a plant pot" is not a
 * question a demo should raise.
 *
 * <p>The geometry here is deliberately plain. These are plan symbols, not furniture
 * models: a tabletop with legs under it, a seat pad with a back, a door leaf with its
 * swing. Enough to recognise at a glance and cheap enough to rebuild on every edit, which
 * the canvas does constantly.
 *
 * <p>Both views are built from the same numbers, so the 3D walkthrough cannot drift from
 * the 2D plan people actually sign off.
 */
import * as THREE from 'three';
import type { ShapeJson } from '@/api/types';
import { ringFor, threeShape } from './shapeToThree';

/** Height of a tabletop, and the thickness of the top itself. */
const TABLE_TOP = 0.74;
const TOP_THICKNESS = 0.05;
const LEG = 0.06;

/**
 * How tall a door is, and therefore how much wall is left above one.
 *
 * <p>Shared by the leaf and by the hole it stands in, because a leaf that does not match
 * its own opening is the thing that makes a doorway look like a mistake.
 */
export const DOOR_HEIGHT = 2.0;

/** A seat pad, its height, and the back that makes it read as a chair. */
const SEAT_PAD = 0.45;
const PAD_THICKNESS = 0.06;
const BACK_HEIGHT = 0.42;
const BACK_THICKNESS = 0.05;

const flat = (geometry: THREE.BufferGeometry, colour: number, z: number) => {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: colour }));
  mesh.position.z = z;
  return mesh;
};

const solid = (geometry: THREE.BufferGeometry, colour: number) =>
  new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: colour, roughness: 0.75, metalness: 0.05,
  }));

/** The widest span of a shape, used to size legs and pedestals against it. */
function extentOf(shape: ShapeJson): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of ringFor(shape)) {
    x = Math.max(x, Math.abs(p.x));
    y = Math.max(y, Math.abs(p.y));
  }
  return { x, y };
}

/**
 * A table.
 *
 * <p>In plan, the top with a darker lip drawn just inside it: a single flat fill reads as
 * a hole in the floor, and the lip is what makes it a surface sitting on top.
 *
 * <p>In three dimensions, a top with legs under it rather than a solid block from the
 * floor up. The block version is what made every table look like a plinth, and it hid the
 * chairs tucked under it.
 */
export function tableMesh(shape: ShapeJson, colour: number, lip: number, view: '2D' | '3D'): THREE.Group {
  const group = new THREE.Group();
  const extent = extentOf(shape);

  if (view === '2D') {
    group.add(flat(new THREE.ShapeGeometry(threeShape(shape)), lip, 0.01));
    // The lip is an EDGE, so it is a fixed width of table — not a share of it. As a
    // percentage it came out 28 px wide on a 20 m bench and read as a box inside a box
    // rather than as a surface with a rim.
    const edge = 0.08;
    const inset = Math.max(0.5, 1 - edge / Math.max(extent.x, extent.y));
    const top = flat(new THREE.ShapeGeometry(threeShape(shape)), colour, 0.012);
    top.scale.set(inset, inset, 1);
    group.add(top);
    return group;
  }

  const top = solid(new THREE.ExtrudeGeometry(threeShape(shape), {
    depth: TOP_THICKNESS, bevelEnabled: false, curveSegments: 1,
  }), colour);
  top.position.z = TABLE_TOP - TOP_THICKNESS;
  group.add(top);

  if (shape.kind === 'CIRCLE' || shape.kind === 'ELLIPSE') {
    // One pedestal, because four legs under a round table look like a spider.
    const pedestal = solid(
      new THREE.CylinderGeometry(LEG * 1.6, LEG * 2.4, TABLE_TOP - TOP_THICKNESS, 12),
      lip,
    );
    pedestal.rotation.x = Math.PI / 2;
    pedestal.position.z = (TABLE_TOP - TOP_THICKNESS) / 2;
    group.add(pedestal);
    return group;
  }

  const inset = LEG * 2;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const leg = solid(
        new THREE.BoxGeometry(LEG, LEG, TABLE_TOP - TOP_THICKNESS),
        lip,
      );
      leg.position.set(
        sx * (extent.x - inset),
        sy * (extent.y - inset),
        (TABLE_TOP - TOP_THICKNESS) / 2,
      );
      group.add(leg);
    }
  }
  return group;
}

/**
 * A chair, facing +x — the direction a seat's own rotation already points.
 *
 * <p>The back goes at the BACK, which is the side away from the table, so a row of chairs
 * shows you which way people are sitting without anyone having to explain the colour of a
 * whisker. In plan that is a pad with a bar behind it; in three dimensions the same pad
 * on four legs with the back standing up.
 */
export function chairMesh(shape: ShapeJson, colour: number, trim: number, view: '2D' | '3D'): THREE.Group {
  const group = new THREE.Group();
  const extent = extentOf(shape);
  const width = Math.max(extent.y * 2, 0.3);
  const depth = Math.max(extent.x * 2, 0.3);

  if (view === '2D') {
    // Drawn as a SYMBOL sized from the seat, not as the seat's own outline. The stored
    // shape is a disc — it is what the validator measures and what the pointer hits — and
    // a disc with a bar 0.08 m behind it is, at any zoom a whole floor fits into, a green
    // dot. A plan symbol has to be built from proportions of itself to survive that.
    const pad = flat(new THREE.PlaneGeometry(depth * 0.78, width * 0.92), colour, 0.04);
    pad.position.x = depth * 0.08; // nudged toward the table, leaving room for the back
    group.add(pad);

    const back = flat(new THREE.PlaneGeometry(depth * 0.22, width), trim, 0.045);
    back.position.x = -depth * 0.39;
    group.add(back);
    return group;
  }

  const pad = solid(new THREE.BoxGeometry(depth, width, PAD_THICKNESS), colour);
  pad.position.z = SEAT_PAD;
  group.add(pad);

  const back = solid(new THREE.BoxGeometry(BACK_THICKNESS, width, BACK_HEIGHT), trim);
  back.position.set(-depth / 2 + BACK_THICKNESS / 2, 0, SEAT_PAD + BACK_HEIGHT / 2);
  group.add(back);

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const leg = solid(new THREE.BoxGeometry(LEG * 0.7, LEG * 0.7, SEAT_PAD), trim);
      leg.position.set(sx * (depth / 2 - LEG), sy * (width / 2 - LEG), SEAT_PAD / 2);
      group.add(leg);
    }
  }
  return group;
}

/**
 * A door in a wall: the opening, the leaf, and the arc the leaf sweeps.
 *
 * <p>The arc is the point. It is how every floor plan ever drawn says "door", and it is
 * the only part that tells you which way the thing opens and how much floor it needs to
 * do it — which is exactly the question a table placed next to a door raises.
 *
 * <p>Built along +x from the hinge, so the caller places and turns it on the wall.
 */
export function doorMesh(width: number, colour: number, view: '2D' | '3D'): THREE.Group {
  const group = new THREE.Group();

  const leafPoints: THREE.Vector3[] = [];
  const SEGMENTS = 12;
  for (let i = 0; i <= SEGMENTS; i++) {
    const angle = (Math.PI / 2) * (i / SEGMENTS);
    leafPoints.push(new THREE.Vector3(Math.cos(angle) * width, Math.sin(angle) * width, 0.03));
  }

  const arc = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(leafPoints),
    new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.55 }),
  );
  group.add(arc);

  if (view === '2D') {
    // The leaf itself, standing open at a right angle to the wall.
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0.035),
        new THREE.Vector3(0, width, 0.035),
      ]),
      new THREE.LineBasicMaterial({ color: colour }),
    ));
    return group;
  }

  const leaf = solid(new THREE.BoxGeometry(0.04, width, DOOR_HEIGHT), colour);
  leaf.position.set(0, width / 2, DOOR_HEIGHT / 2);
  group.add(leaf);
  return group;
}

/**
 * A partition: a low wall, with the thickness it actually has.
 *
 * <p>Drawn as a hairline it looked like a guide rather than something you cannot walk
 * through. It is built from the polyline the room stores, one quad per segment in plan
 * and one box per segment standing up in three dimensions.
 */
export function partitionMesh(
  polyline: ReadonlyArray<readonly [number, number]>,
  thickness: number,
  height: number,
  colour: number,
  view: '2D' | '3D',
): THREE.Group {
  const group = new THREE.Group();
  const t = Math.max(thickness, 0.08);

  for (let i = 1; i < polyline.length; i++) {
    const [x0, y0] = polyline[i - 1]!;
    const [x1, y1] = polyline[i]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;

    const segment = view === '2D'
      ? flat(new THREE.PlaneGeometry(length, t), colour, 0.015)
      : solid(new THREE.BoxGeometry(length, t, height), colour);
    segment.position.set((x0 + x1) / 2, (y0 + y1) / 2, view === '2D' ? 0.015 : height / 2);
    segment.rotation.z = Math.atan2(dy, dx);
    group.add(segment);
  }
  return group;
}

/** Where a wall is interrupted: an edge of the ring, and the span of it a door occupies. */
export interface WallOpening {
  edgeIdx: number;
  /** Start and end along that edge, 0..1. */
  from: number;
  to: number;
}

/**
 * A room's walls, with holes where its doors are.
 *
 * <p>The walls used to be one extruded ring with an inset ring punched out of it: correct
 * as a shape, and solid all the way round, so a door was a leaf standing in front of an
 * unbroken wall. You could see it was meant to be a door and also see that you could not
 * walk through it.
 *
 * <p>Built per edge instead, in the pieces BETWEEN the openings, so the gap is real.
 * Above each opening a lintel carries the wall on across the top, because a hole from
 * floor to ceiling is not a door — it is a missing wall. Short posts at the corners cover
 * the mitre that per-edge boxes do not make for themselves.
 */
export function roomWalls(
  ring: ReadonlyArray<{ x: number; y: number }>,
  height: number,
  thickness: number,
  colour: number,
  openings: readonly WallOpening[],
  view: '2D' | '3D',
): THREE.Group {
  const group = new THREE.Group();
  if (ring.length < 2) return group;

  const material = view === '3D'
    ? new THREE.MeshStandardMaterial({
      color: colour, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    })
    : new THREE.MeshBasicMaterial({ color: colour });

  // In plan the wall is the same band seen from above, so both views are the same walls
  // with the same doorways in them and cannot drift apart. A plan without poché is a
  // diagram: the single hairline the rooms used to have said nothing about where the
  // walls were, only where the floor stopped.
  const piece = (length: number, tall: number, cx: number, cy: number, cz: number, angle: number) => {
    if (length <= 1e-6 || tall <= 1e-6) return;
    const mesh = view === '3D'
      ? new THREE.Mesh(new THREE.BoxGeometry(length, thickness, tall), material)
      : new THREE.Mesh(new THREE.PlaneGeometry(length, thickness), material);
    mesh.position.set(cx, cy, view === '3D' ? cz : 0.02);
    mesh.rotation.z = angle;
    group.add(mesh);
  };

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const angle = Math.atan2(dy, dx);

    // Rings are counter-clockwise, so the inside is to the LEFT of the way the edge runs.
    // Pushing the wall half its thickness that way keeps the room's floor area honest:
    // straddling the outline would quietly eat half a wall's width of floor all round.
    const nx = -dy / length;
    const ny = dx / length;
    const at = (t: number) => ({
      x: a.x + dx * t + nx * (thickness / 2),
      y: a.y + dy * t + ny * (thickness / 2),
    });

    const holes = openings
      .filter((o) => o.edgeIdx === i)
      .map((o) => [Math.max(0, Math.min(o.from, o.to)), Math.min(1, Math.max(o.from, o.to))] as const)
      .sort((p, q) => p[0] - q[0]);

    let cursor = 0;
    for (const [from, to] of holes) {
      if (from > cursor) {
        const mid = at((cursor + from) / 2);
        piece((from - cursor) * length, height, mid.x, mid.y, height / 2, angle);
      }
      // The lintel: wall above the opening, so the hole is a doorway and not a gap.
      // Only in three dimensions — seen from above there is no "above", and drawing it
      // would fill the doorway back in.
      if (view === '3D' && height > DOOR_HEIGHT) {
        const mid = at((from + to) / 2);
        piece(
          (to - from) * length, height - DOOR_HEIGHT,
          mid.x, mid.y, DOOR_HEIGHT + (height - DOOR_HEIGHT) / 2, angle,
        );
      }
      cursor = Math.max(cursor, to);
    }
    if (cursor < 1) {
      const mid = at((cursor + 1) / 2);
      piece((1 - cursor) * length, height, mid.x, mid.y, height / 2, angle);
    }
  }

  // Corner posts. Per-edge boxes meet at an angle and leave a wedge of daylight at every
  // corner; a post the thickness of the wall fills it without needing a mitre.
  //
  // Only where the wall actually turns, though. A circular room tessellates into about
  // seventy edges that each bend by five degrees, and a post at every one of them would
  // be seventy meshes covering a gap too small to see — on a graph that is rebuilt on
  // every edit.
  const TURN = 0.09; // radians, about five degrees
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length]!;
    const here = ring[i]!;
    const next = ring[(i + 1) % ring.length]!;
    const incoming = Math.atan2(here.y - prev.y, here.x - prev.x);
    const outgoing = Math.atan2(next.y - here.y, next.x - here.x);
    let turn = outgoing - incoming;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    if (Math.abs(turn) < TURN) continue;

    const post = view === '3D'
      ? new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, height), material)
      : new THREE.Mesh(new THREE.PlaneGeometry(thickness, thickness), material);
    post.position.set(here.x, here.y, view === '3D' ? height / 2 : 0.021);
    post.rotation.z = incoming + turn / 2;
    group.add(post);
  }

  return group;
}
