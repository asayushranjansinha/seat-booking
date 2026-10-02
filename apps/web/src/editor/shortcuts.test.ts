import { describe, expect, it } from 'vitest';
import { resolveShortcut, type KeyEventLike } from './shortcuts';

const press = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
});

describe('resolveShortcut', () => {
  it('reads Cmd+V as paste, not as the pointer tool', () => {
    // The regression. A bare `v` selects the pointer tool, and in the old if/else chain
    // that branch was tested first and did not look at modifiers, so Cmd+V silently
    // switched tool and paste could never run.
    expect(resolveShortcut(press('v', { metaKey: true }), true)).toEqual({ kind: 'paste' });
    expect(resolveShortcut(press('v', { ctrlKey: true }), true)).toEqual({ kind: 'paste' });
    expect(resolveShortcut(press('v'), true)).toEqual({ kind: 'selectTool' });
  });

  it('does not paste into a layout that cannot be edited', () => {
    expect(resolveShortcut(press('v', { metaKey: true }), false)).toBeNull();
    // but copying from a published layout is harmless and useful
    expect(resolveShortcut(press('c', { metaKey: true }), false)).toEqual({ kind: 'copy' });
  });

  it('keeps undo and redo apart', () => {
    expect(resolveShortcut(press('z', { metaKey: true }), true)).toEqual({ kind: 'undo' });
    expect(resolveShortcut(press('z', { metaKey: true, shiftKey: true }), true))
      .toEqual({ kind: 'redo' });
  });

  it('nudges by arrow, four times as far with shift', () => {
    expect(resolveShortcut(press('ArrowLeft'), true))
      .toEqual({ kind: 'nudge', dx: -1, dy: 0, big: false });
    expect(resolveShortcut(press('ArrowUp', { shiftKey: true }), true))
      .toEqual({ kind: 'nudge', dx: 0, dy: 1, big: true });
    expect(resolveShortcut(press('ArrowUp'), false)).toBeNull();
  });

  it('leaves Alt combinations alone', () => {
    // Alt composes characters on several layouts; claiming it breaks typing for anyone
    // not on a US keyboard.
    expect(resolveShortcut(press('v', { altKey: true }), true)).toBeNull();
  });

  it('cancels on Escape whether or not the layout is editable', () => {
    expect(resolveShortcut(press('Escape'), false)).toEqual({ kind: 'cancel' });
  });

  it('deletes only when the layout can be edited', () => {
    expect(resolveShortcut(press('Delete'), true)).toEqual({ kind: 'delete' });
    expect(resolveShortcut(press('Backspace'), false)).toBeNull();
  });
});
