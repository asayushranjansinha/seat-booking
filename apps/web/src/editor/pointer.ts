/**
 * Where the pointer is on the floor, in world metres.
 *
 * <p>A plain module variable rather than store state, and deliberately. Paste needs to
 * know where the mouse is; the store cannot hold that, because writing it on every
 * pointermove would notify every subscriber sixty times a second and rebuild the scene
 * graph for a number nothing is drawing. This is written by the canvas and read once,
 * when someone actually presses a key.
 */
export const pointer: { x: number; y: number; overCanvas: boolean } = {
  x: 0,
  y: 0,
  overCanvas: false,
};
