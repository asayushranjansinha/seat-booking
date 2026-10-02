'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { InviteViewJson } from '@/api/types';

const STATUS_COPY: Record<InviteViewJson['status'], { label: string; colour: string }> = {
  PENDING: { label: 'Not answered yet', colour: 'var(--muted)' },
  ACCEPTED: { label: 'You accepted', colour: 'var(--ok)' },
  DECLINED: { label: 'You declined', colour: 'var(--danger)' },
};

/**
 * The page an invitee lands on from the email.
 *
 * <p>No sign-in: an invitee may have no account at all, and the token in the URL is the
 * credential. It grants nothing except seeing and answering this one invitation.
 */
export default function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ reply?: string }>;
}) {
  const { token } = use(params);
  const { reply } = use(searchParams);

  const [invite, setInvite] = useState<InviteViewJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const respond = useCallback(
    async (answer: 'accept' | 'decline') => {
      setBusy(true);
      try {
        setInvite(await api.respondToInvite(token, answer));
      } catch {
        setError('That invitation link is not valid.');
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  useEffect(() => {
    api
      .viewInvite(token)
      .then((loaded) => {
        setInvite(loaded);
        // The email's buttons carry the answer, so arriving from one replies straight
        // away rather than making the person click the same thing twice.
        if ((reply === 'accept' || reply === 'decline') && loaded.status === 'PENDING') {
          void respond(reply);
        }
      })
      .catch(() => setError('That invitation link is not valid.'));
  }, [token, reply, respond]);

  if (error) {
    return <Shell><p style={{ color: 'var(--danger)' }}>{error}</p></Shell>;
  }
  if (!invite) {
    return <Shell><p style={{ color: 'var(--muted)' }}>Loading...</p></Shell>;
  }

  const starts = new Date(invite.startsAt);
  const ends = new Date(invite.endsAt);

  return (
    <Shell>
      <p style={{ margin: '0 0 4px', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        Meeting invitation
      </p>
      <h1 style={{ margin: '0 0 16px', fontSize: 21 }}>{invite.meetingTitle}</h1>
      {invite.agenda && <p style={{ margin: '0 0 18px' }}>{invite.agenda}</p>}

      <Row label="When" value={`${starts.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} – ${ends.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`} />
      <Row label="Where" value={`${invite.roomName} · ${invite.tableLabel}`} />
      <Row label="Organiser" value={invite.organizerEmail} />
      <Row label="You" value={invite.yourEmail} />

      <p style={{ margin: '18px 0 10px', color: STATUS_COPY[invite.status].colour, fontWeight: 600 }}>
        {STATUS_COPY[invite.status].label}
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <button data-variant="primary" disabled={busy || invite.status === 'ACCEPTED'} onClick={() => respond('accept')}>
          Accept
        </button>
        <button disabled={busy || invite.status === 'DECLINED'} onClick={() => respond('decline')}>
          Decline
        </button>
      </div>
      <p style={{ marginTop: 18, fontSize: 12, color: 'var(--muted)' }}>
        You can change your answer at any time from this link.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <div style={{ width: 460, maxWidth: '100%', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 28 }}>
        {children}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '5px 0', fontSize: 14 }}>
      <span style={{ color: 'var(--muted)', width: 84 }}>{label}</span>
      <strong style={{ flex: 1 }}>{value}</strong>
    </div>
  );
}
