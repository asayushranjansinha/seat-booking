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
    group.add(flat(new THREE.ShapeGeometry(threeShape(shape)), colour, 0.01));
    // A second fill, scaled down, stands in for the lip. Offsetting the ring properly
    // would be exact and would also mean an offset per table on every rebuild.
    const inset = Math.min(0.94, Math.max(0.8, 1 - 0.08 / Math.max(extent.x, extent.y)));
    const top = flat(new THREE.ShapeGeometry(threeShape(shape)), lip, 0.012);
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
    const pad = flat(new THREE.ShapeGeometry(threeShape(shape)), colour, 0.04);
    group.add(pad);
    // The back: a bar across the rear edge, which is -x once the seat is turned to face
    // its table.
    const back = flat(new THREE.PlaneGeometry(BACK_THICKNESS * 1.6, width * 0.9), trim, 0.045);
    back.position.x = -extent.x - BACK_THICKNESS;
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

  const leaf = solid(new THREE.BoxGeometry(0.04, width, 2.0), colour);
  leaf.position.set(0, width / 2, 1.0);
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
