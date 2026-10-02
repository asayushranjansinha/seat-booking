import * as THREE from 'three';
import type { SceneJson, ShapeJson } from '@/api/types';
import type { Selection } from '@/state/editorStore';
import { extrudedGeometry, footprintGeometry, outlinePoints, ringFor, wallGeometry } from './shapeToThree';
import type { Drawing } from '@/state/editorStore';

/**
 * Canvas palette, kept in step with the CSS tokens in app/globals.css.
 *
 * <p>Duplicated as hex because WebGL materials cannot read CSS custom properties. The
 * booked and free states differ in BRIGHTNESS as well as hue, since red and green are
 * the commonest colour-blindness confusion and a seat plan is read at a glance.
 */
export const COLORS = {
  roomFill: 0x222834,
  roomFillSelected: 0x2b3444,
  roomEdge: 0x414a5c,
  roomEdgeSelected: 0x5b9bff,
  table: 0x3a4a63,
  tableSelected: 0x5b9bff,
  tableEdge: 0x50617e,
  tableEdgeSelected: 0x9cc4ff,
  seat: 0x5fd6a4,
  seatOverride: 0xf0c24a,
  invalid: 0xe0646f,
  gate: 0xf0c24a,
  emergency: 0xe0646f,
  partition: 0x8792a6,
  subZone: 0x2a3140,
  subZoneEdge: 0x47526b,
  guide: 0xf0c24a,
  pen: 0x5b9bff,
  seatFree: 0x5fd6a4,
  seatBooked: 0xa14954,
  seatMine: 0x5b9bff,
  seatBlocked: 0x4a5265,
} as const;

/** What a picked object refers to, stashed on the three.js object. */
export interface PickData {
  selection: NonNullable<Selection>;
  /** The entity's own local transform, needed to compute a drag's grab offset. */
  local: { x: number; y: number; rot: number };
}

function lineFrom(points: THREE.Vector3[], color: number, width = 1): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: width }));
}

function flatMesh(shape: ShapeJson, color: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    footprintGeometry(shape),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  mesh.position.z = z;
  return mesh;
}

function solidMesh(shape: ShapeJson, height: number, color: number, opacity = 1): THREE.Mesh {
  return new THREE.Mesh(
    extrudedGeometry(shape, height),
    new THREE.MeshStandardMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    }),
  );
}

/**
 * Build the three.js object graph from the scene.
 *
 * <p>The NESTING is the point. A table is a child of its room's group and a seat is a
 * child of its table's group, so three.js composes exactly the same transform chain the
 * geometry engine does. Rotating a table is one `group.rotation.z` change and every seat
 * on it moves correctly, without a single seat position being recomputed here.
 */
export interface BuildOptions {
  selection: Selection;
  mode: 'PLAN' | 'BOOK';
  occupancy: Record<string, 'FREE' | 'BOOKED' | 'MINE' | 'BLOCKED'>;
  invalidIds: Set<string>;
  view: '2D' | '3D';
  drawing: Drawing;
  cursor: { x: number; y: number } | null;
  snapGuides: Array<[{ x: number; y: number }, { x: number; y: number }]>;
  /** World metres per screen unit, so grips stay a usable size at any zoom. */
  handleScale: number;
}

export function buildSceneGraph(scene: SceneJson, options: BuildOptions): THREE.Group {
  const { selection, invalidIds, view, drawing, cursor, snapGuides, handleScale, mode, occupancy } =
    options;
  const root = new THREE.Group();
  const roomGroups = new Map<string, THREE.Group>();
  const tableGroups = new Map<string, THREE.Group>();

  const isSelected = (type: string, id: string) => selection?.type === type && selection.id === id;

  for (const room of scene.rooms) {
    const group = new THREE.Group();
    group.position.set(room.transform.x, room.transform.y, 0);
    group.rotation.z = room.transform.rot;
    roomGroups.set(room.id, group);
    root.add(group);

    const selected = isSelected('room', room.id);
    const invalid = invalidIds.has(room.id);

    const fill = flatMesh(room.shape, selected ? COLORS.roomFillSelected : COLORS.roomFill, -0.02);
    fill.userData.pick = {
      selection: { type: 'room', id: room.id },
      local: room.transform,
    } satisfies PickData;
    group.add(fill);

    group.add(
      lineFrom(
        outlinePoints(room.shape),
        invalid ? COLORS.invalid : selected ? COLORS.roomEdgeSelected : COLORS.roomEdge,
      ),
    );

    if (view === '3D') {
      group.add(new THREE.Mesh(
        wallGeometry(room.shape, room.height),
        new THREE.MeshStandardMaterial({ color: 0x2b3340, side: THREE.DoubleSide }),
      ));
      // A thin floor so the room reads as a space rather than a hollow outline.
      const floor = flatMesh(room.shape, COLORS.roomFill, 0);
      group.add(floor);
    }

    // Areas the partitions divide this room into, derived server-side.
    for (const zone of room.subZones ?? []) {
      if (zone.ring.length < 3) continue;
      const path = new THREE.Shape();
      zone.ring.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
      path.closePath();
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(path),
        new THREE.MeshBasicMaterial({ color: COLORS.subZone, side: THREE.DoubleSide }),
      );
      mesh.position.z = -0.015;
      group.add(mesh);
      group.add(lineFrom(
        [...zone.ring.map(([x, y]) => new THREE.Vector3(x, y, -0.012)),
          new THREE.Vector3(zone.ring[0]![0], zone.ring[0]![1], -0.012)],
        COLORS.subZoneEdge,
      ));
    }

    for (const partition of room.partitions) {
      group.add(
        lineFrom(
          partition.polyline.map(([x, y]) => new THREE.Vector3(x, y, 0.01)),
          COLORS.partition,
        ),
      );
    }

    const ring = ringFor(room.shape);
    for (const gate of room.gates) {
      const a = ring[gate.wallEdgeIdx % ring.length];
      const b = ring[(gate.wallEdgeIdx + 1) % ring.length];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const half = gate.width / 2 / len;
      const t0 = gate.offsetT - half;
      const t1 = gate.offsetT + half;
      group.add(
        lineFrom(
          [
            new THREE.Vector3(a.x + dx * t0, a.y + dy * t0, 0.03),
            new THREE.Vector3(a.x + dx * t1, a.y + dy * t1, 0.03),
          ],
          gate.type === 'EMERGENCY' ? COLORS.emergency : COLORS.gate,
        ),
      );
    }
  }

  for (const table of scene.furniture) {
    const parent = roomGroups.get(table.roomId);
    if (!parent) continue;
    const group = new THREE.Group();
    group.position.set(table.transform.x, table.transform.y, 0);
    group.rotation.z = table.transform.rot;
    tableGroups.set(table.id, group);
    parent.add(group);

    const selected = isSelected('furniture', table.id);
    const invalid = invalidIds.has(table.id);
    const colour = invalid ? COLORS.invalid : selected ? COLORS.tableSelected : COLORS.table;

    const mesh = view === '3D'
      ? solidMesh(table.shape, table.height, colour)
      : flatMesh(table.shape, colour, 0.01);
    mesh.userData.pick = {
      selection: { type: 'furniture', id: table.id },
      local: table.transform,
    } satisfies PickData;
    group.add(mesh);
    group.add(lineFrom(outlinePoints(table.shape), selected ? 0x8dc2ff : 0x4a6c92));
  }

  for (const seat of scene.seats) {
    const parent = seat.tableId ? tableGroups.get(seat.tableId) : roomGroups.get(seat.roomId);
    if (!parent) continue;

    const group = new THREE.Group();
    group.position.set(seat.localTransform.x, seat.localTransform.y, 0);
    group.rotation.z = seat.localTransform.rot;
    parent.add(group);

    const selected = isSelected('seat', seat.id);
    const colour = mode === 'BOOK'
      ? bookingColour(occupancy[seat.id])
      : invalidIds.has(seat.id)
        ? COLORS.invalid
        : seat.override
          ? COLORS.seatOverride
          : COLORS.seat;

    const mesh = view === '3D'
      ? solidMesh(seat.shape, 0.45, colour)
      : flatMesh(seat.shape, colour, 0.04);
    mesh.userData.pick = {
      selection: { type: 'seat', id: seat.id },
      local: seat.localTransform,
    } satisfies PickData;
    group.add(mesh);

    // A stub pointing the way the seat faces, so "every seat faces its table" is
    // something you can see rather than something you have to trust.
    group.add(
      lineFrom(
        [new THREE.Vector3(0, 0, 0.05), new THREE.Vector3(0.2, 0, 0.05)],
        selected ? 0xffffff : 0x0f1115,
      ),
    );
  }

  // Grips for whatever is selected, in 2D only, and never while booking: a seat's
  // position is not something a person booking it may change.
  if (selection && view === '2D' && mode === 'PLAN') {
    if (selection.type === 'room') {
      const room = scene.rooms.find((r) => r.id === selection.id);
      const parent = room && roomGroups.get(room.id);
      if (room && parent) {
        // Grips live in the room's PARENT space, so they are siblings of the room rather
        // than children of it; otherwise resizing would scale the grips too.
        const holder = new THREE.Group();
        holder.add(buildHandles(room.shape, { x: 0, y: 0, rot: 0 }, selection, handleScale));
        parent.add(holder);
      }
    } else if (selection.type === 'furniture') {
      const table = scene.furniture.find((f) => f.id === selection.id);
      const parent = table && roomGroups.get(table.roomId);
      if (table && parent) {
        parent.add(buildHandles(table.shape, table.transform, selection, handleScale));
      }
    }
  }

  // The pen and the partition tool, mid-stroke.
  if (drawing?.kind === 'POLYGON' && drawing.points.length > 0) {
    const pts = [...drawing.points.map((p) => new THREE.Vector3(p.x, p.y, 0.4))];
    if (cursor) pts.push(new THREE.Vector3(cursor.x, cursor.y, 0.4));
    if (drawing.points.length >= 2) pts.push(new THREE.Vector3(drawing.points[0]!.x, drawing.points[0]!.y, 0.4));
    root.add(lineFrom(pts, COLORS.pen));
    for (const p of drawing.points) {
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.1 * handleScale, 12),
        new THREE.MeshBasicMaterial({ color: COLORS.pen }),
      );
      dot.position.set(p.x, p.y, 0.41);
      root.add(dot);
    }
  } else if (drawing?.kind === 'PARTITION' && cursor) {
    root.add(lineFrom(
      [new THREE.Vector3(drawing.start.x, drawing.start.y, 0.4), new THREE.Vector3(cursor.x, cursor.y, 0.4)],
      COLORS.pen,
    ));
  }

  // Whatever the drag latched onto, so the snap is visible rather than mysterious.
  for (const [a, b] of snapGuides) {
    root.add(lineFrom(
      [new THREE.Vector3(a.x, a.y, 0.45), new THREE.Vector3(b.x, b.y, 0.45)],
      COLORS.guide,
    ));
  }

  return root;
}

function bookingColour(status: string | undefined): number {
  switch (status) {
    case 'MINE':
      return COLORS.seatMine;
    case 'BOOKED':
      return COLORS.seatBooked;
    case 'BLOCKED':
      return COLORS.seatBlocked;
    case 'FREE':
      return COLORS.seatFree;
    default:
      // Occupancy has not arrived yet. Grey rather than green, so a seat is never shown
      // as free before anyone has checked.
      return COLORS.seatBlocked;
  }
}

/** Release GPU resources for a graph that is about to be replaced. */
export function disposeGraph(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

/** What a selection handle does when dragged. */
export interface HandleData {
  kind: 'rotate' | 'resize';
  /** Which corner or axis the handle controls; 0..3 for a rect, 0 for a radius. */
  index: number;
  selection: NonNullable<Selection>;
  /** The entity's shape and local transform at the moment the handle was built. */
  shape: ShapeJson;
  local: { x: number; y: number; rot: number };
}

const HANDLE_FILL = 0xffffff;
const HANDLE_ROTATE = 0xffc857;

function handleMesh(size: number, colour: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CircleGeometry(size, 16),
    new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide }),
  );
}

/**
 * Rotate and resize grips for the selected entity, drawn in the parent's space so they
 * follow the entity through its parents' transforms.
 *
 * <p>Sized in world metres rather than pixels, so they grow and shrink with the zoom.
 * A pixel-constant grip would need the camera here, and the grips are only ever used at
 * authoring zoom levels where this is fine.
 */
export function buildHandles(
  shape: ShapeJson,
  local: { x: number; y: number; rot: number },
  selection: NonNullable<Selection>,
  scale: number,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(local.x, local.y, 0);
  group.rotation.z = local.rot;

  const grip = 0.14 * scale;
  const corners: Array<{ x: number; y: number; index: number }> = [];

  if (shape.kind === 'RECT') {
    const w = shape.w / 2;
    const h = shape.h / 2;
    corners.push(
      { x: -w, y: -h, index: 0 },
      { x: w, y: -h, index: 1 },
      { x: w, y: h, index: 2 },
      { x: -w, y: h, index: 3 },
    );
  } else if (shape.kind === 'CIRCLE') {
    corners.push({ x: shape.r, y: 0, index: 0 });
  } else if (shape.kind === 'ELLIPSE') {
    corners.push({ x: shape.rx, y: 0, index: 0 }, { x: 0, y: shape.ry, index: 1 });
  }

  for (const corner of corners) {
    const mesh = handleMesh(grip, HANDLE_FILL);
    mesh.position.set(corner.x, corner.y, 0.3);
    mesh.userData.handle = {
      kind: 'resize', index: corner.index, selection, shape, local,
    } satisfies HandleData;
    group.add(mesh);
  }

  // Rotation grip, held off the top edge so it never sits under a resize grip.
  const reach =
    (shape.kind === 'RECT' ? shape.h / 2
      : shape.kind === 'CIRCLE' ? shape.r
        : shape.kind === 'ELLIPSE' ? shape.ry
          : 1) + 0.6 * scale;
  const rotate = handleMesh(grip, HANDLE_ROTATE);
  rotate.position.set(0, reach, 0.3);
  rotate.userData.handle = { kind: 'rotate', index: 0, selection, shape, local } satisfies HandleData;
  group.add(rotate);
  group.add(lineFrom(
    [new THREE.Vector3(0, reach - 0.6 * scale, 0.25), new THREE.Vector3(0, reach, 0.25)],
    HANDLE_ROTATE,
  ));

  return group;
}
