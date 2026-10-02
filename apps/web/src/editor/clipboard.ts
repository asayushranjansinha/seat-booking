/**
 * Copy and paste for the editor.
 *
 * <p>A floor is repetitive by nature: the same bench, the same meeting table, laid out
 * again on the other side of a partition. Drawing each one and re-tuning its seat rule is
 * the slow way to produce something that was always meant to be identical.
 *
 * <p>Paste goes WHERE THE POINTER IS, into whichever room is under it, because that is
 * the only answer that needs no further dragging — and pasting into a different partition
 * of the same room is then not a special case at all. Partitions divide a room visually;
 * a table still belongs to the room, so moving one between zones is only a position.
 *
 * <p>With the pointer off the canvas there is nowhere obvious to aim, so the copy lands
 * back in its own room, nudged, in the way every drawing program has done for decades.
 */
import { applyTransform, invertTransform } from '@seat-booking/geometry';
import { roomAt } from '@/canvas/snapping';
import type {
  FurnitureJson, GateJson, PartitionJson, RoomJson, SceneJson, SeatJson,
} from '@/api/types';
// Type-only, so it is erased at compile time and the store importing this module back
// does not create a cycle at runtime.
import type { Selection } from '@/state/editorStore';

/** How far a paste with no pointer to aim at is nudged, in metres. */
const NUDGE = 0.5;

const uuid = () => crypto.randomUUID();

export type Clip =
  | { kind: 'furniture'; table: FurnitureJson; seats: SeatJson[] }
  | { kind: 'room'; room: RoomJson; furniture: FurnitureJson[]; seats: SeatJson[] };

/** What the clipboard would take right now, or nothing if the selection cannot be copied. */
export function extract(scene: SceneJson, selection: Selection): Clip | null {
  if (!selection) return null;

  if (selection.type === 'furniture') {
    const table = scene.furniture.find((f) => f.id === selection.id);
    if (!table) return null;
    return {
      kind: 'furniture',
      table,
      seats: scene.seats.filter((s) => s.tableId === table.id),
    };
  }

  if (selection.type === 'room') {
    const room = scene.rooms.find((r) => r.id === selection.id);
    if (!room) return null;
    const furniture = scene.furniture.filter((f) => f.roomId === room.id);
    return {
      kind: 'room',
      room,
      furniture,
      seats: scene.seats.filter((s) => s.roomId === room.id),
    };
  }

  // A seat alone is not copyable. It exists at an index in a table's placement rule, and
  // a loose duplicate of it would be a seat the rule does not know about and regeneration
  // would immediately move or discard. Copy the table.
  return null;
}

/**
 * The next free seat-code prefix.
 *
 * <p>Seat codes are unique per plan version — the database says so — and the original
 * rule, one letter per table by position, repeats itself at the 27th table. That was
 * survivable while tables were drawn one at a time. Duplicating a table is how a floor
 * reaches 27 quickly, so the prefix is now chosen by what is actually unused, and runs on
 * into AA, AB after Z rather than wrapping back onto A.
 */
export function nextSeatPrefix(scene: SceneJson): string {
  const taken = new Set<string>();
  for (const seat of scene.seats) {
    const prefix = seat.code.match(/^[A-Z]+/)?.[0];
    if (prefix) taken.add(prefix);
  }
  const letter = (n: number) => String.fromCharCode(65 + n);
  for (let i = 0; i < 26; i++) {
    if (!taken.has(letter(i))) return letter(i);
  }
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const two = letter(i) + letter(j);
      if (!taken.has(two)) return two;
    }
  }
  return uuid().slice(0, 4).toUpperCase(); // 702 tables in; something has gone very wrong
}

/** A fresh copy of one table's seats, re-coded and re-parented. */
function copySeats(
  seats: readonly SeatJson[], roomId: string, tableId: string | null, prefix: string,
): SeatJson[] {
  return seats.map((seat) => ({
    ...seat,
    id: uuid(),
    roomId,
    tableId,
    code: `${prefix}${seat.seatIndex + 1}`,
    // Bookings live on seats, and the copy has none. Carrying a rate across is right;
    // carrying anything that implies history would not be.
    hourlyRate: seat.hourlyRate,
  }));
}

export interface PasteResult {
  scene: SceneJson;
  selection: NonNullable<Selection>;
}

/**
 * Put the clipboard down.
 *
 * <p>{@code at} is a point on the floor in world coordinates — where the pointer is —
 * or null when the pointer is not over the canvas.
 */
export function paste(scene: SceneJson, clip: Clip, at: { x: number; y: number } | null): PasteResult | null {
  if (clip.kind === 'room') {
    const roomId = uuid();
    const room: RoomJson = {
      ...clip.room,
      id: roomId,
      name: `${clip.room.name} copy`,
      transform: at
        ? { ...clip.room.transform, x: at.x, y: at.y }
        : { ...clip.room.transform, x: clip.room.transform.x + NUDGE, y: clip.room.transform.y - NUDGE },
      // Derived server-side from the partitions; sending a stale copy back would describe
      // zones that no longer match the outline.
      subZones: undefined,
      partitions: clip.room.partitions.map((p: PartitionJson) => ({ ...p, id: uuid() })),
      gates: clip.room.gates.map((g: GateJson) => ({ ...g, id: uuid() })),
    };

    let furniture: FurnitureJson[] = [];
    let seats: SeatJson[] = [];
    for (const table of clip.furniture) {
      const tableId = uuid();
      furniture = [...furniture, { ...table, id: tableId, roomId }];
      const prefix = nextSeatPrefix({ ...scene, seats: [...scene.seats, ...seats] });
      seats = [
        ...seats,
        ...copySeats(clip.seats.filter((s) => s.tableId === table.id), roomId, tableId, prefix),
      ];
    }

    return {
      scene: {
        ...scene,
        rooms: [...scene.rooms, room],
        furniture: [...scene.furniture, ...furniture],
        seats: [...scene.seats, ...seats],
      },
      selection: { type: 'room', id: roomId },
    };
  }

  // A table's position is stored in its ROOM's frame, so a world point has to be brought
  // into that room before it means anything. Drop it in the room under the pointer, which
  // is what makes pasting across a partition — or into a different room entirely — work
  // without a separate command.
  const target = at ? roomAt(scene, at) : null;
  const room = target ?? scene.rooms.find((r) => r.id === clip.table.roomId);
  if (!room) return null;

  const local = at && target
    ? applyTransform(invertTransform(room.transform), at)
    : { x: clip.table.transform.x + NUDGE, y: clip.table.transform.y - NUDGE };

  const tableId = uuid();
  const table: FurnitureJson = {
    ...clip.table,
    id: tableId,
    roomId: room.id,
    label: clip.table.label ? `${clip.table.label} copy` : null,
    transform: { ...clip.table.transform, x: local.x, y: local.y },
  };

  return {
    scene: {
      ...scene,
      furniture: [...scene.furniture, table],
      seats: [...scene.seats, ...copySeats(clip.seats, room.id, tableId, nextSeatPrefix(scene))],
    },
    selection: { type: 'furniture', id: tableId },
  };
}
