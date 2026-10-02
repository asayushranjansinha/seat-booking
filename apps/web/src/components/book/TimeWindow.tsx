'use client';

import { Clock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useEditorStore } from '@/state/editorStore';

const HOUR = 3_600_000;
const MAX_ADVANCE_DAYS = 6;
const MAX_DURATION_HOURS = 6;

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const dayLabel = (ms: number) => {
  const days = Math.floor((ms - startOfToday()) / (24 * HOUR));
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'long' });
};

const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * The primary control in booking, so it reads as a statement rather than two sliders.
 *
 * <p>A seat is only free or taken relative to a window, and the old panel buried that
 * behind "Start" and "Duration" labels with the resulting time printed small above them.
 */
export function TimeWindow() {
  const window_ = useEditorStore((s) => s.window);
  const setWindow = useEditorStore((s) => s.setWindow);

  const durationHours = Math.round((window_.to - window_.from) / HOUR);
  const startOffsetHours = Math.round((window_.from - startOfToday()) / HOUR);

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-2.5">
        <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {dayLabel(window_.from)}, {timeLabel(window_.from)} – {timeLabel(window_.to)}
          </p>
          <p className="text-xs text-muted-foreground">
            {durationHours} hour{durationHours === 1 ? '' : 's'} · seat colours below are for this window
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">When</Label>
          <Slider
            min={0}
            max={MAX_ADVANCE_DAYS * 24}
            step={1}
            value={[startOffsetHours]}
            onValueChange={([hours]) => {
              const from = startOfToday() + (hours ?? 0) * HOUR;
              setWindow({ from, to: from + durationHours * HOUR });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">For how long</Label>
          <Slider
            min={1}
            max={MAX_DURATION_HOURS}
            step={1}
            value={[durationHours]}
            onValueChange={([hours]) => setWindow({ from: window_.from, to: window_.from + (hours ?? 1) * HOUR })}
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Up to {MAX_ADVANCE_DAYS} days ahead, {MAX_DURATION_HOURS} hours at a time.
      </p>
    </div>
  );
}
