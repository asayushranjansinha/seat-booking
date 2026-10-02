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
export type Shortcut =
  | { kind: 'cancel' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'delete' }
  | { kind: 'selectTool' }
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
    return null;
  }

  // Alt is left alone entirely: it composes characters on several keyboard layouts, and
  // claiming it would break typing for people who are not using a US layout.
  if (e.altKey) return null;

  if (e.key === 'Escape') return { kind: 'cancel' };
  if (e.key === 'Delete' || e.key === 'Backspace') return canEdit ? { kind: 'delete' } : null;
  if (key === 'v') return { kind: 'selectTool' };

  const nudge = NUDGES[e.key];
  if (nudge && canEdit) return { kind: 'nudge', dx: nudge[0], dy: nudge[1], big: e.shiftKey };

  return null;
}
