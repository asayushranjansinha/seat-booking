/**
 * Copy and paste.
 *
 * <p>The cases worth pinning down are the ones that corrupt a plan rather than merely
 * looking wrong: a pasted table whose seats reuse codes the database requires to be
 * unique, a paste that silently shares ids with its original, and a paste into a
 * different room that writes the pointer's WORLD position into a room-local transform.
 */
import { describe, expect, it } from 'vitest';
import { extract, paste, nextSeatPrefix } from './clipboard';
import type { FurnitureJson, SceneJson, SeatJson } from '@/api/types';
import type { SelectionItem } from '@/state/editorStore';

const ROOM_A = 'room-a';
const ROOM_B = 'room-b';

function seatsFor(tableId: string, roomId: string, prefix: string): SeatJson[] {
  return [0, 1, 2].map((i) => ({
    id: `${tableId}-s${i}`, roomId, tableId,
    code: `${prefix}${i + 1}`,
    shape: { kind: 'CIRCLE', r: 0.22 },
    localTransform: { x: i - 1, y: 1, rot: 0 },
    placement: { kind: 'PERIMETER_EVEN', count: 3, clearance: 0.45 },
    seatIndex: i, override: false, bookable: true, hourlyRate: 7,
  }));
}

function table(id: string, roomId: string, x: number, y: number): FurnitureJson {
  return {
    id, roomId, kind: 'TABLE', label: 'Bench',
    shape: { kind: 'RECT', w: 2, h: 1 },
    transform: { x, y, rot: 0.25 },
    height: 0.74,
  };
}

/** Two rooms side by side. Room B sits 20 m to the right of room A. */
function scene(): SceneJson {
  return {
    planVersionId: 'v', floorId: 'f', status: 'DRAFT', revision: 1,
    rooms: [
      {
        id: ROOM_A, name: 'Studio', shape: { kind: 'RECT', w: 10, h: 10 },
        transform: { x: 0, y: 0, rot: 0 }, height: 2.7, hourlyRate: null,
        partitions: [], gates: [],
      },
      {
        id: ROOM_B, name: 'Annex', shape: { kind: 'RECT', w: 10, h: 10 },
        transform: { x: 20, y: 0, rot: 0 }, height: 2.7, hourlyRate: null,
        partitions: [], gates: [],
      },
    ],
    furniture: [table('t1', ROOM_A, 1, 1)],
    seats: seatsFor('t1', ROOM_A, 'A'),
  };
}

describe('copy', () => {
  it('takes a table with its seats', () => {
    const clip = extract(scene(), [{ type: 'furniture', id: 't1' }])!;
    expect(clip.tables).toHaveLength(1);
    expect(clip.seats).toHaveLength(3);
  });

  it('refuses a lone seat', () => {
    // A seat exists at an index in its table's rule. A loose duplicate is a seat the rule
    // does not know about, and the next regeneration would move or discard it.
    expect(extract(scene(), [{ type: 'seat', id: 't1-s0' }])).toBeNull();
  });

  it('takes a room with everything in it', () => {
    const clip = extract(scene(), [{ type: 'room', id: ROOM_A }])!;
    expect(clip.rooms).toHaveLength(1);
    expect(clip.tables).toHaveLength(1);
    expect(clip.seats).toHaveLength(3);
  });

  it('does not take a table twice when its room is selected too', () => {
    // The room's copy already carries it. Taking it again would paste two tables in the
    // same spot, one inside the copied room and one loose on top of it.
    const clip = extract(scene(), [
      { type: 'room', id: ROOM_A }, { type: 'furniture', id: 't1' },
    ])!;
    expect(clip.tables).toHaveLength(1);
  });
});

describe('paste', () => {
  const clipOf = (s: SceneJson) => extract(s, [{ type: 'furniture', id: 't1' }])!;

  it('shares no ids with the original', () => {
    const s = scene();
    const out = paste(s, clipOf(s), { x: 2, y: 2 })!;
    const ids = out.scene.furniture.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seatIds = out.scene.seats.map((x) => x.id);
    expect(new Set(seatIds).size).toBe(seatIds.length);
  });

  it('gives the copy seat codes nothing else is using', () => {
    const s = scene();
    const out = paste(s, clipOf(s), { x: 2, y: 2 })!;
    const codes = out.scene.seats.map((x) => x.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('converts the pointer into the TARGET room’s frame, not the source’s', () => {
    const s = scene();
    // (22, 3) is inside room B, which starts at x = 20. Stored in room B's frame that is
    // x = 2. Writing the world x of 22 would put the table 22 m into a 10 m room.
    const out = paste(s, clipOf(s), { x: 22, y: 3 })!;
    const pasted = out.scene.furniture.find((f) => f.id === out.selection[0]!.id)!;
    expect(pasted.roomId).toBe(ROOM_B);
    expect(pasted.transform.x).toBeCloseTo(2, 9);
    expect(pasted.transform.y).toBeCloseTo(3, 9);
  });

  it('re-parents the seats to the room it landed in', () => {
    const s = scene();
    const out = paste(s, clipOf(s), { x: 22, y: 3 })!;
    const pastedSeats = out.scene.seats.filter((x) => x.tableId === out.selection[0]!.id);
    expect(pastedSeats).toHaveLength(3);
    for (const seat of pastedSeats) expect(seat.roomId).toBe(ROOM_B);
  });

  it('keeps rotation and the seat rule', () => {
    const s = scene();
    const out = paste(s, clipOf(s), { x: 2, y: 2 })!;
    const pasted = out.scene.furniture.find((f) => f.id === out.selection[0]!.id)!;
    expect(pasted.transform.rot).toBeCloseTo(0.25, 9);
    const seat = out.scene.seats.find((x) => x.tableId === pasted.id)!;
    expect(seat.placement).toEqual({ kind: 'PERIMETER_EVEN', count: 3, clearance: 0.45 });
    expect(seat.localTransform).toEqual({ x: -1, y: 1, rot: 0 });
  });

  it('falls back to a nudge in its own room when the pointer is off the canvas', () => {
    const s = scene();
    const out = paste(s, clipOf(s), null)!;
    const pasted = out.scene.furniture.find((f) => f.id === out.selection[0]!.id)!;
    expect(pasted.roomId).toBe(ROOM_A);
    expect(pasted.transform.x).toBeCloseTo(1.5, 9);
    expect(pasted.transform.y).toBeCloseTo(0.5, 9);
  });

  it('pastes a room with new ids all the way down', () => {
    const s = scene();
    const clip = extract(s, [{ type: 'room', id: ROOM_A }])!;
    const out = paste(s, clip, { x: 40, y: 0 })!;
    expect(out.scene.rooms).toHaveLength(3);
    const copy = out.scene.rooms.find((r) => r.id === out.selection[0]!.id)!;
    expect(copy.id).not.toBe(ROOM_A);
    const copied = out.scene.furniture.filter((f) => f.roomId === copy.id);
    expect(copied).toHaveLength(1);
    expect(copied[0]!.id).not.toBe('t1');
    const codes = out.scene.seats.map((x) => x.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('drops the server-derived zones from a copied room', () => {
    const s = scene();
    s.rooms[0]!.subZones = [{ index: 0, name: 'Zone A', area: 50, ring: [[0, 0], [1, 0], [1, 1]] }];
    const out = paste(s, extract(s, [{ type: 'room', id: ROOM_A }])!, { x: 40, y: 0 })!;
    const copy = out.scene.rooms.find((r) => r.id === out.selection[0]!.id)!;
    // Sub-zones are derived from the partitions by the server. Sending a stale copy back
    // would describe zones that do not match the outline it came with.
    expect(copy.subZones).toBeUndefined();
  });
});

describe('nextSeatPrefix', () => {
  it('skips prefixes already in use', () => {
    const s = scene(); // uses 'A'
    expect(nextSeatPrefix(s)).toBe('B');
  });

  it('runs on past Z instead of wrapping back onto A', () => {
    // The original rule was (table count % 26), which hands the 27th table the letter A
    // and duplicates every seat code the first table owns. seat_code_unique_per_version
    // then refuses the save, at publish time, with 26 tables already drawn.
    const s = scene();
    s.seats = [];
    for (let i = 0; i < 26; i++) {
      s.seats.push(...seatsFor(`t${i}`, ROOM_A, String.fromCharCode(65 + i)));
    }
    expect(nextSeatPrefix(s)).toBe('AA');
  });
});

describe('copying a group', () => {
  /** Two tables 4 m apart in room A. */
  function pair(): SceneJson {
    const s = scene();
    s.furniture.push(table('t2', ROOM_A, 5, 1));
    s.seats.push(...seatsFor('t2', ROOM_A, 'B'));
    return s;
  }

  const bothTables: SelectionItem[] = [
    { type: 'furniture', id: 't1' }, { type: 'furniture', id: 't2' },
  ];

  it('keeps the spacing between the things it copied', () => {
    // The point of a group. t1 is at x=1 and t2 at x=5, so whatever the paste lands on,
    // the two copies must still be 4 m apart — not stacked on the pointer.
    const s = pair();
    const out = paste(s, extract(s, bothTables)!, { x: 3, y: 7 })!;
    expect(out.selection).toHaveLength(2);
    const xs = out.selection
      .map((sel) => out.scene.furniture.find((f) => f.id === sel.id)!.transform.x)
      .sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeCloseTo(4, 9);
  });

  it('centres the group on the pointer', () => {
    // The anchor is the middle of what was taken: x = (1 + 5) / 2 = 3. Dropped at x = 10
    // the pair should straddle it at 8 and 12.
    const s = pair();
    const out = paste(s, extract(s, bothTables)!, { x: 10, y: 1 })!;
    const xs = out.selection
      .map((sel) => out.scene.furniture.find((f) => f.id === sel.id)!.transform.x)
      .sort((a, b) => a - b);
    expect(xs).toEqual([8, 12]);
  });

  it('gives every copy in the group its own seat codes', () => {
    const s = pair();
    const out = paste(s, extract(s, bothTables)!, { x: 3, y: 7 })!;
    const codes = out.scene.seats.map((x) => x.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('selects what it just pasted, so it can be moved straight away', () => {
    const s = pair();
    const out = paste(s, extract(s, bothTables)!, { x: 3, y: 7 })!;
    for (const sel of out.selection) {
      expect(sel.type).toBe('furniture');
      expect([...s.furniture.map((f) => f.id)]).not.toContain(sel.id);
    }
  });

  it('keeps a copied room\u2019s tables where they sat inside it', () => {
    const s = pair();
    const out = paste(s, extract(s, [{ type: 'room', id: ROOM_A }])!, { x: 40, y: 0 })!;
    const copy = out.scene.rooms.find((r) => r.id === out.selection[0]!.id)!;
    const inside = out.scene.furniture.filter((f) => f.roomId === copy.id);
    expect(inside).toHaveLength(2);
    // Their positions are stored in the room's frame, so moving the room must not have
    // touched them.
    expect(inside.map((f) => f.transform.x).sort((a, b) => a - b)).toEqual([1, 5]);
    // and only the room is selected: its tables are not loose things to drag away
    expect(out.selection).toHaveLength(1);
  });
});
