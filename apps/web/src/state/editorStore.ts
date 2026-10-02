'use client';

import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  placeSeats,
  shapeFromJson,
  type PlacementRule,
  type SeatOverride,
} from '@seat-booking/geometry';
import type {
  FurnitureJson,
  GateJson,
  SeatStatus,
  PartitionJson,
  PlacementJson,
  RoomJson,
  SceneJson,
  SeatJson,
  ShapeJson,
  TransformJson,
  ViolationJson,
} from '@/api/types';

export type Selection =
  | { type: 'room'; id: string }
  | { type: 'furniture'; id: string }
  | { type: 'seat'; id: string }
  | null;

export type Tool =
  | 'SELECT'
  | 'ROOM_RECT'
  | 'ROOM_CIRCLE'
  | 'ROOM_POLY'
  | 'TABLE_RECT'
  | 'TABLE_ROUND'
  | 'GATE'
  | 'PARTITION';

/**
 * A multi-click drawing in progress.
 *
 * <p>Kept in the store rather than in the canvas so the toolbar can show what is being
 * drawn and Escape can cancel it from anywhere.
 */
export type Drawing =
  | { kind: 'POLYGON'; points: Array<{ x: number; y: number }> }
  | { kind: 'PARTITION'; roomId: string; start: { x: number; y: number } }
  | null;

/** The part of the store that undo/redo applies to. Everything else is transient. */
interface UndoableState {
  scene: SceneJson | null;
}

interface EditorState extends UndoableState {
  etag: string | null;
  selection: Selection;
  tool: Tool;
  violations: ViolationJson[];
  view: '2D' | '3D';
  gridSnap: number;
  angleSnapDegrees: number;
  snapEnabled: boolean;
  dirty: boolean;
  /** True while a pointer drag is in flight, so history records one entry, not sixty. */
  dragging: boolean;
  drawing: Drawing;
  /** World position of the pointer, for the live dimension readout. */
  cursor: { x: number; y: number } | null;

  /** Planning the layout, or booking seats in it. */
  mode: 'PLAN' | 'BOOK';
  /**
   * Seat colour in booking mode comes from here, never from the seat itself: a seat is
   * only free or taken RELATIVE to a window, which is why the UI has a scrubber.
   */
  occupancy: Record<string, SeatStatus>;
  /** The window being viewed, in epoch milliseconds. */
  window: { from: number; to: number };

  loadScene: (scene: SceneJson, etag: string | null) => void;
  markSaved: (scene: SceneJson, etag: string | null) => void;
  setSelection: (selection: Selection) => void;
  setTool: (tool: Tool) => void;
  setView: (view: '2D' | '3D') => void;
  setViolations: (violations: ViolationJson[]) => void;
  toggleSnap: () => void;

  beginDrag: () => void;
  endDrag: () => void;

  moveEntity: (selection: NonNullable<Selection>, x: number, y: number) => void;
  rotateEntity: (selection: NonNullable<Selection>, rot: number) => void;
  resizeShape: (selection: NonNullable<Selection>, shape: ShapeJson) => void;
  renameRoom: (roomId: string, name: string) => void;
  setRoomRate: (roomId: string, rate: number | null) => void;

  setTableRule: (tableId: string, placement: PlacementJson) => void;
  regenerateSeats: (tableId: string) => void;
  clearSeatOverride: (seatId: string) => void;
  deleteSelected: () => void;
  addRoom: (shape: ShapeJson, at: { x: number; y: number }) => void;
  addTable: (roomId: string, shape: ShapeJson, at: { x: number; y: number }) => void;

  setCursor: (p: { x: number; y: number } | null) => void;
  setMode: (mode: 'PLAN' | 'BOOK') => void;
  setOccupancy: (occupancy: Record<string, SeatStatus>) => void;
  setWindow: (window: { from: number; to: number }) => void;
  startPolygon: (p: { x: number; y: number }) => void;
  addPolygonPoint: (p: { x: number; y: number }) => void;
  commitPolygon: () => void;
  startPartition: (roomId: string, start: { x: number; y: number }) => void;
  commitPartition: (end: { x: number; y: number }) => void;
  cancelDrawing: () => void;
  addGate: (roomId: string, wallEdgeIdx: number, offsetT: number, width: number, type: GateJson['type']) => void;
}

const uuid = (): string => crypto.randomUUID();

/**
 * How close two pen clicks have to be, in metres, to count as the same corner.
 *
 * <p>A double click, or a click that lands a pixel from the last one, otherwise adds a
 * second vertex on top of the first. The ring then has a zero-length edge, JTS rejects it
 * as degenerate, and the room can never be published — with nothing on screen to show why.
 */
const SAME_CORNER = 0.08;

/** Whether the current drag gesture has already contributed its one history entry. */
let dragHistoryRecorded = false;

/** The next whole hour, for two hours: the slot someone is most likely to want. */
export function defaultWindow(): { from: number; to: number } {
  const from = new Date();
  from.setMinutes(0, 0, 0);
  from.setHours(from.getHours() + 1);
  return { from: from.getTime(), to: from.getTime() + 2 * 60 * 60 * 1000 };
}

export function snapValue(value: number, step: number, enabled: boolean): number {
  return enabled && step > 0 ? Math.round(value / step) * step : value;
}

export function snapAngle(rot: number, degrees: number, enabled: boolean): number {
  if (!enabled || degrees <= 0) return rot;
  const step = (degrees * Math.PI) / 180;
  return Math.round(rot / step) * step;
}

/** Translate a stored placement document into the geometry engine's rule type. */
function toRule(placement: PlacementJson): PlacementRule {
  switch (placement.kind) {
    case 'PERIMETER_EVEN':
      return { kind: 'PERIMETER_EVEN', count: placement.count, startOffset: placement.startOffset ?? 0 };
    case 'EDGE_COUNTS':
      return { kind: 'EDGE_COUNTS', counts: placement.counts };
    case 'RADIAL':
      return { kind: 'RADIAL', count: placement.count, startAngle: placement.startAngle ?? 0 };
    case 'MANUAL':
      return { kind: 'MANUAL' };
  }
}

function ruleSeatCount(placement: PlacementJson, fallback: number): number {
  switch (placement.kind) {
    case 'PERIMETER_EVEN':
    case 'RADIAL':
      return placement.count;
    case 'EDGE_COUNTS':
      return Object.values(placement.counts).reduce((a, b) => a + b, 0);
    case 'MANUAL':
      return fallback;
  }
}

/**
 * Re-run the placement engine for one table and rewrite its seats.
 *
 * <p>This is where the headline requirement actually lands in the UI: resizing a table
 * or changing its rule calls this, the engine redistributes every non-overridden seat in
 * proportion, and seats the admin dragged stay exactly where they were put.
 */
function regenerate(scene: SceneJson, tableId: string): SceneJson {
  const table = scene.furniture.find((f) => f.id === tableId);
  if (!table) return scene;

  const tableSeats = scene.seats
    .filter((s) => s.tableId === tableId)
    .sort((a, b) => a.seatIndex - b.seatIndex);
  if (tableSeats.length === 0) return scene;

  const placement = tableSeats[0]!.placement;
  if (!placement || placement.kind === 'MANUAL') return scene;

  const overrides: SeatOverride[] = tableSeats
    .filter((s) => s.override)
    .map((s) => ({
      index: s.seatIndex,
      x: s.localTransform.x,
      y: s.localTransform.y,
      rot: s.localTransform.rot,
    }));

  const placements = placeSeats({
    shape: shapeFromJson(table.shape),
    clearance: placement.clearance,
    rule: toRule(placement),
    overrides,
    tolerance: 1e-3,
  });

  const byIndex = new Map(placements.map((p) => [p.index, p]));
  const wanted = ruleSeatCount(placement, tableSeats.length);

  // Grow or shrink the seat list to match the rule, keeping existing rows where possible
  // so seat codes and ids survive a count change.
  const kept: SeatJson[] = [];
  for (let index = 0; index < wanted; index++) {
    const existing = tableSeats[index];
    const next = byIndex.get(index);
    if (!next) continue;
    if (existing) {
      kept.push({
        ...existing,
        seatIndex: index,
        override: next.override,
        localTransform: { x: next.x, y: next.y, rot: next.rot },
        placement,
      });
    } else {
      const prefix = tableSeats[0]!.code.replace(/\d+$/, '');
      kept.push({
        id: uuid(),
        roomId: table.roomId,
        tableId,
        code: `${prefix}${index + 1}`,
        shape: tableSeats[0]!.shape,
        localTransform: { x: next.x, y: next.y, rot: next.rot },
        placement,
        seatIndex: index,
        override: next.override,
        bookable: true,
        hourlyRate: tableSeats[0]!.hourlyRate,
      });
    }
  }

  return {
    ...scene,
    seats: [...scene.seats.filter((s) => s.tableId !== tableId), ...kept],
  };
}

function updateRoom(scene: SceneJson, id: string, patch: (r: RoomJson) => RoomJson): SceneJson {
  return { ...scene, rooms: scene.rooms.map((r) => (r.id === id ? patch(r) : r)) };
}

function updateFurniture(scene: SceneJson, id: string, patch: (f: FurnitureJson) => FurnitureJson): SceneJson {
  return { ...scene, furniture: scene.furniture.map((f) => (f.id === id ? patch(f) : f)) };
}

function updateSeat(scene: SceneJson, id: string, patch: (s: SeatJson) => SeatJson): SceneJson {
  return { ...scene, seats: scene.seats.map((s) => (s.id === id ? patch(s) : s)) };
}

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, get) => ({
      scene: null,
      etag: null,
      selection: null,
      tool: 'SELECT',
      violations: [],
      view: '2D',
      gridSnap: 0.25,
      angleSnapDegrees: 15,
      snapEnabled: true,
      dirty: false,
      dragging: false,
      drawing: null,
      cursor: null,
      mode: 'PLAN',
      occupancy: {},
      window: defaultWindow(),

      loadScene: (scene, etag) => {
        set({ scene, etag, dirty: false, selection: null, violations: [], drawing: null });
        // Opening a layout is not an edit. Without this the load itself sits in the
        // history as a step from `scene: null`, and undoing far enough unloads the
        // document: the canvas empties and the toolbar reports "no layout".
        useEditorStore.temporal.getState().clear();
      },
      markSaved: (scene, etag) => set({ scene, etag, dirty: false }),
      setSelection: (selection) => set({ selection }),
      setTool: (tool) => set({ tool }),
      setView: (view) => set({ view }),
      setViolations: (violations) => set({ violations }),
      toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

      beginDrag: () => {
        dragHistoryRecorded = false;
        set({ dragging: true });
      },
      endDrag: () => set({ dragging: false }),

      moveEntity: (selection, x, y) =>
        set((state) => {
          if (!state.scene) return state;
          const snap = (v: number) => snapValue(v, state.gridSnap, state.snapEnabled);
          const move = (t: TransformJson): TransformJson => ({ ...t, x: snap(x), y: snap(y) });
          let scene = state.scene;
          if (selection.type === 'room') {
            scene = updateRoom(scene, selection.id, (r) => ({ ...r, transform: move(r.transform) }));
          } else if (selection.type === 'furniture') {
            scene = updateFurniture(scene, selection.id, (f) => ({ ...f, transform: move(f.transform) }));
          } else {
            // Dragging a seat pins it. Regeneration then skips it and redistributes the
            // rest around it, so the admin gets automatic behaviour AND manual control
            // rather than having to choose between them.
            const seat = scene.seats.find((s) => s.id === selection.id);
            scene = updateSeat(scene, selection.id, (s) => ({
              ...s,
              override: true,
              localTransform: { ...s.localTransform, x, y },
            }));
            if (seat?.tableId) scene = regenerate(scene, seat.tableId);
          }
          return { ...state, scene, dirty: true };
        }),

      rotateEntity: (selection, rot) =>
        set((state) => {
          if (!state.scene) return state;
          const snapped = snapAngle(rot, state.angleSnapDegrees, state.snapEnabled);
          let scene = state.scene;
          if (selection.type === 'room') {
            scene = updateRoom(scene, selection.id, (r) => ({ ...r, transform: { ...r.transform, rot: snapped } }));
          } else if (selection.type === 'furniture') {
            // Rotating a table is ONE transform change. Its seats are stored in
            // table-local space, so every one of them follows without being touched.
            scene = updateFurniture(scene, selection.id, (f) => ({
              ...f,
              transform: { ...f.transform, rot: snapped },
            }));
          } else {
            scene = updateSeat(scene, selection.id, (s) => ({
              ...s,
              override: true,
              localTransform: { ...s.localTransform, rot: snapped },
            }));
          }
          return { ...state, scene, dirty: true };
        }),

      resizeShape: (selection, shape) =>
        set((state) => {
          if (!state.scene) return state;
          let scene = state.scene;
          if (selection.type === 'room') {
            scene = updateRoom(scene, selection.id, (r) => ({ ...r, shape }));
          } else if (selection.type === 'furniture') {
            scene = updateFurniture(scene, selection.id, (f) => ({ ...f, shape }));
            // The table outline changed, so the seats must redistribute in proportion.
            scene = regenerate(scene, selection.id);
          } else {
            scene = updateSeat(scene, selection.id, (s) => ({ ...s, shape }));
          }
          return { ...state, scene, dirty: true };
        }),

      renameRoom: (roomId, name) =>
        set((state) =>
          state.scene ? { ...state, scene: updateRoom(state.scene, roomId, (r) => ({ ...r, name })), dirty: true } : state,
        ),

      /**
       * The rate a seat is billed at, set on the room.
       *
       * <p>Seats fall back to their room's rate, so one number prices a whole room and a
       * seat only needs its own when it differs. A room drawn with no rate prices at zero,
       * which is why this field exists at all: the pricing worked, but nothing could set
       * the input it worked from.
       */
      setRoomRate: (roomId, hourlyRate) =>
        set((state) =>
          state.scene
            ? { ...state, scene: updateRoom(state.scene, roomId, (r) => ({ ...r, hourlyRate })), dirty: true }
            : state,
        ),

      setTableRule: (tableId, placement) =>
        set((state) => {
          if (!state.scene) return state;
          const scene = {
            ...state.scene,
            seats: state.scene.seats.map((s) => (s.tableId === tableId ? { ...s, placement } : s)),
          };
          return { ...state, scene: regenerate(scene, tableId), dirty: true };
        }),

      regenerateSeats: (tableId) =>
        set((state) =>
          state.scene ? { ...state, scene: regenerate(state.scene, tableId), dirty: true } : state,
        ),

      clearSeatOverride: (seatId) =>
        set((state) => {
          if (!state.scene) return state;
          const seat = state.scene.seats.find((s) => s.id === seatId);
          let scene = updateSeat(state.scene, seatId, (s) => ({ ...s, override: false }));
          if (seat?.tableId) scene = regenerate(scene, seat.tableId);
          return { ...state, scene, dirty: true };
        }),

      deleteSelected: () =>
        set((state) => {
          const { scene, selection } = state;
          if (!scene || !selection) return state;
          if (selection.type === 'room') {
            return {
              ...state,
              scene: {
                ...scene,
                rooms: scene.rooms.filter((r) => r.id !== selection.id),
                furniture: scene.furniture.filter((f) => f.roomId !== selection.id),
                seats: scene.seats.filter((s) => s.roomId !== selection.id),
              },
              selection: null,
              dirty: true,
            };
          }
          if (selection.type === 'furniture') {
            return {
              ...state,
              scene: {
                ...scene,
                furniture: scene.furniture.filter((f) => f.id !== selection.id),
                seats: scene.seats.filter((s) => s.tableId !== selection.id),
              },
              selection: null,
              dirty: true,
            };
          }
          return {
            ...state,
            scene: { ...scene, seats: scene.seats.filter((s) => s.id !== selection.id) },
            selection: null,
            dirty: true,
          };
        }),

      setCursor: (cursor) => set({ cursor }),
      setMode: (mode) => set({ mode, selection: null, tool: 'SELECT', drawing: null }),
      setOccupancy: (occupancy) => set({ occupancy }),
      setWindow: (window) => set({ window }),

      startPolygon: (p) => set({ drawing: { kind: 'POLYGON', points: [p] } }),

      addPolygonPoint: (p) =>
        set((state) => {
          if (state.drawing?.kind !== 'POLYGON') return state;
          const last = state.drawing.points[state.drawing.points.length - 1];
          // Ignore a corner on top of the previous one rather than storing a zero-length
          // edge that only shows up later as "this room cannot be published".
          if (last && Math.hypot(p.x - last.x, p.y - last.y) < SAME_CORNER) return state;
          return { ...state, drawing: { kind: 'POLYGON', points: [...state.drawing.points, p] } };
        }),

      /**
       * Close the pen and turn the traced points into a room.
       *
       * <p>The points are traced in world space but a shape is defined around its own
       * origin, so they are recentred on their centroid and the offset becomes the room's
       * transform. Storing the raw world points instead would make the room's origin
       * arbitrary, and rotating it would swing it across the floor.
       */
      commitPolygon: () =>
        set((state) => {
          if (state.drawing?.kind !== 'POLYGON' || !state.scene) return state;
          // Belt and braces: drop any coincident corners that got through, and refuse to
          // make a room out of fewer than three distinct ones.
          const pts = state.drawing.points.filter((p, i, all) => {
            const prev = all[i - 1];
            return !prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= SAME_CORNER;
          });
          if (pts.length < 3) return { ...state, drawing: null, tool: 'SELECT' };

          const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
          const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
          const room: RoomJson = {
            id: uuid(),
            name: `Room ${state.scene.rooms.length + 1}`,
            shape: { kind: 'POLYGON', points: pts.map((p) => [p.x - cx, p.y - cy]) },
            transform: { x: cx, y: cy, rot: 0 },
            height: 2.7,
            hourlyRate: null,
            partitions: [],
            gates: [],
          };
          return {
            ...state,
            scene: { ...state.scene, rooms: [...state.scene.rooms, room] },
            drawing: null,
            tool: 'SELECT',
            selection: { type: 'room', id: room.id },
            dirty: true,
          };
        }),

      startPartition: (roomId, start) => set({ drawing: { kind: 'PARTITION', roomId, start } }),

      commitPartition: (end) =>
        set((state) => {
          if (state.drawing?.kind !== 'PARTITION' || !state.scene) return state;
          const { roomId, start } = state.drawing;
          const partition: PartitionJson = {
            id: uuid(),
            polyline: [
              [start.x, start.y],
              [end.x, end.y],
            ],
            thickness: 0.12,
          };
          return {
            ...state,
            scene: updateRoom(state.scene, roomId, (r) => ({
              ...r,
              partitions: [...r.partitions, partition],
            })),
            drawing: null,
            tool: 'SELECT',
            dirty: true,
          };
        }),

      cancelDrawing: () => set({ drawing: null }),

      addGate: (roomId, wallEdgeIdx, offsetT, width, type) =>
        set((state) => {
          if (!state.scene) return state;
          const gate: GateJson = { id: uuid(), wallEdgeIdx, offsetT, width, type };
          return {
            ...state,
            scene: updateRoom(state.scene, roomId, (r) => ({ ...r, gates: [...r.gates, gate] })),
            tool: 'SELECT',
            dirty: true,
          };
        }),

      addRoom: (shape, at) =>
        set((state) => {
          if (!state.scene) return state;
          const room: RoomJson = {
            id: uuid(),
            name: `Room ${state.scene.rooms.length + 1}`,
            shape,
            transform: { x: at.x, y: at.y, rot: 0 },
            height: 2.7,
            hourlyRate: null,
            partitions: [],
            gates: [],
          };
          return {
            ...state,
            scene: { ...state.scene, rooms: [...state.scene.rooms, room] },
            selection: { type: 'room', id: room.id },
            tool: 'SELECT',
            dirty: true,
          };
        }),

      addTable: (roomId, shape, at) =>
        set((state) => {
          if (!state.scene) return state;
          const tableId = uuid();
          const table: FurnitureJson = {
            id: tableId,
            roomId,
            kind: 'TABLE',
            label: `Table ${state.scene.furniture.length + 1}`,
            shape,
            transform: { x: at.x, y: at.y, rot: 0 },
            height: 0.74,
          };
          const placement: PlacementJson =
            shape.kind === 'CIRCLE'
              ? { kind: 'RADIAL', count: 6, startAngle: 0, clearance: 0.45 }
              : { kind: 'PERIMETER_EVEN', count: 8, startOffset: 0, clearance: 0.45 };

          const prefix = String.fromCharCode(65 + (state.scene.furniture.length % 26));
          const seats: SeatJson[] = placeSeats({
            shape: shapeFromJson(shape),
            clearance: placement.clearance,
            rule: toRule(placement),
            overrides: [],
            tolerance: 1e-3,
          }).map((p) => ({
            id: uuid(),
            roomId,
            tableId,
            code: `${prefix}${p.index + 1}`,
            shape: { kind: 'CIRCLE', r: 0.22 },
            localTransform: { x: p.x, y: p.y, rot: p.rot },
            placement,
            seatIndex: p.index,
            override: false,
            bookable: true,
            hourlyRate: null,
          }));

          return {
            ...state,
            scene: {
              ...state.scene,
              furniture: [...state.scene.furniture, table],
              seats: [...state.scene.seats, ...seats],
            },
            selection: { type: 'furniture', id: tableId },
            tool: 'SELECT',
            dirty: true,
          };
        }),
    }),
    {
      limit: 100,
      // History tracks the scene ONLY. Without this, selecting something or opening the
      // 3D view would become an undo step, and ctrl+Z would appear to do nothing.
      partialize: (state): UndoableState => ({ scene: state.scene }),
      equality: (a, b) => a.scene === b.scene,
      // Collapse an in-flight drag into a single history entry.
      //
      // `pastState` is the state BEFORE the change, so recording only the FIRST set of a
      // drag captures exactly the pre-drag scene and ignores the rest of the gesture.
      // Skipping every set while dragging instead (the obvious implementation) records
      // nothing at all, and undo then silently jumps past the drag to whatever happened
      // before it.
      handleSet: (handleSet) => (pastState, replace) => {
        if (useEditorStore.getState().dragging) {
          if (dragHistoryRecorded) return;
          dragHistoryRecorded = true;
        }
        handleSet(pastState, replace);
      },
    },
  ),
);

export const useTemporalStore = () => useEditorStore.temporal.getState();
