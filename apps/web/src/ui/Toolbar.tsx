'use client';

import { useEditorStore, type Tool } from '@/state/editorStore';

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: 'SELECT', label: 'Select', hint: 'Select, drag, and use the grips to rotate or resize (V)' },
  { id: 'ROOM_RECT', label: 'Rect room', hint: 'Click to place a rectangular room' },
  { id: 'ROOM_CIRCLE', label: 'Round room', hint: 'Click to place a circular room' },
  { id: 'ROOM_POLY', label: 'Pen', hint: 'Click each corner; click the first point again to close. Esc cancels' },
  { id: 'TABLE_RECT', label: 'Rect table', hint: 'Click inside a room to add a rectangular table' },
  { id: 'TABLE_ROUND', label: 'Round table', hint: 'Click inside a room to add a round table' },
  { id: 'GATE', label: 'Gate', hint: 'Click a wall to place a door on it' },
  { id: 'PARTITION', label: 'Partition', hint: 'Click one wall then another to divide the room' },
];

export function Toolbar({
  onSave,
  onValidate,
  onPublish,
  onCreateDraft,
  busy,
  canEdit,
}: {
  onSave: () => void;
  onValidate: () => void;
  onPublish: () => void;
  onCreateDraft: () => void;
  busy: string | null;
  canEdit: boolean;
}) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const view = useEditorStore((s) => s.view);
  const setView = useEditorStore((s) => s.setView);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const scene = useEditorStore((s) => s.scene);
  const dirty = useEditorStore((s) => s.dirty);
  const drawing = useEditorStore((s) => s.drawing);

  const temporal = useEditorStore.temporal;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--panel)',
        flexWrap: 'wrap',
      }}
    >
      {canEdit &&
        TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.hint}
            onClick={() => setTool(t.id)}
            style={tool === t.id ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          >
            {t.label}
          </button>
        ))}

      <span style={{ width: 1, height: 22, background: 'var(--line)' }} />

      <button onClick={() => setView(view === '2D' ? '3D' : '2D')} title="Toggle the 3D review view">
        {view === '2D' ? '3D view' : '2D plan'}
      </button>

      {canEdit && (
        <>
          <button onClick={toggleSnap} title="Grid 0.25m, angle 15 degrees">
            Snap {snapEnabled ? 'on' : 'off'}
          </button>
          <button onClick={() => temporal.getState().undo()} disabled={temporal.getState().pastStates.length === 0}>
            Undo
          </button>
          <button onClick={() => temporal.getState().redo()} disabled={temporal.getState().futureStates.length === 0}>
            Redo
          </button>
        </>
      )}

      <span style={{ flex: 1 }} />

      {drawing && (
        <span style={{ color: 'var(--accent)', fontSize: 12 }}>
          {drawing.kind === 'POLYGON'
            ? `${drawing.points.length} point${drawing.points.length === 1 ? '' : 's'} — click the first to close, Esc to cancel`
            : 'click the opposite wall to finish the partition, Esc to cancel'}
        </span>
      )}

      <span style={{ color: 'var(--muted)', fontSize: 12 }}>
        {scene ? `${scene.status} rev ${scene.revision}` : 'no layout'}
        {dirty && <strong style={{ color: 'var(--accent)' }}> &middot; unsaved</strong>}
      </span>

      {!canEdit && <button onClick={onCreateDraft}>Edit layout</button>}
      {canEdit && (
        <>
          <button onClick={onValidate} disabled={busy !== null}>Validate</button>
          <button onClick={onSave} disabled={busy !== null || !dirty} title="Autosaves a few seconds after you stop editing">
            {busy === 'saving' ? 'Saving...' : dirty ? 'Save' : 'Saved'}
          </button>
          <button data-variant="primary" onClick={onPublish} disabled={busy !== null}>
            {busy === 'publishing' ? 'Publishing...' : 'Publish'}
          </button>
        </>
      )}
    </div>
  );
}
