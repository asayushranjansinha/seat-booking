'use client';

import { useEditorStore } from '@/state/editorStore';

const metres = (n: number) => `${n.toFixed(2)} m`;

/**
 * The live numbers an admin needs while drawing.
 *
 * <p>Drawn as an HTML overlay rather than in the scene: text in a WebGL canvas either
 * scales with the zoom until it is unreadable, or needs a sprite pipeline to avoid it.
 * A plan tool needs its measurements legible at every zoom, so they live outside the GL.
 */
export function DimensionReadout() {
  const scene = useEditorStore((s) => s.scene);
  const selection = useEditorStore((s) => s.selection);
  const drawing = useEditorStore((s) => s.drawing);
  const cursor = useEditorStore((s) => s.cursor);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);

  if (!scene) return null;

  const rows: Array<[string, string]> = [];

  if (drawing?.kind === 'POLYGON') {
    const last = drawing.points[drawing.points.length - 1];
    rows.push(['Points', String(drawing.points.length)]);
    if (last && cursor) {
      rows.push(['Segment', metres(Math.hypot(cursor.x - last.x, cursor.y - last.y))]);
    }
    if (drawing.points.length >= 3 && cursor) {
      const first = drawing.points[0]!;
      rows.push(['To close', metres(Math.hypot(cursor.x - first.x, cursor.y - first.y))]);
    }
  } else if (drawing?.kind === 'PARTITION' && cursor) {
    rows.push(['Length', metres(Math.hypot(cursor.x - drawing.start.x, cursor.y - drawing.start.y))]);
  } else if (selection?.type === 'room') {
    const room = scene.rooms.find((r) => r.id === selection.id);
    if (room) {
      rows.push(['Room', room.name]);
      rows.push(...shapeRows(room.shape));
      rows.push(['Rotation', `${Math.round((room.transform.rot * 180) / Math.PI)}°`]);
    }
  } else if (selection?.type === 'furniture') {
    const table = scene.furniture.find((f) => f.id === selection.id);
    if (table) {
      rows.push(['Table', table.label ?? table.kind]);
      rows.push(...shapeRows(table.shape));
      rows.push(['Rotation', `${Math.round((table.transform.rot * 180) / Math.PI)}°`]);
      rows.push(['Seats', String(scene.seats.filter((s) => s.tableId === table.id).length)]);
    }
  } else if (selection?.type === 'seat') {
    const seat = scene.seats.find((s) => s.id === selection.id);
    if (seat) {
      rows.push(['Seat', seat.code]);
      rows.push(['Local', `${seat.localTransform.x.toFixed(2)}, ${seat.localTransform.y.toFixed(2)}`]);
      rows.push(['Pinned', seat.override ? 'yes' : 'no']);
    }
  }

  if (rows.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        background: 'rgba(22, 26, 33, 0.92)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        padding: '8px 10px',
        fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
        pointerEvents: 'none',
        minWidth: 150,
      }}
    >
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: 'var(--muted)' }}>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 11 }}>
        snap {snapEnabled ? '0.25 m · 15° · walls' : 'off'}
      </div>
    </div>
  );
}

function shapeRows(shape: { kind: string; [k: string]: unknown }): Array<[string, string]> {
  if (shape.kind === 'RECT') return [['Size', `${metres(shape.w as number)} × ${metres(shape.h as number)}`]];
  if (shape.kind === 'CIRCLE') return [['Radius', metres(shape.r as number)]];
  if (shape.kind === 'ELLIPSE') return [['Radii', `${metres(shape.rx as number)} × ${metres(shape.ry as number)}`]];
  if (shape.kind === 'POLYGON') return [['Outline', `${(shape.points as unknown[]).length} points`]];
  return [];
}
