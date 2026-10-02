'use client';

import { Calendar, CalendarCheck2, CalendarX2, Clock, MapPin, User } from 'lucide-react';
import { use, useCallback, useEffect, useState } from 'react';
import type { InviteViewJson } from '@/api/types';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

const STATUS: Record<InviteViewJson['status'], { label: string; variant: 'secondary' | 'default' | 'destructive' }> = {
  PENDING: { label: 'Not answered yet', variant: 'secondary' },
  ACCEPTED: { label: 'You accepted', variant: 'default' },
  DECLINED: { label: 'You declined', variant: 'destructive' },
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
        // The buttons in the email carry the answer, so arriving from one replies
        // straight away rather than making the person click the same thing twice.
        if ((reply === 'accept' || reply === 'decline') && loaded.status === 'PENDING') {
          void respond(reply);
        }
      })
      .catch(() => setError('That invitation link is not valid.'));
  }, [token, reply, respond]);

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-destructive">{error}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask the organiser to send the invitation again.
        </p>
      </Shell>
    );
  }
  if (!invite) {
    return <Shell><p className="text-sm text-muted-foreground">Loading...</p></Shell>;
  }

  const starts = new Date(invite.startsAt);
  const ends = new Date(invite.endsAt);
  const status = STATUS[invite.status];

  return (
    <Shell>
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Meeting invitation
        </p>
        <h1 className="text-xl font-semibold">{invite.meetingTitle}</h1>
        {invite.agenda && <p className="text-sm text-muted-foreground">{invite.agenda}</p>}
      </div>

      <Separator className="my-5" />

      <dl className="space-y-3 text-sm">
        <Row icon={<Clock className="size-4" />} label="When">
          {starts.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          {', '}
          {starts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} –{' '}
          {ends.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </Row>
        <Row icon={<MapPin className="size-4" />} label="Where">
          {invite.roomName} · {invite.tableLabel}
        </Row>
        <Row icon={<User className="size-4" />} label="Organiser">{invite.organizerEmail}</Row>
        <Row icon={<Calendar className="size-4" />} label="You">{invite.yourEmail}</Row>
      </dl>

      <Separator className="my-5" />

      <div className="flex items-center justify-between gap-3">
        <Badge variant={status.variant}>{status.label}</Badge>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || invite.status === 'ACCEPTED'} onClick={() => respond('accept')}>
            <CalendarCheck2 className="size-4" />
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={busy || invite.status === 'DECLINED'}
            onClick={() => respond('decline')}>
            <CalendarX2 className="size-4" />
            Decline
          </Button>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        You can change your answer at any time from this link.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">{children}</div>
    </main>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="font-medium">{children}</dd>
      </div>
    </div>
  );
}
