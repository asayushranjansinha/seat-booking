'use client';

import type { SeatStatus } from '@/api/types';
import { useEditorStore } from '@/state/editorStore';

const LEGEND: Array<{ status: SeatStatus; label: string; className: string }> = [
  { status: 'FREE', label: 'Free', className: 'bg-seat-free' },
  { status: 'MINE', label: 'Yours', className: 'bg-seat-mine' },
  { status: 'BOOKED', label: 'Taken', className: 'bg-seat-booked' },
  { status: 'BLOCKED', label: 'Not bookable', className: 'bg-seat-blocked' },
];

/** Counts beside the colours, so the legend also answers "how full is this floor". */
export function SeatLegend() {
  const occupancy = useEditorStore((s) => s.occupancy);
  const values = Object.values(occupancy);

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {LEGEND.map(({ status, label, className }) => (
        <div key={status} className="flex items-center gap-2 text-xs">
          <span className={`size-2.5 shrink-0 rounded-full ${className}`} />
          <span className="flex-1 text-muted-foreground">{label}</span>
          <span className="tabular font-medium">{values.filter((v) => v === status).length}</span>
        </div>
      ))}
    </div>
  );
}
