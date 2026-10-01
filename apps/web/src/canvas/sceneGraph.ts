import * as THREE from 'three';
import type { SceneJson, ShapeJson } from '@/api/types';
import type { Selection } from '@/state/editorStore';
import { extrudedGeometry, footprintGeometry, outlinePoints, ringFor } from './shapeToThree';

export const COLORS = {
  roomFill: 0x1b2029,
  roomFillSelected: 0x232d3d,
  roomEdge: 0x3a4454,
  roomEdgeSelected: 0x4c9aff,
  table: 0x36506e,
  tableSelected: 0x4c9aff,
  seat: 0x3ddc97,
  seatOverride: 0xffc857,
  invalid: 0xff6b6b,
  gate: 0xffc857,
  emergency: 0xff6b6b,
  partition: 0x8d97a8,
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
export function buildSceneGraph(
  scene: SceneJson,
  selection: Selection,
  invalidIds: Set<string>,
  view: '2D' | '3D',
): THREE.Group {
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
      group.add(solidMesh(room.shape, room.height, COLORS.roomFill, 0.3));
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
    const colour = invalidIds.has(seat.id)
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

  return root;
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
