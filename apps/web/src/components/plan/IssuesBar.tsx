'use client';

import { AlertTriangle, CalendarClock, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { AffectedBookingJson } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useEditorStore } from '@/state/editorStore';

/**
 * Only present when there is something wrong, and collapsed to one line until opened.
 *
 * <p>A permanently visible empty panel teaches people to ignore the space it occupies,
 * which is the one place a real problem needs to be noticed.
 */
export function IssuesBar({ affected }: { affected: AffectedBookingJson[] }) {
  const violations = useEditorStore((s) => s.violations);
  const setSelection = useEditorStore((s) => s.setSelection);
  const [open, setOpen] = useState(true);

  const total = violations.length + affected.length;
  if (total === 0) return null;

  return (
    <div className="shrink-0 border-t bg-destructive/5">
      <button
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-destructive/10"
        onClick={() => setOpen((v) => !v)}
      >
        <AlertTriangle className="size-4 text-destructive" />
        <span className="font-medium">
          {total} thing{total === 1 ? '' : 's'} to fix before publishing
        </span>
        {open ? <ChevronDown className="ml-auto size-4" /> : <ChevronUp className="ml-auto size-4" />}
      </button>

      {open && (
        <div className="max-h-44 space-y-1 overflow-y-auto px-4 pb-3">
          {affected.map((b) => (
            <div key={b.bookingId} className="flex items-start gap-2 py-1 text-xs">
              <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <span>
                Seat <Badge variant="outline" className="mx-0.5 h-4 px-1">{b.seatCode}</Badge>
                is booked by {b.userEmail} from {new Date(b.startsAt).toLocaleString()}. Keep that seat
                code, or cancel the booking first.
              </span>
            </div>
          ))}

          {violations.map((v, i) => (
            <Button
              key={`${v.code}-${v.entityId}-${i}`}
              variant="ghost"
              size="sm"
              className="h-auto w-full justify-start gap-2 px-1 py-1 text-left text-xs font-normal"
              onClick={() => {
                if (!v.entityId) return;
                const type = v.entityType === 'furniture' ? 'furniture' : v.entityType === 'seat' ? 'seat' : 'room';
                setSelection({ type, id: v.entityId } as never);
              }}
            >
              <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
              <span className="flex-1">{v.message}</span>
              {v.entityId && <span className="text-muted-foreground">Show</span>}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
