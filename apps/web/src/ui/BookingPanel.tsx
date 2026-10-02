'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/api/client';
import type { BookingJson, SeatStatus } from '@/api/types';
import { useEditorStore } from '@/state/editorStore';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The plan allows booking up to 6 days ahead, so the scrubber covers exactly that. */
const MAX_ADVANCE_DAYS = 6;
const MAX_DURATION_HOURS = 6;

const STATUS_COPY: Record<SeatStatus, { label: string; colour: string }> = {
  FREE: { label: 'Free', colour: '#3ddc97' },
  BOOKED: { label: 'Booked', colour: '#c45a6b' },
  MINE: { label: 'Yours', colour: '#4c9aff' },
  BLOCKED: { label: 'Not bookable', colour: '#5a6578' },
};

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });

export function BookingPanel({ floorId }: { floorId: string | null }) {
  const scene = useEditorStore((s) => s.scene);
  const selection = useEditorStore((s) => s.selection);
  const occupancy = useEditorStore((s) => s.occupancy);
  const setOccupancy = useEditorStore((s) => s.setOccupancy);
  const window_ = useEditorStore((s) => s.window);
  const setWindow = useEditorStore((s) => s.setWindow);

  const [bookings, setBookings] = useState<BookingJson[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!floorId) return;
    const [occ, mine] = await Promise.all([
      api.occupancy(floorId, new Date(window_.from), new Date(window_.to)),
      api.myBookings(),
    ]);
    setOccupancy(Object.fromEntries(occ.seats.map((s) => [s.seatId, s.status])));
    setBookings(mine);
  }, [floorId, window_.from, window_.to, setOccupancy]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live deltas, so a seat someone else takes turns red without a reload. The event says
  // only that something changed; the authenticated endpoint says what.
  useEffect(() => {
    if (!floorId) return;
    return api.subscribeToOccupancy(floorId, () => void refresh());
  }, [floorId, refresh]);

  const seat = selection?.type === 'seat'
    ? scene?.seats.find((s) => s.id === selection.id) ?? null
    : null;
  const seatStatus = seat ? occupancy[seat.id] ?? 'BLOCKED' : null;

  const durationHours = (window_.to - window_.from) / HOUR;

  const book = async () => {
    if (!seat) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.book(seat.id, new Date(window_.from), new Date(window_.to));
      setMessage(`Seat ${seat.code} booked.`);
      await refresh();
    } catch (e) {
      // The API's refusals are specific, so show its message rather than inventing one.
      setMessage(e instanceof ApiError ? describeError(e) : 'Could not book that seat.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await api.cancelBooking(id);
      await refresh();
      setMessage('Booking cancelled.');
    } finally {
      setBusy(false);
    }
  };

  const startOffsetHours = Math.round((window_.from - startOfToday()) / HOUR);

  return (
    <div style={{ padding: 14, display: 'grid', gap: 16 }}>
      <section>
        <h2 style={heading}>When</h2>
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          <strong>{when(window_.from)}</strong>
          <span style={{ color: 'var(--muted)' }}> to </span>
          <strong>{when(window_.to)}</strong>
        </div>

        <label htmlFor="start">Start</label>
        <input
          id="start"
          type="range"
          min={0}
          max={MAX_ADVANCE_DAYS * 24}
          step={1}
          value={startOffsetHours}
          onChange={(e) => {
            const from = startOfToday() + Number(e.target.value) * HOUR;
            setWindow({ from, to: from + durationHours * HOUR });
          }}
        />

        <label htmlFor="duration" style={{ marginTop: 8 }}>
          Duration — {durationHours} hour{durationHours === 1 ? '' : 's'}
        </label>
        <input
          id="duration"
          type="range"
          min={1}
          max={MAX_DURATION_HOURS}
          step={1}
          value={durationHours}
          onChange={(e) => setWindow({ from: window_.from, to: window_.from + Number(e.target.value) * HOUR })}
        />
        <p style={{ color: 'var(--muted)', fontSize: 11, margin: '6px 0 0' }}>
          Up to {MAX_ADVANCE_DAYS} days ahead, {MAX_DURATION_HOURS} hours at a time. Seat colour
          is for this window only.
        </p>
      </section>

      <section>
        <h2 style={heading}>Seats in this window</h2>
        {(['FREE', 'MINE', 'BOOKED', 'BLOCKED'] as SeatStatus[]).map((status) => {
          const count = Object.values(occupancy).filter((s) => s === status).length;
          return (
            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '2px 0' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS_COPY[status].colour }} />
              <span style={{ color: 'var(--muted)', flex: 1 }}>{STATUS_COPY[status].label}</span>
              <strong>{count}</strong>
            </div>
          );
        })}
      </section>

      <section>
        <h2 style={heading}>Selected seat</h2>
        {!seat && <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Click a seat on the plan.</p>}
        {seat && seatStatus && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <strong>{seat.code}</strong>
              <span style={{ color: STATUS_COPY[seatStatus].colour }}>{STATUS_COPY[seatStatus].label}</span>
            </div>
            {seat.hourlyRate != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                <span>Estimated cost</span>
                <strong style={{ color: 'var(--text)' }}>
                  {(seat.hourlyRate * Math.ceil(durationHours)).toFixed(2)}
                </strong>
              </div>
            )}
            <button
              data-variant="primary"
              style={{ width: '100%', marginTop: 10 }}
              disabled={busy || seatStatus !== 'FREE'}
              onClick={book}
            >
              {seatStatus === 'FREE' ? 'Book this seat' : `Not available (${STATUS_COPY[seatStatus].label})`}
            </button>
          </>
        )}
        {message && <p style={{ fontSize: 12, marginTop: 8, color: 'var(--accent)' }}>{message}</p>}
      </section>

      <section>
        <h2 style={heading}>My bookings</h2>
        {bookings.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Nothing booked yet.</p>
        )}
        {bookings.map((b) => (
          <div
            key={b.id}
            style={{
              borderTop: '1px solid var(--line)',
              padding: '8px 0',
              fontSize: 12,
              opacity: b.status === 'CANCELLED' ? 0.45 : 1,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>
                {b.seatCode}
                {b.roomName && <span style={{ color: 'var(--muted)' }}> · {b.roomName}</span>}
              </strong>
              <span>{Number(b.cost).toFixed(2)}</span>
            </div>
            <div style={{ color: 'var(--muted)' }}>
              {when(new Date(b.startsAt).getTime())} – {when(new Date(b.endsAt).getTime())}
            </div>
            {b.status === 'CONFIRMED' ? (
              <button style={{ marginTop: 4, padding: '2px 8px' }} disabled={busy} onClick={() => cancel(b.id)}>
                Cancel
              </button>
            ) : (
              <span style={{ color: 'var(--muted)' }}>Cancelled</span>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function describeError(e: ApiError): string {
  const body = e.body as { message?: string } | null;
  return body?.message ?? 'Could not book that seat.';
}

const heading: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--muted)',
};
