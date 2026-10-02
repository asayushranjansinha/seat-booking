/**
 * A colour per table, so a floor of nine benches is nine things rather than one texture.
 *
 * <p>Chosen from the table's ID, not from its position in the room. Position looks tidier
 * — neighbours would be guaranteed to differ — and it means a table changes colour while
 * you drag it past another one, which is the sort of movement the eye reads as something
 * going wrong. An id is fixed for the life of the table, so its colour is too, and a
 * duplicate gets its own.
 *
 * <p>Muted on purpose. Tables are the biggest objects on a dark plan and the seats have
 * to stay the brightest thing on it, because the seats are what the booking view is for.
 */

export const TABLE_PALETTE = [
  0x3a4a63, // the original slate
  0x4a4163, // mauve
  0x3f5a58, // teal
  0x5a4a3f, // clay
  0x455a3f, // moss
  0x5a3f4a, // plum
  0x3f4a5a, // steel
  0x56523f, // olive
] as const;

/**
 * Scale a colour's channels, for a rim darker than its top or an edge lighter than it.
 *
 * <p>Clamped, because brightening is as useful as darkening here and a channel that runs
 * past 255 wraps into the next one — a lightened blue coming back green.
 */
export function shade(colour: number, by: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((colour >> 16) & 0xff) * by);
  const g = clamp(((colour >> 8) & 0xff) * by);
  const b = clamp((colour & 0xff) * by);
  return (r << 16) | (g << 8) | b;
}

/**
 * Stable hash of an id to a palette slot.
 *
 * <p>Any spread would do; this one is FNV-1a because it is four lines and does not clump
 * the way summing characters does on ids sharing a prefix — which UUIDs minted in one
 * batch often do.
 */
export function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The palette slot an id lands in. */
export function tableColour(id: string): number {
  return TABLE_PALETTE[hashId(id) % TABLE_PALETTE.length]!;
}
