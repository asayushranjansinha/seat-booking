'use client';

import { useEditorStore } from '@/state/editorStore';

const m = (n: number) => `${n.toFixed(2)} m`;

/**
 * Measurements, over the canvas.
 *
 * <p>Kept as HTML rather than drawn into the GL scene: text inside the canvas either
 * scales with the zoom until it is unreadable, or needs a sprite pipeline to stop it.
 */
export function StatusReadout() {
  const scene = useEditorStore((s) => s.scene);
  const selection = useEditorStore((s) => s.selection);
  const drawing = useEditorStore((s) => s.drawing);
  const cursor = useEditorStore((s) => s.cursor);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);

  if (!scene) return null;
  const rows: Array<[string, string]> = [];

  if (drawing?.kind === 'POLYGON') {
    const last = drawing.points[drawing.points.length - 1];
    rows.push(['Corners', String(drawing.points.length)]);
    if (last && cursor) rows.push(['Segment', m(Math.hypot(cursor.x - last.x, cursor.y - last.y))]);
    if (drawing.points.length >= 3 && cursor) {
      const first = drawing.points[0]!;
      rows.push(['To close', m(Math.hypot(cursor.x - first.x, cursor.y - first.y))]);
    }
  } else if (drawing?.kind === 'PARTITION' && cursor) {
    rows.push(['Length', m(Math.hypot(cursor.x - drawing.start.x, cursor.y - drawing.start.y))]);
  } else if (selection?.type === 'room') {
    const room = scene.rooms.find((r) => r.id === selection.id);
    if (room) rows.push(...shapeRows(room.shape));
  } else if (selection?.type === 'furniture') {
    const table = scene.furniture.find((f) => f.id === selection.id);
    if (table) rows.push(...shapeRows(table.shape));
  }

  if (rows.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border bg-popover/90 px-3 py-2 text-xs shadow-lg backdrop-blur">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-5">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular font-medium">{value}</span>
        </div>
      ))}
      <div className="mt-1 text-[10px] text-muted-foreground">
        {snapEnabled ? 'snapping to grid, angle and walls' : 'snapping off'}
      </div>
    </div>
  );
}

function shapeRows(shape: { kind: string; [k: string]: unknown }): Array<[string, string]> {
  if (shape.kind === 'RECT') return [['Size', `${m(shape.w as number)} × ${m(shape.h as number)}`]];
  if (shape.kind === 'CIRCLE') return [['Radius', m(shape.r as number)]];
  if (shape.kind === 'ELLIPSE') return [['Radii', `${m(shape.rx as number)} × ${m(shape.ry as number)}`]];
  if (shape.kind === 'POLYGON') return [['Outline', `${(shape.points as unknown[]).length} corners`]];
  return [];
}
