'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/api/client';
import type { MeetingJson } from '@/api/types';
import { useEditorStore } from '@/state/editorStore';

const INVITE_COLOUR: Record<string, string> = {
  PENDING: 'var(--muted)',
  ACCEPTED: 'var(--ok)',
  DECLINED: 'var(--danger)',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Booking a whole table as a meeting.
 *
 * <p>Only shown to a manager, and only when a table is selected: the thing being booked
 * is the table, so asking the person to pick one from a dropdown when they are already
 * looking at the floor plan would be a worse way to say the same thing.
 */
export function MeetingSection({ canManage }: { canManage: boolean }) {
  const scene = useEditorStore((s) => s.scene);
  const selection = useEditorStore((s) => s.selection);
  const window_ = useEditorStore((s) => s.window);

  const [meetings, setMeetings] = useState<MeetingJson[]>([]);
  const [title, setTitle] = useState('Quarterly planning');
  const [agenda, setAgenda] = useState('');
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canManage) return;
    setMeetings(await api.myMeetings());
  }, [canManage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!canManage) return null;

  const table = selection?.type === 'furniture'
    ? scene?.furniture.find((f) => f.id === selection.id) ?? null
    : null;
  const seatCount = table ? scene?.seats.filter((s) => s.tableId === table.id).length ?? 0 : 0;

  const create = async () => {
    if (!table) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.createMeeting({
        tableId: table.id,
        title,
        agenda,
        startsAt: new Date(window_.from),
        endsAt: new Date(window_.to),
        // One per line or comma separated, because people paste both.
        inviteEmails: emails.split(/[\n,]/).map((e) => e.trim()).filter(Boolean),
      });
      setMessage('Table held and invitations queued.');
      setEmails('');
      await refresh();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { message?: string } | null) : null;
      setMessage(body?.message ?? 'Could not hold that table.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section>
        <h2 style={heading}>Book a whole table</h2>
        {!table && (
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
            Select a table on the plan to hold every seat on it for a meeting.
          </p>
        )}
        {table && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <strong>{table.label ?? 'Table'}</strong>
              <span style={{ color: 'var(--muted)' }}>{seatCount} seats</span>
            </div>
            <label htmlFor="mtitle">Title</label>
            <input id="mtitle" value={title} onChange={(e) => setTitle(e.target.value)} />
            <label htmlFor="magenda" style={{ marginTop: 8 }}>Agenda</label>
            <input id="magenda" value={agenda} onChange={(e) => setAgenda(e.target.value)} />
            <label htmlFor="memails" style={{ marginTop: 8 }}>Invite by email</label>
            <textarea
              id="memails"
              rows={3}
              value={emails}
              placeholder={'ana@example.com\nbo@example.com'}
              onChange={(e) => setEmails(e.target.value)}
              style={{
                width: '100%', font: 'inherit', color: 'inherit', background: 'var(--bg)',
                border: '1px solid var(--line)', borderRadius: 6, padding: '5px 8px', resize: 'vertical',
              }}
            />
            <p style={{ color: 'var(--muted)', fontSize: 11, margin: '6px 0 0' }}>
              Uses the time window above. Every seat is held together, so if one is already
              taken the whole booking is refused rather than half-held.
            </p>
            <button data-variant="primary" style={{ width: '100%', marginTop: 10 }} disabled={busy} onClick={create}>
              {busy ? 'Holding...' : `Hold all ${seatCount} seats`}
            </button>
          </>
        )}
        {message && <p style={{ fontSize: 12, marginTop: 8, color: 'var(--accent)' }}>{message}</p>}
      </section>

      <section>
        <h2 style={heading}>My meetings</h2>
        {meetings.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>No meetings yet.</p>
        )}
        {meetings.map((m) => (
          <div key={m.id} style={{ borderTop: '1px solid var(--line)', padding: '8px 0', fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{m.title}</strong>
              <span>{Number(m.totalCost).toFixed(2)}</span>
            </div>
            <div style={{ color: 'var(--muted)' }}>
              {m.roomName} &middot; {m.tableLabel} &middot; {m.seatCount} seats
            </div>
            <div style={{ color: 'var(--muted)' }}>
              {when(m.startsAt)} &ndash; {when(m.endsAt)}
            </div>
            {m.invites.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {m.invites.map((i) => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{i.email}</span>
                    <span style={{ color: INVITE_COLOUR[i.status] }}>{i.status.toLowerCase()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

const heading: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--muted)',
};
