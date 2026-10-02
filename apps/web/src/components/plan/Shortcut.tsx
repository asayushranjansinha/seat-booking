'use client';

/**
 * A keyboard shortcut, drawn as keycaps.
 *
 * <p>Every button that has a shortcut shows it here, in its tooltip. The alternative is a
 * help page nobody opens: a shortcut that is only written down somewhere else may as well
 * not exist, and the tooltip is the one place a person is already looking when they are
 * wondering what a button does.
 *
 * <p>Pass the keys as written — "Cmd", "Shift", "1". The modifier symbols are substituted
 * per platform, because Cmd on a Mac and Ctrl on Windows are the same shortcut and
 * showing the wrong one is worse than showing none.
 */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const GLYPHS: Record<string, string> = {
  Cmd: isMac ? '⌘' : 'Ctrl',
  Shift: isMac ? '⇧' : 'Shift',
  Alt: isMac ? '⌥' : 'Alt',
  Backspace: isMac ? '⌫' : 'Del',
  Enter: '↵',
  Esc: 'Esc',
};

export function Shortcut({ keys }: { keys: string[] }) {
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 pl-3">
      {keys.map((key) => (
        <kbd
          key={key}
          className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] leading-none"
        >
          {GLYPHS[key] ?? key}
        </kbd>
      ))}
    </span>
  );
}
