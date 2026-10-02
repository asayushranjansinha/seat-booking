/**
 * Which editor command a keystroke means.
 *
 * <p>Pulled out of the keydown handler because the handler was a long if/else chain, and
 * in a chain like that ORDER silently decides meaning. A bare `v` selects the pointer
 * tool; it was tested before paste and without checking for modifiers, so Cmd+V matched
 * it first, switched tool, and paste was unreachable. Nothing failed — the key simply did
 * something else — which is exactly the kind of bug a chain hides and a table does not.
 *
 * <p>The rule the chain lacked: a combination with Cmd or Ctrl is resolved first, and a
 * bare letter only counts when no modifier is held.
 */
import type { Tool } from '@/state/editorStore';

export type Shortcut =
  | { kind: 'cancel' }
  | { kind: 'tool'; tool: Tool }
  | { kind: 'duplicate' }
  | { kind: 'selectAll' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'delete' }
  | { kind: 'copy' }
  | { kind: 'paste' }
  | { kind: 'nudge'; dx: number; dy: number; big: boolean };

/** Just the parts of a KeyboardEvent that decide this, so it can be tested as data. */
export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Which key picks which tool.
 *
 * <p>Digits, in rail order, plus V for the pointer because every drawing program in
 * existence uses V for the pointer. Letters for the rest were tempting and would have
 * been a worse idea: there is no mnemonic that distinguishes a rectangular room from a
 * rectangular table, and guessing wrong puts a table in a room you did not mean.
 */
export const TOOL_KEYS: Record<string, Tool> = {
  '1': 'SELECT',
  v: 'SELECT',
  '2': 'MARQUEE',
  '3': 'ROOM_RECT',
  '4': 'ROOM_CIRCLE',
  '5': 'ROOM_POLY',
  '6': 'TABLE_RECT',
  '7': 'TABLE_ROUND',
  '8': 'GATE',
  '9': 'PARTITION',
};

/** The key shown on a tool's button, for the tooltip. */
export function keyForTool(tool: Tool): string {
  return Object.entries(TOOL_KEYS).find(([k, t]) => t === tool && k !== 'v')?.[0] ?? '';
}

/** Arrow key to a direction on the floor. Y grows upward, the way the canvas draws it. */
const NUDGES: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

export function resolveShortcut(e: KeyEventLike, canEdit: boolean): Shortcut | null {
  const accel = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  // Accelerated combinations first, so no bare-letter binding can shadow one.
  if (accel) {
    if (key === 'z') return e.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (key === 'c') return { kind: 'copy' };
    if (key === 'v') return canEdit ? { kind: 'paste' } : null;
    if (key === 'd') return canEdit ? { kind: 'duplicate' } : null;
    if (key === 'a') return { kind: 'selectAll' };
    return null;
  }

  // Alt is left alone entirely: it composes characters on several keyboard layouts, and
  // claiming it would break typing for people who are not using a US layout.
  if (e.altKey) return null;

  if (e.key === 'Escape') return { kind: 'cancel' };
  if (e.key === 'Delete' || e.key === 'Backspace') return canEdit ? { kind: 'delete' } : null;
  const tool = TOOL_KEYS[key];
  if (tool) return { kind: 'tool', tool };

  const nudge = NUDGES[e.key];
  if (nudge && canEdit) return { kind: 'nudge', dx: nudge[0], dy: nudge[1], big: e.shiftKey };

  return null;
}
