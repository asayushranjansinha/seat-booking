'use client';

import { Building2, LogOut, Settings2 } from 'lucide-react';
import type { BuildingJson, SessionJson } from '@/api/types';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useEditorStore } from '@/state/editorStore';

/**
 * One row that answers "where am I and what am I doing".
 *
 * <p>Plan and Book are two different jobs with almost no overlap, so the switch between
 * them is the most prominent control here rather than a link buried beside the sign-out.
 */
export function AppHeader({
  session,
  buildings,
  floorId,
  onFloorChange,
  onSignOut,
  onManageEstate,
}: {
  session: SessionJson;
  buildings: BuildingJson[];
  floorId: string | null;
  onFloorChange: (id: string) => void;
  onSignOut: () => void;
  onManageEstate: () => void;
}) {
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const isAdmin = session.user.role === 'ADMIN';
  const hasAnyFloor = buildings.some((b) => b.floors.length > 0);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-sidebar px-4">
      <div className="flex items-center gap-2 font-semibold">
        <Building2 className="size-4 text-primary" />
        <span className="hidden sm:inline">Seat Booking</span>
      </div>

      <Separator orientation="vertical" className="h-6" />

      {/* With no buildings at all there is nothing to choose between, so the control
          becomes the thing that fixes that rather than an empty dropdown. */}
      {hasAnyFloor ? (
        <Select value={floorId ?? undefined} onValueChange={onFloorChange}>
          <SelectTrigger className="w-[230px]" aria-label="Floor">
            <SelectValue placeholder="Choose a floor" />
          </SelectTrigger>
          <SelectContent>
            {buildings
              .filter((b) => b.floors.length > 0)
              .map((building) => (
                <SelectGroup key={building.id}>
                  <SelectLabel>{building.name}</SelectLabel>
                  {building.floors.map((floor) => (
                    <SelectItem key={floor.id} value={floor.id}>
                      {floor.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
          </SelectContent>
        </Select>
      ) : (
        isAdmin && (
          <Button variant="outline" size="sm" onClick={onManageEstate}>
            <Building2 className="size-4" />
            Add a building
          </Button>
        )
      )}

      {isAdmin && hasAnyFloor && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Buildings and floors"
              onClick={onManageEstate}>
              <Settings2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Buildings and floors</TooltipContent>
        </Tooltip>
      )}

      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(value) => value && setMode(value as 'PLAN' | 'BOOK')}
        variant="outline"
        size="sm"
      >
        <ToggleGroupItem value="PLAN" disabled={!isAdmin} className="px-4">
          Plan
        </ToggleGroupItem>
        <ToggleGroupItem value="BOOK" className="px-4">
          Book
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right leading-tight sm:block">
          <div className="text-sm font-medium">{session.user.displayName}</div>
          <div className="text-xs text-muted-foreground">{session.user.role.toLowerCase()}</div>
        </div>
        <Button variant="ghost" size="icon" onClick={onSignOut} aria-label="Sign out">
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
