'use client';

import {
  AlignHorizontalDistributeCenter, AlignVerticalSpaceAround, Armchair, Building2, Frame,
  Columns3, Copy, DoorOpen, Grid3x3, Group, Info, LayoutGrid, Loader2,
  PencilRuler, Pin, Rows3, SplitSquareVertical,
  PinOff, Table2, Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { PlacementJson, ShapeJson } from '@/api/types';
import { cellsForGrid, partitionsForGrid } from '@/editor/divide';
import { ruleSuitsShape, whyRuleCannotApply } from '@/editor/placementRules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { useEditorStore, useSingleSelection } from '@/state/editorStore';

const num = (v: string, fallback: number) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Shows one thing at a time.
 *
 * <p>The old panel rendered every field for every selection, so a person wanting to
 * change a seat count read past a name, two dimensions and a rotation first. Each
 * selection now gets only its own controls, under a heading that says what is selected.
 */
export function InspectorPanel({
  noLayout, noEstate, canStart, onStart, onAddBuilding, starting, copySources,
}: {
  noLayout: boolean;
  noEstate: boolean;
  canStart: boolean;
  /** Starts a draft. With a floor id, copies that floor's layout into it instead. */
  onStart: (fromFloorId?: string) => void;
  onAddBuilding: () => void;
  starting: boolean;
  /** Other floors that have been drawn, and so have something worth copying. */
  copySources: Array<{ id: string; label: string }>;
}) {
  const scene = useEditorStore((s) => s.scene);
  const selection = useSingleSelection();
  const selectedCount = useEditorStore((s) => s.selection.length);
  const canEdit = scene?.status === 'DRAFT';

  // The very first screen anyone sees on a fresh install, and the one that was blank:
  // no building means no floor, so there is no layout to be empty and the empty-floor
  // panel never ran. An admin was left with a grid, a disabled toolbar and no sentence
  // anywhere telling them a building comes first.
  if (noEstate) return <NoEstate canStart={canStart} onAdd={onAddBuilding} />;

  // A floor with nothing on it is a normal state, not an error. Rendering nothing here
  // leaves an admin staring at an empty grid with no way to begin.
  if (!scene && noLayout) {
    return (
      <EmptyFloor
        canStart={canStart}
        onStart={onStart}
        starting={starting}
        copySources={copySources}
      />
    );
  }
  if (!scene) return null;
  // Several things at once: there is no single width to type, so the panel reports what
  // is held and offers the operations that do make sense for a group.
  if (selectedCount > 1) return <GroupSelection canEdit={canEdit} />;
  if (!selection) return <Overview />;
  if (selection.type === 'room') return <RoomInspector canEdit={canEdit} />;
  if (selection.type === 'furniture') return <TableInspector canEdit={canEdit} />;
  if (selection.type === 'partition') return <PartitionInspector canEdit={canEdit} />;
  if (selection.type === 'gate') return <GateInspector canEdit={canEdit} />;
  return <SeatInspector canEdit={canEdit} />;
}

function Shell({
  icon, title, subtitle, onDelete, locked, children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onDelete?: () => void;
  locked?: boolean;
  children: React.ReactNode;
}) {
  const view = useEditorStore((s) => s.view);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="Delete"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {!locked && view === '3D' && (
          // 3D renders the same scene and selects from it, so the only thing that tells
          // you editing is half off is that nothing moves when you drag. Say it instead.
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            3D is for reviewing. Dragging is off here — switch to{' '}
            <span className="font-medium text-foreground">2D</span> to move things, or type
            a position below.
          </p>
        )}
        {locked && (
          // Without this the fields are simply greyed out, which reads as "broken" rather
          // than "published". The canvas refuses to drag for the same reason, and that
          // refusal is silent, so the explanation has to be somewhere.
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            This layout is published and cannot be changed. Choose{' '}
            <span className="font-medium text-foreground">Edit layout</span> to start a
            draft — nobody sees a draft until you publish it.
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular font-medium">{value}</span>
    </div>
  );
}

function NoEstate({ canStart, onAdd }: { canStart: boolean; onAdd: () => void }) {
  return (
    <Shell icon={<Building2 className="size-4" />} title="No buildings yet" subtitle="Nothing to plan or book">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {canStart
          ? 'A seat lives on a floor, and a floor lives in a building — so a building is the first thing to make.'
          : 'Nobody has added a building yet. An admin needs to create one before there is anything to book.'}
      </p>

      {canStart && (
        <>
          <Button className="w-full" onClick={onAdd}>
            <Building2 className="size-4" />
            Add a building
          </Button>

          <Separator />

          <ol className="space-y-2.5 text-sm text-muted-foreground">
            {[
              'Add a building and give it an address',
              'Add a floor to it — Ground, Level 1, and so on',
              'Draw the rooms, then drop tables in them',
              'Publish, and the floor becomes bookable',
            ].map((step, i) => (
              <li key={step} className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground">
                  {i + 1}
                </span>
                <span className="leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Shell>
  );
}

/**
 * What is on screen when several things are held at once.
 *
 * <p>No width, no rotation, no rate: none of them have one answer for a group, and a box
 * showing the first one's value would be a lie the moment it was typed into. What a group
 * can do is move, duplicate and be deleted, so that is what it says.
 */
function GroupSelection({ canEdit }: { canEdit: boolean }) {
  const selection = useEditorStore((s) => s.selection);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const spaceEvenly = useEditorStore((s) => s.spaceSelectionEvenly);
  const align = useEditorStore((s) => s.alignSelection);
  // Only things with a position of their own can be spaced: a seat's belongs to its
  // table's rule, a partition is anchored to two walls, a door lives on one. Counting
  // them would offer to space a selection that nothing in it can move.
  const tables = selection.filter(
    (x) => x.type === 'room' || x.type === 'furniture',
  ).length;

  const count = (type: string) => selection.filter((x) => x.type === type).length;
  const parts = [
    [count('room'), 'room', 'rooms'],
    [count('furniture'), 'table', 'tables'],
    [count('seat'), 'seat', 'seats'],
    [count('partition'), 'partition', 'partitions'],
    [count('gate'), 'door', 'doors'],
  ] as const;

  return (
    <Shell
      icon={<Group className="size-4" />}
      title={`${selection.length} selected`}
      subtitle={parts
        .filter(([n]) => n > 0)
        .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
        .join(' · ')}
      locked={!canEdit}
      onDelete={canEdit ? deleteSelected : undefined}
    >
      <div className="space-y-2">
        <Button variant="outline" className="w-full justify-start" disabled={!canEdit || tables < 2}
          onClick={() => {
            const moved = spaceEvenly();
            toast[moved ? 'success' : 'info'](
              moved ? 'Spaced evenly' : 'Already evenly spaced',
              {
                description: moved
                  ? 'Every gap the same, including the floor against each wall.'
                  : 'These are already evenly spaced in the room.',
              },
            );
          }}>
          <AlignHorizontalDistributeCenter className="size-4" />
          Space evenly
        </Button>
        <Button variant="outline" className="w-full justify-start" disabled={!canEdit || tables < 2}
          onClick={() => {
            const moved = align();
            toast[moved ? 'success' : 'info'](moved ? 'Lined up' : 'Already in line', {
              description: moved
                ? 'Centred on the middle of the selection, so it stayed where it was.'
                : 'These are already on one line.',
            });
          }}>
          <AlignVerticalSpaceAround className="size-4" />
          Line up
        </Button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Spacing divides the floor this row sits on — the partition if there is one —
          leaving the same gap against each wall as between the tables.
        </p>
      </div>

      <Separator />

      <ul className="space-y-2.5 text-sm text-muted-foreground">
        <li>Drag any one of them and the whole group moves together.</li>
        <li>Arrow keys nudge the group by one grid square, Shift by four.</li>
        <li><span className="font-medium text-foreground">⌘C</span> then{' '}
          <span className="font-medium text-foreground">⌘V</span> duplicates all of
          it, keeping the spacing between them.</li>
      </ul>

      <Separator />

      <p className="text-xs leading-relaxed text-muted-foreground">
        Shift-click to add or remove one. The sweep tool in the rail drags a box over
        several at once.
      </p>
    </Shell>
  );
}

function EmptyFloor({
  canStart, onStart, starting, copySources,
}: {
  canStart: boolean;
  onStart: (fromFloorId?: string) => void;
  starting: boolean;
  copySources: Array<{ id: string; label: string }>;
}) {
  const [from, setFrom] = useState<string | null>(null);

  return (
    <Shell icon={<PencilRuler className="size-4" />} title="Empty floor" subtitle="Nothing drawn yet">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {canStart
          ? 'Start a draft, then draw the rooms. Nothing is visible to anyone else until you publish.'
          : 'Nobody has drawn this floor yet. An admin needs to create the layout first.'}
      </p>

      {canStart && (
        <>
          <Button className="w-full" onClick={() => onStart()} disabled={starting}>
            {starting && <Loader2 className="size-4 animate-spin" />}
            Start drawing
          </Button>

          {copySources.length > 0 && (
            <>
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-[11px] text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>

              <Field label="Copy a layout from another floor">
                <Select
                  disabled={starting}
                  value={from ?? undefined}
                  onValueChange={setFrom}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a floor" />
                  </SelectTrigger>
                  <SelectContent>
                    {copySources.map((source) => (
                      <SelectItem key={source.id} value={source.id}>{source.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Rooms, tables and seats are copied into a new draft on this floor. The
                  floor they came from is not touched.
                </p>
              </Field>

              <Button
                variant="outline"
                className="w-full"
                disabled={starting || from === null}
                onClick={() => from && onStart(from)}
              >
                {starting ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
                Copy that layout here
              </Button>
            </>
          )}

          <Separator />

          <ol className="space-y-2.5 text-sm text-muted-foreground">
            {[
              'Draw a room with the square, circle or pen tool',
              'Drop a table inside it — seats appear automatically',
              'Adjust the seat rule and count in this panel',
              'Add doors and partitions if you need them',
              'Publish, and the floor becomes bookable',
            ].map((step, i) => (
              <li key={step} className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground">
                  {i + 1}
                </span>
                <span className="leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Shell>
  );
}

function Overview() {
  const scene = useEditorStore((s) => s.scene)!;
  const pinned = scene.seats.filter((s) => s.override).length;

  return (
    <Shell icon={<LayoutGrid className="size-4" />} title="Layout" subtitle="Nothing selected">
      <div className="space-y-2">
        <Stat label="Rooms" value={scene.rooms.length} />
        <Stat label="Tables" value={scene.furniture.length} />
        <Stat label="Seats" value={scene.seats.length} />
        {pinned > 0 && <Stat label="Pinned seats" value={pinned} />}
      </div>

      <Separator />

      <div className="flex gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Select a room, table or seat to edit it. Resize a table and its seats redistribute
          in proportion; drag one seat and it pins while the rest move around it.
        </p>
      </div>
    </Shell>
  );
}

function RoomInspector({ canEdit }: { canEdit: boolean }) {
  const scene = useEditorStore((s) => s.scene)!;
  const selection = useSingleSelection()!;
  const renameRoom = useEditorStore((s) => s.renameRoom);
  const setRoomRate = useEditorStore((s) => s.setRoomRate);
  const setRoomKind = useEditorStore((s) => s.setRoomKind);
  const resizeShape = useEditorStore((s) => s.resizeShape);
  const rotateEntity = useEditorStore((s) => s.rotateEntity);
  const moveEntity = useEditorStore((s) => s.moveEntity);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);

  const room = scene.rooms.find((r) => r.id === selection.id);
  if (!room) return null;

  return (
    <Shell
      icon={<Frame className="size-4" />}
      title={room.name}
      subtitle={room.kind === 'CABIN' ? 'Call cabin' : 'Room'}
      locked={!canEdit}
      onDelete={canEdit ? deleteSelected : undefined}
    >
      <Field label="Name">
        <Input value={room.name} disabled={!canEdit} onChange={(e) => renameRoom(room.id, e.target.value)} />
      </Field>

      <PositionFields
        x={room.transform.x}
        y={room.transform.y}
        disabled={!canEdit}
        onChange={(x, y) => moveEntity(selection, x, y, false)}
      />

      <ShapeFields shape={room.shape} disabled={!canEdit} onChange={(s) => resizeShape(selection, s)} />

      <RotationField
        value={room.transform.rot}
        disabled={!canEdit}
        onChange={(rot) => rotateEntity(selection, rot)}
      />

      <Field label="What this room is for">
        <Select
          value={room.kind ?? 'ROOM'}
          disabled={!canEdit}
          onValueChange={(k) => setRoomKind(room.id, k as 'ROOM' | 'CABIN')}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ROOM">Open room — anyone can book a seat</SelectItem>
            <SelectItem value="CABIN">Call cabin — managers and admins only</SelectItem>
          </SelectContent>
        </Select>
        {room.kind === 'CABIN' && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The server turns away anyone else, so this is a permission rather than a
            hidden button.
          </p>
        )}
      </Field>

      <Separator />

      <ArrangeButton roomId={room.id} disabled={!canEdit} />

      <Separator />

      <DivideRoom roomId={room.id} disabled={!canEdit} />

      <Separator />

      <Field label="Rate per hour">
        <Input
          type="number"
          step="0.50"
          min="0"
          placeholder="Free"
          disabled={!canEdit}
          value={room.hourlyRate ?? ''}
          onChange={(e) =>
            setRoomRate(room.id, e.target.value === '' ? null : Math.max(0, num(e.target.value, 0)))
          }
        />
        <p className="text-[11px] text-muted-foreground">
          Every seat in this room is billed at this rate, per started hour. Leave it empty
          and the room is free.
        </p>
      </Field>

      <Separator />
      <div className="space-y-2">
        <Stat label="Doors" value={room.gates.length} />
        <Stat label="Partitions" value={room.partitions.length} />
        {(room.subZones?.length ?? 0) > 0 && (
          <div className="space-y-1.5 pt-1">
            <span className="text-xs text-muted-foreground">Zones created by the partitions</span>
            <div className="flex flex-wrap gap-1.5">
              {room.subZones!.map((zone) => (
                <Badge key={zone.index} variant="secondary" className="tabular font-normal">
                  {zone.name} · {zone.area.toFixed(1)} m²
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function TableInspector({ canEdit }: { canEdit: boolean }) {
  const scene = useEditorStore((s) => s.scene)!;
  const selection = useSingleSelection()!;
  const resizeShape = useEditorStore((s) => s.resizeShape);
  const rotateEntity = useEditorStore((s) => s.rotateEntity);
  const moveEntity = useEditorStore((s) => s.moveEntity);
  const setTableRule = useEditorStore((s) => s.setTableRule);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);

  const table = scene.furniture.find((f) => f.id === selection.id);
  if (!table) return null;
  const seats = scene.seats.filter((s) => s.tableId === table.id);
  const placement = seats[0]?.placement ?? null;
  const pinned = seats.filter((s) => s.override).length;

  return (
    <Shell
      icon={<Table2 className="size-4" />}
      title={table.label ?? 'Table'}
      subtitle={`${seats.length} seats${pinned ? ` · ${pinned} pinned` : ''}`}
      locked={!canEdit}
      onDelete={canEdit ? deleteSelected : undefined}
    >
      <PositionFields
        x={table.transform.x}
        y={table.transform.y}
        disabled={!canEdit}
        onChange={(x, y) => moveEntity(selection, x, y, false)}
      />

      <ShapeFields shape={table.shape} disabled={!canEdit} onChange={(s) => resizeShape(selection, s)} />

      <RotationField
        value={table.transform.rot}
        disabled={!canEdit}
        onChange={(rot) => rotateEntity(selection, rot)}
      />

      {placement && (
        <>
          <Separator />
          <SeatRuleFields
            placement={placement}
            shape={table.shape}
            disabled={!canEdit}
            onChange={(next) => setTableRule(table.id, next)}
          />
        </>
      )}
    </Shell>
  );
}

function PartitionInspector({ canEdit }: { canEdit: boolean }) {
  const scene = useEditorStore((s) => s.scene)!;
  const selection = useSingleSelection()!;
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  if (selection.type !== 'partition') return null;

  const room = scene.rooms.find((r) => r.id === selection.roomId);
  const partition = room?.partitions.find((p) => p.id === selection.id);
  if (!room || !partition) return null;

  const length = partition.polyline.slice(1).reduce((sum, [x, y], i) => {
    const [px, py] = partition.polyline[i]!;
    return sum + Math.hypot(x - px, y - py);
  }, 0);

  return (
    <Shell
      icon={<SplitSquareVertical className="size-4" />}
      title="Partition"
      subtitle={`in ${room.name}`}
      locked={!canEdit}
      onDelete={canEdit ? deleteSelected : undefined}
    >
      <div className="space-y-2">
        <Stat label="Length" value={`${length.toFixed(2)} m`} />
        <Stat label="Thickness" value={`${partition.thickness.toFixed(2)} m`} />
        <Stat label="Zones in this room" value={room.subZones?.length ?? 1} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Deleting it merges the zones either side back into one. The seats and tables stay
        where they are — a partition divides the floor, it does not own anything.
      </p>
    </Shell>
  );
}

function GateInspector({ canEdit }: { canEdit: boolean }) {
  const scene = useEditorStore((s) => s.scene)!;
  const selection = useSingleSelection()!;
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  if (selection.type !== 'gate') return null;

  const room = scene.rooms.find((r) => r.id === selection.roomId);
  const gate = room?.gates.find((g) => g.id === selection.id);
  if (!room || !gate) return null;

  return (
    <Shell
      icon={<DoorOpen className="size-4" />}
      title={gate.type === 'EMERGENCY' ? 'Emergency exit' : 'Door'}
      subtitle={`in ${room.name}`}
      locked={!canEdit}
      onDelete={canEdit ? deleteSelected : undefined}
    >
      <div className="space-y-2">
        <Stat label="Width" value={`${gate.width.toFixed(2)} m`} />
        <Stat label="On wall" value={`edge ${gate.wallEdgeIdx + 1}`} />
        <Stat label="Along that wall" value={`${Math.round(gate.offsetT * 100)}%`} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Deleting it closes the wall back up, in the plan and in the 3D view.
      </p>
    </Shell>
  );
}

function SeatInspector({ canEdit }: { canEdit: boolean }) {
  const scene = useEditorStore((s) => s.scene)!;
  const selection = useSingleSelection()!;
  const clearSeatOverride = useEditorStore((s) => s.clearSeatOverride);
  const moveEntity = useEditorStore((s) => s.moveEntity);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);

  const seat = scene.seats.find((s) => s.id === selection.id);
  if (!seat) return null;

  return (
    <Shell
      icon={<Armchair className="size-4" />}
      title={`Seat ${seat.code}`}
      subtitle={seat.override ? 'Pinned where you put it' : 'Placed by the table rule'}
      locked={!canEdit}
      onDelete={canEdit ? deleteSelected : undefined}
    >
      <PositionFields
        x={seat.localTransform.x}
        y={seat.localTransform.y}
        disabled={!canEdit}
        onChange={(x, y) => moveEntity(selection, x, y, false)}
      />

      <div className="space-y-2">
        <Stat label="Facing" value={`${Math.round((seat.localTransform.rot * 180) / Math.PI)}°`} />
        <Stat label="Index" value={seat.seatIndex} />
      </div>

      {seat.override && canEdit && (
        <Button variant="outline" className="w-full" onClick={() => clearSeatOverride(seat.id)}>
          <PinOff className="size-4" />
          Unpin and let the rule place it
        </Button>
      )}

      <div className="flex gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        {seat.override ? <Pin className="mt-0.5 size-3.5 shrink-0" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}
        <p>
          Position is stored relative to the table, not the floor. That is why rotating the
          table carries this seat without changing anything stored here.
        </p>
      </div>
    </Shell>
  );
}

/**
 * Lay the room's tables out on an even grid.
 *
 * <p>Deliberately one button and no options. The useful choices — how many columns, how
 * wide the gaps — are the ones the room's own shape and the chairs' own size already
 * answer, and asking would mean asking every time. If the result is not wanted, undo is
 * one keystroke and puts every table back at once.
 */
/** The most bands anyone divides a floor into before it stops being a floor plan. */
const MAX_BANDS = 12;

/**
 * Cut the room into a grid of cabins.
 *
 * <p>The other way to make a partition is to click one wall and then another, and the
 * line between them is only as square as those two clicks were. Twelve cabins need five
 * of those, each crooked in its own direction. Here the counts are the input and the
 * walls are derived, so they come out parallel by construction and cross at right angles.
 *
 * <p>Both directions are set at once rather than applied one after the other, because a
 * second pass would have to either throw the first set away or guess how to merge with
 * it. Leaving a count at 1 cuts only the other way.
 */
function DivideRoom({ roomId, disabled }: { roomId: string; disabled: boolean }) {
  const divideRoom = useEditorStore((s) => s.divideRoom);
  const existing = useEditorStore(
    (s) => s.scene?.rooms.find((r) => r.id === roomId)?.partitions.length ?? 0,
  );
  const [columns, setColumns] = useState(4);
  const [rows, setRows] = useState(3);

  const walls = partitionsForGrid(columns, rows);
  const cells = cellsForGrid(columns, rows);
  const clamp = (v: string, fallback: number) =>
    Math.min(MAX_BANDS, Math.max(1, Math.round(num(v, fallback))));

  const run = () => {
    const made = divideRoom(roomId, columns, rows);
    if (made === 0) {
      toast.error('Nothing to divide', {
        description: columns < 2 && rows < 2
          ? 'Set the columns or the rows above one.'
          : 'The room is too narrow across that direction to cut.',
      });
      return;
    }
    toast.success(`Divided into ${columns} × ${rows}`, {
      description: existing > 0
        ? `${made} straight partition${made === 1 ? '' : 's'} making ${cells} cabins, `
          + `replacing the ${existing} that ${existing === 1 ? 'was' : 'were'} there.`
        : `${made} straight partition${made === 1 ? '' : 's'} making ${cells} cabins, `
          + 'evenly spaced and square to the room.',
    });
  };

  return (
    <div className="space-y-2.5">
      <Field label="Divide the room">
        <div className="flex items-center gap-2">
          <div className="flex-1 space-y-1">
            <Input
              type="number"
              min={1}
              max={MAX_BANDS}
              step={1}
              disabled={disabled}
              value={columns}
              aria-label="Columns"
              onChange={(e) => setColumns(clamp(e.target.value, 4))}
            />
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Columns3 className="size-3" />
              columns
            </span>
          </div>

          <span className="pb-5 text-sm text-muted-foreground">×</span>

          <div className="flex-1 space-y-1">
            <Input
              type="number"
              min={1}
              max={MAX_BANDS}
              step={1}
              disabled={disabled}
              value={rows}
              aria-label="Rows"
              onChange={(e) => setRows(clamp(e.target.value, 3))}
            />
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Rows3 className="size-3" />
              rows
            </span>
          </div>
        </div>
      </Field>

      <Button variant="outline" className="w-full" disabled={disabled} onClick={run}>
        <LayoutGrid className="size-4" />
        {`Divide into ${cells} cabin${cells === 1 ? '' : 's'}`}
      </Button>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {walls === 0
          ? 'Set a count above one to cut the room.'
          : `${walls === 1 ? 'One partition' : `${walls} partitions`}, evenly spaced and exactly parallel.`}
        {existing > 0 && ` Replaces the ${existing} already in this room.`}
      </p>
    </div>
  );
}

function ArrangeButton({ roomId, disabled }: { roomId: string; disabled: boolean }) {
  const arrangeRoom = useEditorStore((s) => s.arrangeRoom);
  const tables = useEditorStore(
    (s) => s.scene?.furniture.filter((f) => f.roomId === roomId).length ?? 0,
  );

  if (tables === 0) return null;

  const run = () => {
    const { moves, crowded } = arrangeRoom(roomId);
    if (crowded.length > 0) {
      // Not an error: the tables ARE arranged, as evenly as the space allows. But the
      // validator is about to object, and hearing it here beats hearing it at publish.
      const worst = crowded[0]!;
      toast.warning('Arranged, but it is tight', {
        description:
          `${worst.zone} holds ${worst.tables} tables and has comfortable room for ` +
          `${worst.fits === 1 ? 'about one' : `about ${worst.fits}`}. Make the room ` +
          'bigger, or use fewer or smaller tables.',
      });
    } else {
      toast.success('Tables arranged', {
        description: moves.length === 1
          ? 'One table centred in its zone, chairs re-placed around it.'
          : `${moves.length} tables evenly spaced, chairs re-placed around them.`,
      });
    }
  };

  return (
    <Button variant="outline" className="w-full" disabled={disabled} onClick={run}>
      <Grid3x3 className="size-4" />
      Arrange tables evenly
    </Button>
  );
}

/**
 * Where the thing sits in its parent's frame: the floor for a room, the room for a table,
 * the table for a seat.
 *
 * <p>Dragging is the quick way to move something and the way almost everyone will. It is
 * also hopeless for "exactly two metres off that wall", and it is invisible — a canvas
 * gives no sign that a shape is draggable at all. These two boxes answer both complaints,
 * and they are the only place in the editor that states a position as a number you can
 * read back to someone.
 */
function PositionFields({
  x, y, disabled, onChange,
}: {
  x: number;
  y: number;
  disabled: boolean;
  onChange: (x: number, y: number) => void;
}) {
  // Rounded for DISPLAY only. The stored value keeps its precision; showing 4.000000001
  // in a box someone is about to retype is just noise.
  const show = (v: number) => Math.round(v * 1000) / 1000;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="X (m)">
        <Input type="number" step="0.25" disabled={disabled} value={show(x)}
          onChange={(e) => onChange(num(e.target.value, x), y)} />
      </Field>
      <Field label="Y (m)">
        <Input type="number" step="0.25" disabled={disabled} value={show(y)}
          onChange={(e) => onChange(x, num(e.target.value, y))} />
      </Field>
    </div>
  );
}

function ShapeFields({
  shape, disabled, onChange,
}: {
  shape: ShapeJson;
  disabled: boolean;
  onChange: (shape: ShapeJson) => void;
}) {
  if (shape.kind === 'RECT') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Width (m)">
          <Input type="number" step="0.25" min="0.2" disabled={disabled} value={shape.w}
            onChange={(e) => onChange({ ...shape, w: Math.max(0.2, num(e.target.value, shape.w)) })} />
        </Field>
        <Field label="Depth (m)">
          <Input type="number" step="0.25" min="0.2" disabled={disabled} value={shape.h}
            onChange={(e) => onChange({ ...shape, h: Math.max(0.2, num(e.target.value, shape.h)) })} />
        </Field>
      </div>
    );
  }
  if (shape.kind === 'CIRCLE') {
    return (
      <Field label="Radius (m)">
        <Input type="number" step="0.25" min="0.2" disabled={disabled} value={shape.r}
          onChange={(e) => onChange({ ...shape, r: Math.max(0.2, num(e.target.value, shape.r)) })} />
      </Field>
    );
  }
  if (shape.kind === 'ELLIPSE') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Radius X (m)">
          <Input type="number" step="0.25" disabled={disabled} value={shape.rx}
            onChange={(e) => onChange({ ...shape, rx: Math.max(0.2, num(e.target.value, shape.rx)) })} />
        </Field>
        <Field label="Radius Y (m)">
          <Input type="number" step="0.25" disabled={disabled} value={shape.ry}
            onChange={(e) => onChange({ ...shape, ry: Math.max(0.2, num(e.target.value, shape.ry)) })} />
        </Field>
      </div>
    );
  }
  return (
    <Field label="Outline">
      <p className="text-sm text-muted-foreground">
        Traced with the pen — {shape.points.length} corners. Drag a corner grip to scale
        the whole outline; hold Shift to stretch it one way.
      </p>
    </Field>
  );
}

function RotationField({
  value, disabled, onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (rot: number) => void;
}) {
  const degrees = Math.round((value * 180) / Math.PI);
  return (
    <Field label={`Rotation — ${degrees}°`}>
      <Slider
        min={-180}
        max={180}
        step={15}
        disabled={disabled}
        value={[degrees]}
        onValueChange={([next]) => onChange(((next ?? 0) * Math.PI) / 180)}
      />
    </Field>
  );
}

function SeatRuleFields({
  placement, shape, disabled, onChange,
}: {
  placement: PlacementJson;
  /** The table's own outline: not every rule can be applied to every shape. */
  shape: ShapeJson;
  disabled: boolean;
  onChange: (placement: PlacementJson) => void;
}) {
  const clearance = placement.kind === 'MANUAL' ? 0.45 : placement.clearance;
  const radialReason = whyRuleCannotApply('RADIAL', shape);

  return (
    <div className="space-y-4">
      <Field label="How seats are placed">
        <Select
          disabled={disabled}
          value={placement.kind}
          onValueChange={(kind) => {
            if (kind === 'PERIMETER_EVEN') onChange({ kind, count: 8, startOffset: 0, clearance });
            else if (kind === 'RADIAL') {
              if (!ruleSuitsShape('RADIAL', shape)) return;
              onChange({ kind, count: 6, startAngle: 0, clearance });
            }
            else if (kind === 'EDGE_COUNTS') onChange({ kind, counts: { top: 3, bottom: 3, left: 1, right: 1 }, clearance });
            else onChange({ kind: 'MANUAL' });
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="PERIMETER_EVEN">Evenly around the edge</SelectItem>
            <SelectItem value="EDGE_COUNTS">A set number per side</SelectItem>
            <SelectItem value="RADIAL" disabled={radialReason !== null}>
              Radially
              <span className="ml-1.5 text-muted-foreground">
                {radialReason ?? '(round tables)'}
              </span>
            </SelectItem>
            <SelectItem value="MANUAL">Placed by hand</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {(placement.kind === 'PERIMETER_EVEN' || placement.kind === 'RADIAL') && (
        <Field label={`Seats — ${placement.count}`}>
          <Slider
            min={1} max={24} step={1} disabled={disabled}
            value={[placement.count]}
            onValueChange={([count]) => onChange({ ...placement, count: count ?? 1 })}
          />
        </Field>
      )}

      {placement.kind === 'EDGE_COUNTS' && (
        <div className="grid grid-cols-2 gap-3">
          {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
            <Field key={side} label={side[0]!.toUpperCase() + side.slice(1)}>
              <Input
                type="number" min={0} max={12} disabled={disabled}
                value={placement.counts[side] ?? 0}
                onChange={(e) => onChange({
                  ...placement,
                  counts: { ...placement.counts, [side]: Math.max(0, Math.round(num(e.target.value, 0))) },
                })}
              />
            </Field>
          ))}
        </div>
      )}

      {placement.kind !== 'MANUAL' && (
        <Field label={`Gap to the table — ${placement.clearance.toFixed(2)} m`}>
          <Slider
            min={0.1} max={1} step={0.05} disabled={disabled}
            value={[placement.clearance]}
            onValueChange={([c]) => onChange({ ...placement, clearance: c ?? 0.45 })}
          />
        </Field>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Changing the size or the rule re-runs the placement engine. Seats you have dragged
        keep their position and the rest redistribute around them.
      </p>
    </div>
  );
}
