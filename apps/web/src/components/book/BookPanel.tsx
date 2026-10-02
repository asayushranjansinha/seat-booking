'use client';

import { Armchair, CalendarDays, Loader2, MousePointerClick, Ticket, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/api/client';
import type { BookingJson, MeetingJson, SeatStatus } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useEditorStore, useSingleSelection } from '@/state/editorStore';
import { SeatLegend } from './SeatLegend';
import { TimeWindow } from './TimeWindow';

const STATUS_LABEL: Record<SeatStatus, string> = {
  FREE: 'Free',
  BOOKED: 'Taken by someone else',
  MINE: 'Booked by you',
  BLOCKED: 'Not bookable',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Three jobs behind three tabs.
 *
 * <p>Booking a seat, reviewing what you have booked, and holding a table for a meeting
 * are separate tasks that were previously stacked on one scrolling column, so every one
 * of them was surrounded by the other two.
 */
export function BookPanel({ floorId, canManage }: { floorId: string | null; canManage: boolean }) {
  const scene = useEditorStore((s) => s.scene);
  const selection = useSingleSelection();
  const occupancy = useEditorStore((s) => s.occupancy);
  const setOccupancy = useEditorStore((s) => s.setOccupancy);
  const window_ = useEditorStore((s) => s.window);

  const [bookings, setBookings] = useState<BookingJson[]>([]);
  const [meetings, setMeetings] = useState<MeetingJson[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('book');
  const setSelection = useEditorStore((s) => s.setSelection);

  const refresh = useCallback(async () => {
    if (!floorId) return;
    const [occ, mine] = await Promise.all([
      api.occupancy(floorId, new Date(window_.from), new Date(window_.to)),
      api.myBookings(),
    ]);
    setOccupancy(Object.fromEntries(occ.seats.map((s) => [s.seatId, s.status])));
    setBookings(mine);
    if (canManage) setMeetings(await api.myMeetings());
  }, [floorId, window_.from, window_.to, setOccupancy, canManage]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Live deltas: a seat someone else takes turns red without a reload.
  useEffect(() => {
    if (!floorId) return;
    return api.subscribeToOccupancy(floorId, () => void refresh());
  }, [floorId, refresh]);

  const seat = selection?.type === 'seat' ? scene?.seats.find((s) => s.id === selection.id) ?? null : null;
  const table = selection?.type === 'furniture' ? scene?.furniture.find((f) => f.id === selection.id) ?? null : null;
  const seatStatus: SeatStatus | null = seat ? occupancy[seat.id] ?? 'BLOCKED' : null;

  const tableSeats = table ? (scene?.seats.filter((s) => s.tableId === table.id) ?? []) : [];
  const freeOnTable = tableSeats
    .filter((s) => (occupancy[s.id] ?? 'BLOCKED') === 'FREE')
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const hours = Math.ceil((window_.to - window_.from) / 3_600_000);

  const book = async () => {
    if (!seat) return;
    setBusy(true);
    try {
      await api.book(seat.id, new Date(window_.from), new Date(window_.to));
      toast.success(`Seat ${seat.code} is yours`, { description: `${when(new Date(window_.from).toISOString())} for ${hours}h` });
      await refresh();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { message?: string } | null) : null;
      toast.error('Could not book that seat', { description: body?.message });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Which of my bookings makes this seat mine right now.
   *
   * <p>The canvas colours a seat MINE by comparing it against the window being viewed, so
   * the booking to cancel is the one that OVERLAPS that window — not merely one on the
   * same seat. Someone with a desk booked twice in a day would otherwise be shown a
   * cancel button for whichever happened to come back first.
   */
  const bookingHere = seat
    ? bookings.find((b) => b.seatId === seat.id
      && b.status === 'CONFIRMED'
      && new Date(b.startsAt).getTime() < window_.to
      && new Date(b.endsAt).getTime() > window_.from)
    : undefined;

  const cancel = async (b: BookingJson) => {
    setBusy(true);
    try {
      await api.cancelBooking(b.id);
      toast.success(`Booking for ${b.seatCode} cancelled`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col gap-0">
      <TabsList className="m-3 grid shrink-0 grid-cols-3">
        <TabsTrigger value="book"><Armchair className="size-3.5" />Book</TabsTrigger>
        <TabsTrigger value="mine">
          <Ticket className="size-3.5" />Mine
          {bookings.filter((b) => b.status === 'CONFIRMED').length > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {bookings.filter((b) => b.status === 'CONFIRMED').length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="meetings" disabled={!canManage}><Users className="size-3.5" />Meet</TabsTrigger>
      </TabsList>

      <TabsContent value="book" className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <TimeWindow />
        <SeatLegend />
        <Separator />

        {/*
          * Clicking a TABLE used to land here and be told to pick a seat, which is what
          * the person thought they had just done: at a zoom that fits a floor, a seat is
          * a four-pixel dot and a table is the thing under the pointer. So a table now
          * answers with the seats on it.
          */}
        {!seat && table && (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">{table.label ?? 'Table'}</span>
              <Badge variant="secondary">{tableSeats.length} seats</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {freeOnTable.length > 0
                ? 'Pick one of its free seats, or click the seat itself on the plan.'
                : 'Every seat on this table is taken for the window above.'}
            </p>
            {freeOnTable.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {freeOnTable.map((s) => (
                  <Button
                    key={s.id}
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 font-mono text-xs"
                    onClick={() => setSelection([{ type: 'seat', id: s.id }])}
                  >
                    {s.code}
                  </Button>
                ))}
              </div>
            )}
            {canManage && (
              <Button variant="secondary" className="w-full" onClick={() => setTab('meetings')}>
                <Users className="size-4" />
                Hold the whole table for a meeting
              </Button>
            )}
          </div>
        )}

        {!seat && !table && (
          <EmptyState
            icon={<MousePointerClick className="size-5" />}
            title="Pick a seat"
            body="Click any seat on the plan. Green ones are free for the window above."
          />
        )}

        {seat && seatStatus && (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">{seat.code}</span>
              <Badge variant={seatStatus === 'FREE' ? 'default' : 'secondary'}>
                {STATUS_LABEL[seatStatus]}
              </Badge>
            </div>
            {seat.hourlyRate != null && (
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">{hours}h at {seat.hourlyRate.toFixed(2)}/h</span>
                <span className="tabular text-base font-semibold">
                  {(seat.hourlyRate * hours).toFixed(2)}
                </span>
              </div>
            )}
            {seatStatus === 'MINE' && bookingHere ? (
              // Clicking your own seat used to reach a disabled button reading "Booked by
              // you" — true, and a dead end. Cancelling was only possible from the Mine
              // tab, which is not where you are when you have just clicked the seat.
              <>
                <p className="text-sm text-muted-foreground">
                  {when(bookingHere.startsAt)} – {when(bookingHere.endsAt)}
                </p>
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={busy}
                  onClick={() => cancel(bookingHere)}
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  Cancel this booking
                </Button>
              </>
            ) : (
              <Button className="w-full" disabled={busy || seatStatus !== 'FREE'} onClick={book}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {seatStatus === 'FREE' ? 'Book this seat' : STATUS_LABEL[seatStatus]}
              </Button>
            )}
          </div>
        )}
      </TabsContent>

      <TabsContent value="mine" className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {bookings.length === 0 && (
          <EmptyState
            icon={<Ticket className="size-5" />}
            title="Nothing booked yet"
            body="Seats you book will appear here, with a way to cancel them."
          />
        )}
        {bookings.map((b) => (
          <div
            key={b.id}
            className={`rounded-lg border p-3 ${b.status === 'CANCELLED' ? 'opacity-50' : 'bg-card'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{b.seatCode}</p>
                <p className="truncate text-xs text-muted-foreground">{b.roomName}</p>
              </div>
              <span className="tabular text-sm font-medium">{Number(b.cost).toFixed(2)}</span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {when(b.startsAt)} – {when(b.endsAt)}
            </p>
            {b.status === 'CONFIRMED' ? (
              <Button variant="outline" size="sm" className="mt-2 w-full" disabled={busy} onClick={() => cancel(b)}>
                Cancel
              </Button>
            ) : (
              <Badge variant="outline" className="mt-2">Cancelled</Badge>
            )}
          </div>
        ))}
      </TabsContent>

      <TabsContent value="meetings" className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <MeetingTab table={table} onCreated={refresh} meetings={meetings} />
      </TabsContent>
    </Tabs>
  );
}

function MeetingTab({
  table, meetings, onCreated,
}: {
  table: { id: string; label: string | null } | null;
  meetings: MeetingJson[];
  onCreated: () => Promise<void>;
}) {
  const scene = useEditorStore((s) => s.scene);
  const window_ = useEditorStore((s) => s.window);
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);

  const seatCount = table ? scene?.seats.filter((s) => s.tableId === table.id).length ?? 0 : 0;

  const create = async () => {
    if (!table || !title.trim()) return;
    setBusy(true);
    try {
      const meeting = await api.createMeeting({
        tableId: table.id,
        title: title.trim(),
        agenda,
        startsAt: new Date(window_.from),
        endsAt: new Date(window_.to),
        inviteEmails: emails.split(/[\n,]/).map((e) => e.trim()).filter(Boolean),
      });
      toast.success(`${meeting.seatCount} seats held`, {
        description: meeting.invites.length ? `${meeting.invites.length} invitations sent` : undefined,
      });
      setTitle(''); setAgenda(''); setEmails('');
      await onCreated();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { message?: string } | null) : null;
      toast.error('Could not hold that table', { description: body?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!table && (
        <EmptyState
          icon={<Users className="size-5" />}
          title="Pick a table"
          body="Click a table on the plan to hold every seat on it for a meeting."
        />
      )}

      {table && (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">{table.label ?? 'Table'}</span>
            <Badge variant="secondary">{seatCount} seats</Badge>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mtitle" className="text-xs text-muted-foreground">Title</Label>
            <Input id="mtitle" value={title} placeholder="Quarterly planning"
              onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="magenda" className="text-xs text-muted-foreground">Agenda (optional)</Label>
            <Input id="magenda" value={agenda} onChange={(e) => setAgenda(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="memails" className="text-xs text-muted-foreground">Invite by email</Label>
            <Textarea id="memails" rows={3} value={emails}
              placeholder={'ana@example.com\nbo@example.com'}
              onChange={(e) => setEmails(e.target.value)} />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Uses the time window from the Book tab. Every seat is held together, so if one is
            already taken the whole booking is refused rather than half-held.
          </p>
          <Button className="w-full" disabled={busy || !title.trim()} onClick={create}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Hold all {seatCount} seats
          </Button>
        </div>
      )}

      {meetings.length > 0 && <Separator />}

      {meetings.map((m) => (
        <div key={m.id} className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{m.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {m.roomName} · {m.tableLabel} · {m.seatCount} seats
              </p>
            </div>
            <span className="tabular text-sm font-medium">{Number(m.totalCost).toFixed(2)}</span>
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="size-3" />
            {when(m.startsAt)} – {when(m.endsAt)}
          </p>
          {m.invites.length > 0 && (
            <div className="mt-2 space-y-1">
              {m.invites.map((i) => (
                <div key={i.id} className="flex items-center justify-between text-xs">
                  <span className="truncate text-muted-foreground">{i.email}</span>
                  <Badge
                    variant={i.status === 'ACCEPTED' ? 'default' : i.status === 'DECLINED' ? 'destructive' : 'outline'}
                    className="h-4 px-1.5 text-[10px]"
                  >
                    {i.status.toLowerCase()}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-[240px] text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
