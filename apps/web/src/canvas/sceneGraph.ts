import * as THREE from 'three';
import type { SceneJson, ShapeJson } from '@/api/types';
import type { Selection, SelectionItem } from '@/state/editorStore';
import { footprintGeometry, outlinePoints, ringFor } from './shapeToThree';
import { chairMesh, doorMesh, partitionMesh, roomWalls, tableMesh } from './furniture';
import { shade, tableColour } from './palette';
import type { Drawing } from '@/state/editorStore';

/**
 * Canvas palette, kept in step with the CSS tokens in app/globals.css.
 *
 * <p>Duplicated as hex because WebGL materials cannot read CSS custom properties. The
 * booked and free states differ in BRIGHTNESS as well as hue, since red and green are
 * the commonest colour-blindness confusion and a seat plan is read at a glance.
 */
export /** Wall thickness in metres, shared by the 3D walls and the doors that interrupt them. */
const WALL_THICKNESS = 0.12;

const COLORS = {
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
  // A partition IS a wall, so it is drawn in the wall's colour. As a pale grey hairline
  // it read as a scratch on the plan rather than as something you cannot walk through.
  partition: 0x3d465a,
  // Lighter than the floor it stands on, or poché is invisible: the wall used to be
  // 0x2b3340 against a 0x222834 floor, which is a difference you can measure and cannot
  // see.
  wall: 0x3d465a,
  cabinWall: 0x4b4170,
  cabinFill: 0x332b45,
  cabinEdge: 0x8f7ad1,
  tableLip: 0x2f3f55,
  chairTrim: 0x2b6b4f,
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

/**
 * An invisible footprint that exists only to be clicked.
 *
 * <p>The drawn furniture is legs and backs and arcs now, and none of that is a sane
 * click target — nobody should have to hit a chair leg, or the gap between four of them.
 * So the old flat footprint stays, transparent, and carries the pick data.
 *
 * <p>It must stay VISIBLE in the three.js sense: an invisible object is skipped by the
 * raycaster entirely, which would make the whole plan unclickable. Opacity does the
 * hiding; `visible` would do too much of it.
 */
function pickTarget(shape: ShapeJson, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    footprintGeometry(shape),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  mesh.position.z = z;
  return mesh;
}

function flatMesh(shape: ShapeJson, color: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    footprintGeometry(shape),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  mesh.position.z = z;
  return mesh;
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
  selection: SelectionItem[];
  mode: 'PLAN' | 'BOOK';
  occupancy: Record<string, 'FREE' | 'BOOKED' | 'MINE' | 'BLOCKED'>;
  invalidIds: Set<string>;
  view: '2D' | '3D';
  drawing: Drawing;
  cursor: { x: number; y: number } | null;
  snapGuides: Array<[{ x: number; y: number }, { x: number; y: number }]>;
  /** The box being swept right now, in world metres, or null. */
  marquee: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
  /** World metres per screen unit, so grips stay a usable size at any zoom. */
  handleScale: number;
}

export function buildSceneGraph(scene: SceneJson, options: BuildOptions): THREE.Group {
  const { selection, invalidIds, view, drawing, cursor, snapGuides, marquee, handleScale, mode, occupancy } =
    options;
  const root = new THREE.Group();
  const roomGroups = new Map<string, THREE.Group>();
  const tableGroups = new Map<string, THREE.Group>();

  const held = new Set(selection.map((x) => `${x.type}:${x.id}`));
  const isSelected = (type: string, id: string) => held.has(`${type}:${id}`);

  for (const room of scene.rooms) {
    const group = new THREE.Group();
    group.position.set(room.transform.x, room.transform.y, 0);
    group.rotation.z = room.transform.rot;
    roomGroups.set(room.id, group);
    root.add(group);

    const selected = isSelected('room', room.id);
    const invalid = invalidIds.has(room.id);

    // A cabin is tinted, so "who can book in here" is visible on the plan rather than
    // only in a panel someone has to click into.
    const cabin = room.kind === 'CABIN';
    const fill = flatMesh(
      room.shape,
      selected ? COLORS.roomFillSelected : cabin ? COLORS.cabinFill : COLORS.roomFill,
      -0.02,
    );
    fill.userData.pick = {
      selection: { type: 'room', id: room.id },
      local: room.transform,
    } satisfies PickData;
    group.add(fill);

    group.add(
      lineFrom(
        outlinePoints(room.shape),
        invalid
          ? COLORS.invalid
          : selected ? COLORS.roomEdgeSelected : cabin ? COLORS.cabinEdge : COLORS.roomEdge,
      ),
    );

    // The ring is wanted here anyway for the doors, and the walls are built from the
    // same one, so a door's opening cannot land anywhere but on its own wall.
    const outline = ringFor(room.shape);
    const wallOpenings = room.gates.map((gate) => {
      const a = outline[gate.wallEdgeIdx % outline.length];
      const b = outline[(gate.wallEdgeIdx + 1) % outline.length];
      const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
      const half = length > 0 ? gate.width / 2 / length : 0;
      return { edgeIdx: gate.wallEdgeIdx, from: gate.offsetT - half, to: gate.offsetT + half };
    });
    group.add(roomWalls(
      outline,
      room.height,
      WALL_THICKNESS,
      cabin ? COLORS.cabinWall : COLORS.wall,
      wallOpenings,
      view,
    ));

    if (view === '3D') {
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
      group.add(partitionMesh(
        partition.polyline,
        partition.thickness,
        // Shoulder height. A partition that reached the ceiling would be a wall, and the
        // 3D view would turn into a maze of boxes you cannot see over.
        Math.min(1.6, room.height * 0.6),
        COLORS.partition,
        view,
      ));
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
      const colour = gate.type === 'EMERGENCY' ? COLORS.emergency : COLORS.gate;

      // The opening: the stretch of wall the door occupies, drawn over the wall so the
      // wall appears to stop there.
      group.add(lineFrom(
        [
          new THREE.Vector3(a.x + dx * t0, a.y + dy * t0, 0.03),
          new THREE.Vector3(a.x + dx * t1, a.y + dy * t1, 0.03),
        ],
        colour,
      ));

      // Hinged at the first edge of the opening and swinging into the room. The wall
      // direction is +x for the symbol, so the whole thing is turned to match the wall.
      const door = doorMesh(gate.width, colour, view);
      door.position.set(a.x + dx * t0, a.y + dy * t0, 0);
      door.rotation.z = Math.atan2(dy, dx);
      group.add(door);
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
    const own = tableColour(table.id);
    const colour = invalid ? COLORS.invalid : selected ? COLORS.tableSelected : own;

    // The rim and legs are the table's own colour darkened, so a table stays one object
    // rather than a top with somebody else's edge around it.
    const furnitureMesh = tableMesh(table.shape, colour, shade(colour, 0.62), view);
    // The pick target stays the flat footprint: a leg is a hard thing to click, and
    // clicking the gap between four of them should still find the table.
    const target = pickTarget(table.shape, 0.005);
    target.userData.pick = {
      selection: { type: 'furniture', id: table.id },
      local: table.transform,
    } satisfies PickData;
    group.add(target);
    group.add(furnitureMesh);
    group.add(lineFrom(outlinePoints(table.shape), selected ? COLORS.tableEdgeSelected : shade(own, 1.5)));
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

    group.add(chairMesh(seat.shape, colour, selected ? 0xffffff : COLORS.chairTrim, view));

    // The pick target is the flat pad, for the same reason as the table: a chair leg is
    // not something anyone should have to hit.
    const target = pickTarget(seat.shape, 0.035);
    target.userData.pick = {
      selection: { type: 'seat', id: seat.id },
      local: seat.localTransform,
    } satisfies PickData;
    group.add(target);
  }

  // Grips for whatever is selected, in 2D only, and never while booking: a seat's
  // position is not something a person booking it may change.
  // Grips belong to ONE shape. A group has no single width to drag, and showing a set
  // per member would put a dozen handles on screen that each resize something different.
  const only = selection.length === 1 ? selection[0]! : null;
  if (only && view === '2D' && mode === 'PLAN') {
    if (only.type === 'room') {
      const room = scene.rooms.find((r) => r.id === only.id);
      const parent = room && roomGroups.get(room.id);
      if (room && parent) {
        // Grips live in the room's PARENT space, so they are siblings of the room rather
        // than children of it; otherwise resizing would scale the grips too.
        const holder = new THREE.Group();
        holder.add(buildHandles(room.shape, { x: 0, y: 0, rot: 0 }, only, handleScale));
        parent.add(holder);
      }
    } else if (only.type === 'furniture') {
      const table = scene.furniture.find((f) => f.id === only.id);
      const parent = table && roomGroups.get(table.roomId);
      if (table && parent) {
        parent.add(buildHandles(table.shape, table.transform, only, handleScale));
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

  if (marquee) {
    const { from, to } = marquee;
    const z = 0.5; // above everything, including the grips
    const corners = [
      new THREE.Vector3(from.x, from.y, z),
      new THREE.Vector3(to.x, from.y, z),
      new THREE.Vector3(to.x, to.y, z),
      new THREE.Vector3(from.x, to.y, z),
      new THREE.Vector3(from.x, from.y, z),
    ];
    root.add(lineFrom(corners, COLORS.roomEdgeSelected));
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
  } else if (shape.kind === 'POLYGON') {
    // A traced outline had no grips at all, so a pen-drawn room was the one thing on the
    // plan that could never be resized — you had to delete it and trace it again. Grips
    // on its extent scale the whole outline.
    const hx = Math.max(...shape.points.map(([x]) => Math.abs(x)), 0.2);
    const hy = Math.max(...shape.points.map(([, y]) => Math.abs(y)), 0.2);
    corners.push(
      { x: -hx, y: -hy, index: 0 },
      { x: hx, y: -hy, index: 1 },
      { x: hx, y: hy, index: 2 },
      { x: -hx, y: hy, index: 3 },
    );
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
    (shape.kind === 'POLYGON'
      ? Math.max(...shape.points.map(([, y]) => Math.abs(y)), 0.2)
      : shape.kind === 'RECT' ? shape.h / 2
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
