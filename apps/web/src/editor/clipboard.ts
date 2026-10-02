/**
 * Copy and paste for the editor.
 *
 * <p>A floor is repetitive by nature: the same pair of benches, the same meeting table,
 * laid out again on the other side of a partition. Drawing each one and re-tuning its
 * seat rule is the slow way to produce something that was always meant to be identical.
 *
 * <p>A copy is a GROUP, because the unit people actually duplicate is "these two tables
 * and the gap between them". Everything moves by one offset, so what comes out is
 * arranged exactly like what went in.
 *
 * <p>Paste goes WHERE THE POINTER IS, into whichever room is under it, because that is
 * the only answer that needs no further dragging — and pasting into a different partition
 * of the same room is then not a special case at all. Partitions divide a room visually;
 * a table still belongs to the room, so moving one between zones is only a position.
 *
 * <p>With the pointer off the canvas there is nowhere obvious to aim, so the copy lands
 * beside its original, in the way every drawing program has done for decades.
 */
import { applyTransform, invertTransform } from '@seat-booking/geometry';
import { roomAt } from '@/canvas/snapping';
import type {
  FurnitureJson, GateJson, PartitionJson, RoomJson, SceneJson, SeatJson,
} from '@/api/types';
// Type-only, so it is erased at compile time and the store importing this module back
// does not create a cycle at runtime.
import type { SelectionItem } from '@/state/editorStore';

/** How far a paste with no pointer to aim at is nudged, in metres. */
const NUDGE = 0.5;

const uuid = () => crypto.randomUUID();

/**
 * What was copied.
 *
 * <p>{@code anchor} is the centre of what was taken, in world metres. Paste moves the
 * whole group by (target - anchor), which is what keeps two tables two tables apart
 * rather than stacking them both on the pointer.
 */
export interface Clip {
  rooms: RoomJson[];
  /** Every copied table: those selected outright, and those inside a copied room. */
  tables: FurnitureJson[];
  seats: SeatJson[];
  anchor: { x: number; y: number };
}

/** Where a table sits on the floor, with its room's own placement taken into account. */
function worldOf(scene: SceneJson, table: FurnitureJson): { x: number; y: number } {
  const room = scene.rooms.find((r) => r.id === table.roomId);
  return room ? applyTransform(room.transform, table.transform) : table.transform;
}

/** What the clipboard would take right now, or nothing if none of it can be copied. */
export function extract(scene: SceneJson, selection: readonly SelectionItem[]): Clip | null {
  const wanted = (type: string, id: string) =>
    selection.some((x) => x.type === type && x.id === id);

  const rooms = scene.rooms.filter((r) => wanted('room', r.id));
  const roomIds = new Set(rooms.map((r) => r.id));

  // A table inside a copied room travels WITH the room and keeps its place in it. One
  // selected on its own is positioned against the pointer instead. Selecting both a room
  // and a table inside it is therefore not a conflict — the room's copy covers it, and
  // taking it twice would paste two tables on top of each other.
  const inherited = scene.furniture.filter((f) => roomIds.has(f.roomId));
  const standalone = scene.furniture.filter(
    (f) => !roomIds.has(f.roomId) && wanted('furniture', f.id),
  );
  const tables = [...inherited, ...standalone];

  if (rooms.length === 0 && standalone.length === 0) return null;

  // Seats are deliberately not copyable alone: a seat exists at an index in its table's
  // placement rule, and a loose duplicate is one the rule does not know about that the
  // next regeneration would move or discard. They come with their table.
  const tableIds = new Set(tables.map((f) => f.id));
  const seats = scene.seats.filter((s) => s.tableId !== null && tableIds.has(s.tableId));

  const points = [
    ...rooms.map((r) => ({ x: r.transform.x, y: r.transform.y })),
    ...standalone.map((f) => worldOf(scene, f)),
  ];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const anchor = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };

  return { rooms, tables, seats, anchor };
}

/**
 * The next free seat-code prefix.
 *
 * <p>Seat codes are unique per plan version — the database says so — and the original
 * rule, one letter per table by position, repeats itself at the 27th table. That was
 * survivable while tables were drawn one at a time. Duplicating a group is how a floor
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
  seats: readonly SeatJson[], roomId: string, tableId: string, prefix: string,
): SeatJson[] {
  return seats.map((seat) => ({
    ...seat,
    id: uuid(),
    roomId,
    tableId,
    code: `${prefix}${seat.seatIndex + 1}`,
  }));
}

export interface PasteResult {
  scene: SceneJson;
  selection: SelectionItem[];
}

/**
 * Put the clipboard down.
 *
 * <p>{@code at} is a point on the floor in world metres — where the pointer is — or null
 * when the pointer is not over the canvas.
 */
export function paste(
  scene: SceneJson, clip: Clip, at: { x: number; y: number } | null,
): PasteResult | null {
  const dx = at ? at.x - clip.anchor.x : NUDGE;
  const dy = at ? at.y - clip.anchor.y : -NUDGE;

  let next = scene;
  const selection: SelectionItem[] = [];
  const newRoomOf = new Map<string, string>();

  for (const source of clip.rooms) {
    const roomId = uuid();
    newRoomOf.set(source.id, roomId);
    next = {
      ...next,
      rooms: [...next.rooms, {
        ...source,
        id: roomId,
        name: `${source.name} copy`,
        transform: { ...source.transform, x: source.transform.x + dx, y: source.transform.y + dy },
        // Derived server-side from the partitions; sending a stale copy back would
        // describe zones that no longer match the outline it came with.
        subZones: undefined,
        partitions: source.partitions.map((p: PartitionJson) => ({ ...p, id: uuid() })),
        gates: source.gates.map((g: GateJson) => ({ ...g, id: uuid() })),
      }],
    };
    selection.push({ type: 'room', id: roomId });
  }

  for (const source of clip.tables) {
    const inheritedRoom = newRoomOf.get(source.roomId);
    let roomId: string;
    let local: { x: number; y: number };

    if (inheritedRoom) {
      // Carried by its room, which has already moved. Its place INSIDE the room is
      // unchanged, which is the whole point of a room-local transform.
      roomId = inheritedRoom;
      local = { x: source.transform.x, y: source.transform.y };
    } else {
      const landed = { x: worldOf(scene, source).x + dx, y: worldOf(scene, source).y + dy };
      const room = roomAt(next, landed) ?? next.rooms.find((r) => r.id === source.roomId);
      if (!room) continue;
      roomId = room.id;
      local = applyTransform(invertTransform(room.transform), landed);
    }

    const tableId = uuid();
    next = {
      ...next,
      furniture: [...next.furniture, {
        ...source,
        id: tableId,
        roomId,
        label: source.label && !inheritedRoom ? `${source.label} copy` : source.label,
        transform: { ...source.transform, x: local.x, y: local.y },
      }],
      seats: [
        ...next.seats,
        ...copySeats(
          clip.seats.filter((x) => x.tableId === source.id), roomId, tableId, nextSeatPrefix(next),
        ),
      ],
    };
    // A table inside a copied room is not selected in its own right: the room is.
    if (!inheritedRoom) selection.push({ type: 'furniture', id: tableId });
  }

  if (selection.length === 0) return null;
  return { scene: next, selection };
}
