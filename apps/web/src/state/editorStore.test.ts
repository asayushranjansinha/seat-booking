/**
 * Undo semantics for the editor.
 *
 * <p>These exist because a browser check of the published layout found that a drag was
 * contributing NO history entry at all: the first implementation skipped every set while
 * `dragging` was true, so undo silently jumped past the drag to whatever happened before
 * it. The UI gave no hint; the table in the database was simply the wrong width.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './editorStore';
import type { SceneJson } from '@/api/types';

const TABLE_ID = '11111111-1111-1111-1111-111111111111';
const ROOM_ID = '22222222-2222-2222-2222-222222222222';

function scene(): SceneJson {
  return {
    planVersionId: '33333333-3333-3333-3333-333333333333',
    floorId: '44444444-4444-4444-4444-444444444444',
    status: 'DRAFT',
    revision: 1,
    rooms: [
      {
        id: ROOM_ID,
        name: 'Studio',
        shape: { kind: 'RECT', w: 12, h: 8 },
        transform: { x: 0, y: 0, rot: 0 },
        height: 2.7,
        hourlyRate: null,
        partitions: [],
        gates: [],
      },
    ],
    furniture: [
      {
        id: TABLE_ID,
        roomId: ROOM_ID,
        kind: 'TABLE',
        label: 'Bench A',
        shape: { kind: 'RECT', w: 2.4, h: 1.2 },
        transform: { x: 0, y: 0, rot: 0 },
        height: 0.74,
      },
    ],
    seats: Array.from({ length: 8 }, (_, i) => ({
      id: `seat-${i}`,
      roomId: ROOM_ID,
      tableId: TABLE_ID,
      code: `A${i + 1}`,
      shape: { kind: 'CIRCLE' as const, r: 0.22 },
      localTransform: { x: 0, y: 0, rot: 0 },
      placement: { kind: 'PERIMETER_EVEN' as const, count: 8, startOffset: 0, clearance: 0.45 },
      seatIndex: i,
      override: false,
      bookable: true,
      hourlyRate: null,
    })),
  };
}

const store = () => useEditorStore.getState();
const temporal = () => useEditorStore.temporal.getState();
const table = () => store().scene!.furniture.find((f) => f.id === TABLE_ID)!;
const seat = (i: number) => store().scene!.seats.find((s) => s.seatIndex === i)!;

describe('editor history', () => {
  beforeEach(() => {
    temporal().clear();
    store().loadScene(scene(), '1');
    // Regenerate once so the seats start on their rule positions.
    store().regenerateSeats(TABLE_ID);
    temporal().clear();
  });

  it('resizing a table redistributes its seats in proportion', () => {
    const before = seat(1).localTransform.x;
    store().resizeShape({ type: 'furniture', id: TABLE_ID }, { kind: 'RECT', w: 4.8, h: 1.2 });
    expect(table().shape).toEqual({ kind: 'RECT', w: 4.8, h: 1.2 });
    expect(seat(1).localTransform.x).not.toBeCloseTo(before, 6);
    expect(store().scene!.seats.filter((s) => s.tableId === TABLE_ID)).toHaveLength(8);
  });

  it('a drag contributes exactly ONE history entry, not zero and not one per move', () => {
    const start = temporal().pastStates.length;
    store().beginDrag();
    for (let i = 0; i < 12; i++) {
      store().moveEntity({ type: 'seat', id: seat(2).id }, 1 + i * 0.05, 1 + i * 0.05);
    }
    store().endDrag();
    expect(temporal().pastStates.length - start).toBe(1);
  });

  it('one undo reverts the drag and leaves an earlier resize intact', () => {
    store().resizeShape({ type: 'furniture', id: TABLE_ID }, { kind: 'RECT', w: 4.8, h: 1.2 });
    expect(table().shape).toEqual({ kind: 'RECT', w: 4.8, h: 1.2 });

    store().beginDrag();
    store().moveEntity({ type: 'seat', id: seat(2).id }, 2.5, 1.5);
    store().moveEntity({ type: 'seat', id: seat(2).id }, 2.6, 1.6);
    store().endDrag();
    expect(seat(2).override).toBe(true);

    temporal().undo();

    expect(seat(2).override, 'the drag must be undone').toBe(false);
    expect(table().shape, 'the resize must survive').toEqual({ kind: 'RECT', w: 4.8, h: 1.2 });
  });

  it('a dragged seat pins and the rest still fill the table evenly', () => {
    store().beginDrag();
    store().moveEntity({ type: 'seat', id: seat(3).id }, 1.6, 1.0);
    store().endDrag();

    const seats = store().scene!.seats.filter((s) => s.tableId === TABLE_ID);
    expect(seats).toHaveLength(8);
    expect(seats.filter((s) => s.override)).toHaveLength(1);
    expect(seat(3).override).toBe(true);
  });

  it('selecting something is not an undo step', () => {
    const before = temporal().pastStates.length;
    store().setSelection({ type: 'furniture', id: TABLE_ID });
    store().setView('3D');
    store().setTool('ROOM_RECT');
    expect(temporal().pastStates.length).toBe(before);
  });
});
