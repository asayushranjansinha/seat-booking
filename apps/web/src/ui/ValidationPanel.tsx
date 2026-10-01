'use client';

import { useEditorStore } from '@/state/editorStore';
import type { AffectedBookingJson } from '@/api/types';

export function ValidationPanel({ affected }: { affected: AffectedBookingJson[] }) {
  const violations = useEditorStore((s) => s.violations);
  const setSelection = useEditorStore((s) => s.setSelection);

  if (violations.length === 0 && affected.length === 0) return null;

  return (
    <div
      style={{
        borderTop: '1px solid var(--line)',
        background: 'var(--panel)',
        maxHeight: 220,
        overflowY: 'auto',
        padding: 12,
      }}
    >
      {affected.length > 0 && (
        <div style={{ marginBottom: violations.length ? 14 : 0 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--danger)' }}>
            Publishing is blocked: {affected.length} booking{affected.length === 1 ? '' : 's'} would be orphaned
          </h3>
          {affected.map((b) => (
            <div key={b.bookingId} style={{ fontSize: 12, padding: '3px 0', color: 'var(--text)' }}>
              Seat <strong>{b.seatCode}</strong> is booked by {b.userEmail} from{' '}
              {new Date(b.startsAt).toLocaleString()} to {new Date(b.endsAt).toLocaleTimeString()}
            </div>
          ))}
          <p style={{ color: 'var(--muted)', fontSize: 11, margin: '6px 0 0' }}>
            Keep these seat codes in the layout, or cancel the bookings first.
          </p>
        </div>
      )}

      {violations.length > 0 && (
        <>
          <h3 style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--danger)' }}>
            {violations.length} problem{violations.length === 1 ? '' : 's'} to fix
          </h3>
          {violations.map((v, i) => (
            <button
              key={`${v.code}-${v.entityId}-${i}`}
              onClick={() => {
                if (!v.entityId) return;
                const type = v.entityType === 'furniture' ? 'furniture' : v.entityType === 'seat' ? 'seat' : 'room';
                setSelection({ type, id: v.entityId } as never);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                marginBottom: 4,
                background: 'transparent',
                border: '1px solid transparent',
                padding: '4px 6px',
                fontSize: 12,
              }}
            >
              <span style={{ color: v.severity === 'ERROR' ? 'var(--danger)' : 'var(--ok)' }}>
                {v.severity === 'ERROR' ? '✖' : '⚠'}
              </span>{' '}
              {v.message}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
