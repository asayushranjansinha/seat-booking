'use client';

import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  placeSeats,
  shapeFromJson,
  type PlacementRule,
  type SeatOverride,
} from '@seat-booking/geometry';
import { arrangeTablesEvenly, type ArrangeResult } from '@/editor/arrange';
import { extract, nextSeatPrefix, paste as pasteClip, type Clip } from '@/editor/clipboard';
import { pointer } from '@/editor/pointer';
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

/** One thing on the canvas. */
export type SelectionItem =
  | { type: 'room'; id: string }
  | { type: 'furniture'; id: string }
  | { type: 'seat'; id: string };

/**
 * One thing, or nothing.
 *
 * <p>Still used wherever exactly one entity is meant — a resize grip belongs to a single
 * shape, and so does every field in the inspector. The SELECTION is a list; this is an
 * element of it.
 */
export type Selection = SelectionItem | null;

/** Stable key for membership tests, since selection items are compared by value. */
export const selectionKey = (item: SelectionItem) => `${item.type}:${item.id}`;

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
  /**
   * Everything selected, in the order it was added.
   *
   * <p>A list rather than one item because a floor is built by duplicating groups: two
   * tables and the gap between them is the unit people actually copy. Operations that
   * only make sense for one thing — the resize grips, the inspector's fields — ask for
   * the single element and do nothing when there are several.
   */
  selection: SelectionItem[];
  tool: Tool;
  violations: ViolationJson[];
  view: '2D' | '3D';
  gridSnap: number;
  angleSnapDegrees: number;
  snapEnabled: boolean;
  dirty: boolean;
  /** True while a pointer drag is in flight, so history records one entry, not sixty. */
  dragging: boolean;
  /**
   * Whether the scene on screen can actually be changed: a DRAFT, in PLAN mode, by an
   * admin. The canvas has to know. Without it the published layout drags around under
   * the pointer and springs back on the next load, because autosave is gated on the very
   * condition the canvas never checked.
   */
  editable: boolean;
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
  setSelection: (selection: SelectionItem[]) => void;
  /** Add to the selection, or remove it if it is already there. Shift-click. */
  toggleSelection: (item: SelectionItem) => void;
  /**
   * Shift everything selected by the same amount, in world metres.
   *
   * <p>Separate from moveEntity because a group has to keep its shape: each member moves
   * by the same delta in ITS OWN parent's frame, which is not the same as moving each one
   * to a snapped absolute position.
   */
  moveSelectionBy: (dx: number, dy: number) => void;
  setTool: (tool: Tool) => void;
  setEditable: (editable: boolean) => void;
  setView: (view: '2D' | '3D') => void;
  setViolations: (violations: ViolationJson[]) => void;
  toggleSnap: () => void;

  beginDrag: () => void;
  endDrag: () => void;

  /**
   * Move something in its parent's frame.
   *
   * <p>{@code snapToGrid} is what a drag wants and what a typed number does not: someone
   * who types 4.3 means 4.3, and silently rounding it to the grid makes the box fight
   * back every time they use it.
   */
  moveEntity: (
    selection: NonNullable<Selection>, x: number, y: number, snapToGrid?: boolean,
  ) => void;
  rotateEntity: (selection: NonNullable<Selection>, rot: number) => void;
  resizeShape: (selection: NonNullable<Selection>, shape: ShapeJson) => void;
  renameRoom: (roomId: string, name: string) => void;
  setRoomRate: (roomId: string, rate: number | null) => void;

  setTableRule: (tableId: string, placement: PlacementJson) => void;
  regenerateSeats: (tableId: string) => void;
  /**
   * Put a room's tables on an even grid and let the rule re-place every chair.
   *
   * <p>Returns what it did so the caller can say whether a zone came out crowded; the
   * change itself is one entry in history, because "arrange the room" is one decision.
   */
  arrangeRoom: (roomId: string) => ArrangeResult;

  /** Take a copy of what is selected. Returns what it took, or null if nothing can be. */
  copySelection: () => Clip | null;
  /**
   * Put the copy down where the pointer is.
   *
   * <p>Returns false when there is nothing to paste or nowhere to put it, so the caller
   * can say which rather than appearing to do nothing.
   */
  pasteClipboard: () => boolean;
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

/**
 * What was last copied.
 *
 * <p>Module-level rather than store state on purpose: a clipboard is not part of the
 * document. Putting it in the store would make copying something an undoable step, and
 * would empty it every time a different floor was loaded — neither of which is how a
 * clipboard has ever behaved.
 */
let clipboard: Clip | null = null;

/** Turn a world delta into a frame rotated by `angle`. */
function rotateDelta(dx: number, dy: number, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

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
      selection: [],
      tool: 'SELECT',
      editable: false,
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
        set({ scene, etag, dirty: false, selection: [], violations: [], drawing: null });
        // Opening a layout is not an edit. Without this the load itself sits in the
        // history as a step from `scene: null`, and undoing far enough unloads the
        // document: the canvas empties and the toolbar reports "no layout".
        useEditorStore.temporal.getState().clear();
      },
      markSaved: (scene, etag) => set({ scene, etag, dirty: false }),
      setSelection: (selection) => set({ selection }),

      toggleSelection: (item) =>
        set((state) => {
          const key = selectionKey(item);
          const without = state.selection.filter((s) => selectionKey(s) !== key);
          return {
            ...state,
            selection: without.length === state.selection.length
              ? [...state.selection, item]
              : without,
          };
        }),
      setTool: (tool) => set({ tool }),
      setEditable: (editable) => set({ editable }),
      setView: (view) => set({ view }),
      setViolations: (violations) => set({ violations }),
      toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

      beginDrag: () => {
        dragHistoryRecorded = false;
        set({ dragging: true });
      },
      endDrag: () => set({ dragging: false }),

      moveEntity: (selection, x, y, snapToGrid = true) =>
        set((state) => {
          if (!state.scene) return state;
          const snap = (v: number) =>
            snapToGrid ? snapValue(v, state.gridSnap, state.snapEnabled) : v;
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

      moveSelectionBy: (dx, dy) =>
        set((state) => {
          if (!state.scene) return state;
          let scene = state.scene;
          const regenerateFor = new Set<string>();

          for (const item of state.selection) {
            if (item.type === 'room') {
              scene = updateRoom(scene, item.id, (r) => ({
                ...r, transform: { ...r.transform, x: r.transform.x + dx, y: r.transform.y + dy },
              }));
            } else if (item.type === 'furniture') {
              // A table's position is in its ROOM's frame. A room can be rotated, so a
              // world delta has to be turned into that frame or a group dragged inside a
              // rotated room would shear instead of moving.
              const table = scene.furniture.find((f) => f.id === item.id);
              const room = scene.rooms.find((r) => r.id === table?.roomId);
              const local = room ? rotateDelta(dx, dy, -room.transform.rot) : { x: dx, y: dy };
              scene = updateFurniture(scene, item.id, (f) => ({
                ...f, transform: { ...f.transform, x: f.transform.x + local.x, y: f.transform.y + local.y },
              }));
            } else {
              const seat = scene.seats.find((s) => s.id === item.id);
              if (!seat) continue;
              const table = scene.furniture.find((f) => f.id === seat.tableId);
              const room = scene.rooms.find((r) => r.id === seat.roomId);
              const rot = (room?.transform.rot ?? 0) + (table?.transform.rot ?? 0);
              const local = rotateDelta(dx, dy, -rot);
              scene = updateSeat(scene, item.id, (sx) => ({
                ...sx,
                override: true,
                localTransform: {
                  ...sx.localTransform,
                  x: sx.localTransform.x + local.x,
                  y: sx.localTransform.y + local.y,
                },
              }));
              if (seat.tableId) regenerateFor.add(seat.tableId);
            }
          }

          for (const tableId of regenerateFor) scene = regenerate(scene, tableId);
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

      copySelection: () => {
        const state = get();
        if (!state.scene) return null;
        const clip = extract(state.scene, state.selection);
        if (clip) clipboard = clip;
        return clip;
      },

      pasteClipboard: () => {
        const state = get();
        if (!state.scene || !clipboard) return false;
        const result = pasteClip(
          state.scene,
          clipboard,
          pointer.overCanvas ? { x: pointer.x, y: pointer.y } : null,
        );
        if (!result) return false;
        set({ scene: result.scene, selection: result.selection, dirty: true });
        return true;
      },

      arrangeRoom: (roomId) => {
        const current = get().scene;
        if (!current) return { moves: [], crowded: [] };
        const result = arrangeTablesEvenly(current, roomId);
        if (result.moves.length === 0) return result;

        set((state) => {
          if (!state.scene) return state;
          let scene = state.scene;
          for (const move of result.moves) {
            scene = updateFurniture(scene, move.tableId, (f) => ({
              ...f,
              transform: { ...f.transform, x: move.x, y: move.y },
            }));
          }
          // Pinned chairs are usually WHY a room looks uneven, so arranging releases them
          // back to the table's rule. Collected first: the loop below replaces the scene
          // on every step, and iterating a list that is being rebuilt underneath you is
          // how half the chairs get missed.
          const pinned = scene.seats
            .filter((seat) => seat.override && result.moves.some((m) => m.tableId === seat.tableId))
            .map((seat) => seat.id);
          for (const seatId of pinned) {
            scene = updateSeat(scene, seatId, (seat) => ({ ...seat, override: false }));
          }
          for (const move of result.moves) scene = regenerate(scene, move.tableId);
          return { ...state, scene, dirty: true };
        });
        return result;
      },

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
          if (!scene || selection.length === 0) return state;

          const rooms = new Set(selection.filter((x) => x.type === 'room').map((x) => x.id));
          const tables = new Set(selection.filter((x) => x.type === 'furniture').map((x) => x.id));
          const seats = new Set(selection.filter((x) => x.type === 'seat').map((x) => x.id));

          // Deleting a room takes its tables and their seats with it, and deleting a
          // table takes its seats. Selecting a room AND one of its tables is therefore
          // not a conflict: the room wins and the table goes anyway.
          const next: SceneJson = {
            ...scene,
            rooms: scene.rooms.filter((r) => !rooms.has(r.id)),
            furniture: scene.furniture.filter((f) => !rooms.has(f.roomId) && !tables.has(f.id)),
            seats: scene.seats.filter((x) =>
              !rooms.has(x.roomId)
              && !(x.tableId !== null && tables.has(x.tableId))
              && !seats.has(x.id)),
          };

          // A seat deleted on its own leaves a gap its table's rule can close.
          let scene2 = next;
          const regenerateFor = new Set(
            scene.seats
              .filter((x) => seats.has(x.id) && x.tableId && !tables.has(x.tableId))
              .map((x) => x.tableId!),
          );
          for (const tableId of regenerateFor) scene2 = regenerate(scene2, tableId);

          return { ...state, scene: scene2, selection: [], dirty: true };
        }),

      setCursor: (cursor) => set({ cursor }),
      setMode: (mode) => set({ mode, selection: [], tool: 'SELECT', drawing: null }),
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
            selection: [{ type: 'room', id: room.id }],
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
            selection: [{ type: 'room', id: room.id }],
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

          // Was (furniture count % 26), which hands the 27th table the letter A and
          // duplicates every code the first table owns; seat_code_unique_per_version then
          // refuses the save at publish time, with 26 tables already drawn. Choose by what
          // is actually unused instead.
          const prefix = nextSeatPrefix(state.scene);
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
            selection: [{ type: 'furniture', id: tableId }],
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

/**
 * The one selected thing, when exactly one thing is selected.
 *
 * <p>Most of the inspector edits a single entity and has no meaning for a group: there is
 * no one width to type when two tables are selected. Those panels ask for this and fall
 * back to the group summary when it is null.
 */
export function useSingleSelection(): Selection {
  const selection = useEditorStore((s) => s.selection);
  return selection.length === 1 ? selection[0]! : null;
}
