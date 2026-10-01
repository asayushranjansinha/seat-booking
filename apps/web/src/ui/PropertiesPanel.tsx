'use client';

import { useEditorStore } from '@/state/editorStore';
import type { PlacementJson, ShapeJson } from '@/api/types';

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 10 }}>
    <label>{label}</label>
    {children}
  </div>
);

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{children}</div>
);

const number = (v: string, fallback: number): number => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export function PropertiesPanel() {
  const scene = useEditorStore((s) => s.scene);
  const selection = useEditorStore((s) => s.selection);
  const canEdit = scene?.status === 'DRAFT';

  const resizeShape = useEditorStore((s) => s.resizeShape);
  const rotateEntity = useEditorStore((s) => s.rotateEntity);
  const renameRoom = useEditorStore((s) => s.renameRoom);
  const setTableRule = useEditorStore((s) => s.setTableRule);
  const clearSeatOverride = useEditorStore((s) => s.clearSeatOverride);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);

  if (!scene) return null;

  if (!selection) {
    return (
      <Panel title="Layout">
        <Stat label="Rooms" value={scene.rooms.length} />
        <Stat label="Tables" value={scene.furniture.length} />
        <Stat label="Seats" value={scene.seats.length} />
        <Stat label="Pinned seats" value={scene.seats.filter((s) => s.override).length} />
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 14 }}>
          Select a room, table or seat to edit it. Resize a table and its seats redistribute in
          proportion; drag one seat and it pins while the rest redistribute around it.
        </p>
      </Panel>
    );
  }

  if (selection.type === 'room') {
    const room = scene.rooms.find((r) => r.id === selection.id);
    if (!room) return null;
    return (
      <Panel title="Room" onDelete={canEdit ? deleteSelected : undefined}>
        <Field label="Name">
          <input
            value={room.name}
            disabled={!canEdit}
            onChange={(e) => renameRoom(room.id, e.target.value)}
          />
        </Field>
        <ShapeEditor
          shape={room.shape}
          disabled={!canEdit}
          onChange={(shape) => resizeShape(selection, shape)}
        />
        <Field label="Rotation (degrees)">
          <input
            type="number"
            disabled={!canEdit}
            value={Math.round((room.transform.rot * 180) / Math.PI)}
            onChange={(e) => rotateEntity(selection, (number(e.target.value, 0) * Math.PI) / 180)}
          />
        </Field>
        <Stat label="Gates" value={room.gates.length} />
        <Stat label="Partitions" value={room.partitions.length} />
      </Panel>
    );
  }

  if (selection.type === 'furniture') {
    const table = scene.furniture.find((f) => f.id === selection.id);
    if (!table) return null;
    const seats = scene.seats.filter((s) => s.tableId === table.id);
    const placement = seats[0]?.placement ?? null;

    return (
      <Panel title="Table" onDelete={canEdit ? deleteSelected : undefined}>
        <Field label="Label">
          <input value={table.label ?? ''} disabled readOnly />
        </Field>
        <ShapeEditor
          shape={table.shape}
          disabled={!canEdit}
          onChange={(shape) => resizeShape(selection, shape)}
        />
        <Field label="Rotation (degrees)">
          <input
            type="number"
            disabled={!canEdit}
            value={Math.round((table.transform.rot * 180) / Math.PI)}
            onChange={(e) => rotateEntity(selection, (number(e.target.value, 0) * Math.PI) / 180)}
          />
        </Field>

        {placement && (
          <SeatRuleEditor
            placement={placement}
            disabled={!canEdit}
            onChange={(next) => setTableRule(table.id, next)}
          />
        )}

        <Stat label="Seats" value={seats.length} />
        <Stat label="Pinned" value={seats.filter((s) => s.override).length} />
        <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 10 }}>
          Changing the size or the rule re-runs the placement engine. Seats you have dragged keep
          their position and the rest redistribute around them.
        </p>
      </Panel>
    );
  }

  const seat = scene.seats.find((s) => s.id === selection.id);
  if (!seat) return null;
  return (
    <Panel title={`Seat ${seat.code}`} onDelete={canEdit ? deleteSelected : undefined}>
      <Row>
        <Field label="Local X (m)">
          <input value={seat.localTransform.x.toFixed(3)} disabled readOnly />
        </Field>
        <Field label="Local Y (m)">
          <input value={seat.localTransform.y.toFixed(3)} disabled readOnly />
        </Field>
      </Row>
      <Field label="Facing (degrees)">
        <input value={Math.round((seat.localTransform.rot * 180) / Math.PI)} disabled readOnly />
      </Field>
      <Stat label="Index" value={seat.seatIndex} />
      <Stat label="Pinned" value={seat.override ? 'yes' : 'no'} />
      {seat.override && canEdit && (
        <button style={{ width: '100%', marginTop: 8 }} onClick={() => clearSeatOverride(seat.id)}>
          Unpin and let the rule place it
        </button>
      )}
      <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 10 }}>
        Position is stored relative to the table, not the floor. That is why rotating the table
        carries this seat without changing anything stored here.
      </p>
    </Panel>
  );
}

function ShapeEditor({
  shape,
  disabled,
  onChange,
}: {
  shape: ShapeJson;
  disabled: boolean;
  onChange: (shape: ShapeJson) => void;
}) {
  if (shape.kind === 'RECT') {
    return (
      <Row>
        <Field label="Width (m)">
          <input
            type="number"
            step="0.1"
            disabled={disabled}
            value={shape.w}
            onChange={(e) => onChange({ ...shape, w: Math.max(0.1, number(e.target.value, shape.w)) })}
          />
        </Field>
        <Field label="Depth (m)">
          <input
            type="number"
            step="0.1"
            disabled={disabled}
            value={shape.h}
            onChange={(e) => onChange({ ...shape, h: Math.max(0.1, number(e.target.value, shape.h)) })}
          />
        </Field>
      </Row>
    );
  }
  if (shape.kind === 'CIRCLE') {
    return (
      <Field label="Radius (m)">
        <input
          type="number"
          step="0.1"
          disabled={disabled}
          value={shape.r}
          onChange={(e) => onChange({ ...shape, r: Math.max(0.1, number(e.target.value, shape.r)) })}
        />
      </Field>
    );
  }
  if (shape.kind === 'ELLIPSE') {
    return (
      <Row>
        <Field label="Radius X (m)">
          <input
            type="number"
            step="0.1"
            disabled={disabled}
            value={shape.rx}
            onChange={(e) => onChange({ ...shape, rx: Math.max(0.1, number(e.target.value, shape.rx)) })}
          />
        </Field>
        <Field label="Radius Y (m)">
          <input
            type="number"
            step="0.1"
            disabled={disabled}
            value={shape.ry}
            onChange={(e) => onChange({ ...shape, ry: Math.max(0.1, number(e.target.value, shape.ry)) })}
          />
        </Field>
      </Row>
    );
  }
  return (
    <Field label="Outline">
      <input value={`polygon, ${shape.points.length} points`} disabled readOnly />
    </Field>
  );
}

function SeatRuleEditor({
  placement,
  disabled,
  onChange,
}: {
  placement: PlacementJson;
  disabled: boolean;
  onChange: (placement: PlacementJson) => void;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
      <Field label="Seat rule">
        <select
          disabled={disabled}
          value={placement.kind}
          onChange={(e) => {
            const kind = e.target.value as PlacementJson['kind'];
            const clearance = placement.kind === 'MANUAL' ? 0.45 : placement.clearance;
            if (kind === 'PERIMETER_EVEN') onChange({ kind, count: 8, startOffset: 0, clearance });
            else if (kind === 'RADIAL') onChange({ kind, count: 6, startAngle: 0, clearance });
            else if (kind === 'EDGE_COUNTS')
              onChange({ kind, counts: { top: 3, bottom: 3, left: 1, right: 1 }, clearance });
            else onChange({ kind: 'MANUAL' });
          }}
        >
          <option value="PERIMETER_EVEN">Even around the perimeter</option>
          <option value="EDGE_COUNTS">Per-side counts</option>
          <option value="RADIAL">Radial (round tables)</option>
          <option value="MANUAL">Manual</option>
        </select>
      </Field>

      {(placement.kind === 'PERIMETER_EVEN' || placement.kind === 'RADIAL') && (
        <Row>
          <Field label="Seats">
            <input
              type="number"
              min={1}
              max={48}
              disabled={disabled}
              value={placement.count}
              onChange={(e) =>
                onChange({ ...placement, count: Math.max(1, Math.round(number(e.target.value, placement.count))) })
              }
            />
          </Field>
          <Field label="Clearance (m)">
            <input
              type="number"
              step="0.05"
              disabled={disabled}
              value={placement.clearance}
              onChange={(e) => onChange({ ...placement, clearance: Math.max(0, number(e.target.value, placement.clearance)) })}
            />
          </Field>
        </Row>
      )}

      {placement.kind === 'EDGE_COUNTS' && (
        <>
          <Row>
            {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
              <Field key={side} label={side[0]!.toUpperCase() + side.slice(1)}>
                <input
                  type="number"
                  min={0}
                  disabled={disabled}
                  value={placement.counts[side] ?? 0}
                  onChange={(e) =>
                    onChange({
                      ...placement,
                      counts: { ...placement.counts, [side]: Math.max(0, Math.round(number(e.target.value, 0))) },
                    })
                  }
                />
              </Field>
            ))}
          </Row>
          <Field label="Clearance (m)">
            <input
              type="number"
              step="0.05"
              disabled={disabled}
              value={placement.clearance}
              onChange={(e) => onChange({ ...placement, clearance: Math.max(0, number(e.target.value, placement.clearance)) })}
            />
          </Field>
        </>
      )}
    </div>
  );
}

function Panel({
  title,
  children,
  onDelete,
}: {
  title: string;
  children: React.ReactNode;
  onDelete?: () => void;
}) {
  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--muted)' }}>
          {title}
        </h2>
        <span style={{ flex: 1 }} />
        {onDelete && (
          <button onClick={onDelete} style={{ color: 'var(--danger)', padding: '2px 8px' }}>
            Delete
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
