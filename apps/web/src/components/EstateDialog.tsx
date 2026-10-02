'use client';

import {
  Building2, Check, Layers, Loader2, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/api/client';
import type { BuildingSummaryJson, FloorSummaryJson } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

const reason = (e: unknown): string | undefined =>
  e instanceof ApiError ? ((e.body as { message?: string } | null)?.message ?? e.message) : undefined;

/**
 * Managing the estate: the buildings, and the floors in them.
 *
 * <p>A dialog rather than a page, because this is something an admin does once when
 * setting up and then rarely touches. Deleting is the part to be careful with, so a floor
 * that still holds bookings says so on its own row before anyone reaches for the bin.
 */
export function EstateDialog({
  open, onOpenChange, onChanged, currentFloorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (selectFloorId?: string) => void;
  currentFloorId: string | null;
}) {
  const [estate, setEstate] = useState<BuildingSummaryJson[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [addingBuilding, setAddingBuilding] = useState(false);
  const [newBuilding, setNewBuilding] = useState({ name: '', address: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEstate(await api.estate());
    } catch (e) {
      toast.error('Could not load the estate', { description: reason(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const run = async (key: string, work: () => Promise<void>, failure: string) => {
    setBusy(key);
    try {
      await work();
      await refresh();
      onChanged();
    } catch (e) {
      toast.error(failure, { description: reason(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Buildings and floors</DialogTitle>
          <DialogDescription>
            A floor is where a layout is drawn. Every seat and every booking belongs to one.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && estate.length === 0 && !addingBuilding && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center">
            <Building2 className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">No buildings yet</p>
            <p className="max-w-[280px] text-xs text-muted-foreground">
              Add one, then give it a floor. You draw the layout on the floor.
            </p>
          </div>
        )}

        {!loading &&
          estate.map((building) => (
            <BuildingRow
              key={building.id}
              building={building}
              busy={busy}
              currentFloorId={currentFloorId}
              onRun={run}
              onSelectFloor={(id) => { onChanged(id); onOpenChange(false); }}
            />
          ))}

        <Separator />

        {addingBuilding ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="bname" className="text-xs text-muted-foreground">Building name</Label>
              <Input id="bname" autoFocus placeholder="Riverside HQ" value={newBuilding.name}
                onChange={(e) => setNewBuilding({ ...newBuilding, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="baddr" className="text-xs text-muted-foreground">Address (optional)</Label>
              <Input id="baddr" placeholder="12 Wharf Road" value={newBuilding.address}
                onChange={(e) => setNewBuilding({ ...newBuilding, address: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!newBuilding.name.trim() || busy !== null}
                onClick={() =>
                  void run('new-building', async () => {
                    await api.createBuilding(newBuilding.name.trim(), newBuilding.address.trim());
                    setNewBuilding({ name: '', address: '' });
                    setAddingBuilding(false);
                  }, 'Could not add that building')
                }
              >
                <Check className="size-4" />Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAddingBuilding(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAddingBuilding(true)}>
            <Plus className="size-4" />Add a building
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BuildingRow({
  building, busy, currentFloorId, onRun, onSelectFloor,
}: {
  building: BuildingSummaryJson;
  busy: string | null;
  currentFloorId: string | null;
  onRun: (key: string, work: () => Promise<void>, failure: string) => Promise<void>;
  onSelectFloor: (floorId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: building.name, address: building.address ?? '' });
  const [addingFloor, setAddingFloor] = useState(false);
  // Suggest the next level up, which is what someone adding floors in order expects.
  const nextLevel = building.floors.length
    ? Math.max(...building.floors.map((f) => f.level)) + 1
    : 0;
  const [newFloor, setNewFloor] = useState({ name: '', level: nextLevel });

  return (
    <div className="space-y-2 rounded-lg border p-3">
      {editing ? (
        <div className="space-y-2">
          <Input value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input value={draft.address} placeholder="Address (optional)"
            onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
          <div className="flex gap-2">
            <Button size="sm" disabled={!draft.name.trim()}
              onClick={() => void onRun(`b-${building.id}`, async () => {
                await api.updateBuilding(building.id, draft.name.trim(), draft.address.trim());
                setEditing(false);
              }, 'Could not rename that building')}>
              <Check className="size-4" />Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="size-4" /></Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Building2 className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{building.name}</p>
            {building.address && <p className="truncate text-xs text-muted-foreground">{building.address}</p>}
          </div>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Rename building"
            onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
            aria-label="Delete building" disabled={busy !== null}
            onClick={() => void onRun(`bd-${building.id}`, () => api.deleteBuilding(building.id),
              'Could not delete that building')}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}

      <div className="space-y-1 pl-6">
        {building.floors.map((floor) => (
          <FloorRow
            key={floor.id}
            floor={floor}
            busy={busy}
            isCurrent={floor.id === currentFloorId}
            onRun={onRun}
            onSelect={() => onSelectFloor(floor.id)}
          />
        ))}

        {addingFloor ? (
          <div className="flex items-end gap-2 pt-1">
            <div className="flex-1 space-y-1">
              <Label htmlFor={`fn-${building.id}`} className="text-xs text-muted-foreground">Floor name</Label>
              <Input id={`fn-${building.id}`} autoFocus placeholder="Level 1" value={newFloor.name}
                onChange={(e) => setNewFloor({ ...newFloor, name: e.target.value })} />
            </div>
            <div className="w-20 space-y-1">
              <Label htmlFor={`fl-${building.id}`} className="text-xs text-muted-foreground">Level</Label>
              <Input id={`fl-${building.id}`} type="number" value={newFloor.level}
                onChange={(e) => setNewFloor({ ...newFloor, level: Number.parseInt(e.target.value, 10) || 0 })} />
            </div>
            <Button size="sm" disabled={!newFloor.name.trim()}
              onClick={() => void onRun(`nf-${building.id}`, async () => {
                await api.createFloor(building.id, newFloor.name.trim(), newFloor.level);
                setNewFloor({ name: '', level: newFloor.level + 1 });
                setAddingFloor(false);
              }, 'Could not add that floor')}>
              <Check className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAddingFloor(false)}><X className="size-4" /></Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
            onClick={() => { setNewFloor({ name: '', level: nextLevel }); setAddingFloor(true); }}>
            <Plus className="size-3.5" />Add a floor
          </Button>
        )}
      </div>
    </div>
  );
}

function FloorRow({
  floor, busy, isCurrent, onRun, onSelect,
}: {
  floor: FloorSummaryJson;
  busy: string | null;
  isCurrent: boolean;
  onRun: (key: string, work: () => Promise<void>, failure: string) => Promise<void>;
  onSelect: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: floor.name, level: floor.level });

  if (editing) {
    return (
      <div className="flex items-end gap-2 py-1">
        <div className="flex-1 space-y-1">
          <Input value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="w-20 space-y-1">
          <Input type="number" value={draft.level}
            onChange={(e) => setDraft({ ...draft, level: Number.parseInt(e.target.value, 10) || 0 })} />
        </div>
        <Button size="sm" disabled={!draft.name.trim()}
          onClick={() => void onRun(`f-${floor.id}`, async () => {
            await api.updateFloor(floor.id, draft.name.trim(), draft.level);
            setEditing(false);
          }, 'Could not rename that floor')}>
          <Check className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="size-4" /></Button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isCurrent ? 'bg-primary/10' : 'hover:bg-accent/50'}`}>
      <Layers className="size-3.5 shrink-0 text-muted-foreground" />
      <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <span className="text-sm">{floor.name}</span>
        <span className="ml-2 text-xs text-muted-foreground">level {floor.level}</span>
      </button>

      {floor.publishedVersionId ? (
        <span className="text-xs text-muted-foreground">{floor.seats} seats</span>
      ) : (
        <Badge variant="outline" className="h-5 text-[10px]">empty</Badge>
      )}
      {floor.draftVersionId && <Badge variant="secondary" className="h-5 text-[10px]">draft</Badge>}

      {/* Say it before they reach for the bin, not after the request is refused. */}
      {floor.liveBookings > 0 && (
        <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground">
          {floor.liveBookings} booked
        </Badge>
      )}

      <Button variant="ghost" size="icon" className="size-6" aria-label="Rename floor"
        onClick={() => setEditing(true)}>
        <Pencil className="size-3" />
      </Button>
      <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-destructive"
        aria-label="Delete floor" disabled={busy !== null}
        onClick={() => void onRun(`fd-${floor.id}`, () => api.deleteFloor(floor.id),
          'Could not delete that floor')}>
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}
