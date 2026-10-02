import { describe, expect, it } from 'vitest';
import { keyForTool, resolveShortcut, type KeyEventLike } from './shortcuts';

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
    expect(resolveShortcut(press('v'), true)).toEqual({ kind: 'tool', tool: 'SELECT' });
  });

  it('picks a tool by its digit', () => {
    expect(resolveShortcut(press('1'), true)).toEqual({ kind: 'tool', tool: 'SELECT' });
    expect(resolveShortcut(press('2'), true)).toEqual({ kind: 'tool', tool: 'MARQUEE' });
    expect(resolveShortcut(press('6'), true)).toEqual({ kind: 'tool', tool: 'TABLE_RECT' });
    expect(resolveShortcut(press('9'), true)).toEqual({ kind: 'tool', tool: 'PARTITION' });
    expect(resolveShortcut(press('x'), true)).toBeNull();
  });

  it('offers the digit, not V, as a tool\u2019s printed shortcut', () => {
    // Two keys select the pointer; the button has room for one. The digit is the one that
    // matches every other button in the rail.
    expect(keyForTool('SELECT')).toBe('1');
    expect(keyForTool('ROOM_POLY')).toBe('5');
  });

  it('separates duplicate from copy and from select-all', () => {
    expect(resolveShortcut(press('d', { metaKey: true }), true)).toEqual({ kind: 'duplicate' });
    expect(resolveShortcut(press('a', { metaKey: true }), true)).toEqual({ kind: 'selectAll' });
    // Selecting is harmless on a published layout; duplicating into one is not.
    expect(resolveShortcut(press('a', { metaKey: true }), false)).toEqual({ kind: 'selectAll' });
    expect(resolveShortcut(press('d', { metaKey: true }), false)).toBeNull();
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

  it('frames the floor on 0, and on Shift+1 as Figma does', () => {
    // Two keys on purpose. The moment this is needed is the moment the plan is off
    // screen, which is the moment someone is least able to go and look a shortcut up.
    expect(resolveShortcut(press('0'), true)).toEqual({ kind: 'fitView' });
    expect(resolveShortcut(press('!', { shiftKey: true }), true)).toEqual({ kind: 'fitView' });
    // and it works on a layout nobody can edit, because looking is not editing
    expect(resolveShortcut(press('0'), false)).toEqual({ kind: 'fitView' });
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
