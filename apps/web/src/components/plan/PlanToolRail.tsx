'use client';

import {
  BoxSelect, Circle, CircleDot, DoorOpen, Hand, MousePointer2, PenTool, RectangleHorizontal,
  Square, SplitSquareVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Shortcut } from '@/components/plan/Shortcut';
import { keyForTool } from '@/editor/shortcuts';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useEditorStore, type Tool } from '@/state/editorStore';

interface ToolSpec {
  id: Tool;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Grouped, not a flat list.
 *
 * <p>Eleven buttons in a row asks the reader to scan all of them every time. Three small
 * groups — what you select with, what you draw rooms with, what you put in them — means
 * the eye goes to one group of two or three.
 */
const GROUPS: ToolSpec[][] = [
  [
    {
      id: 'SELECT',
      label: 'Select',
      hint: 'Click to pick one thing, shift-click to add another. Drag anything to move it, or its grips to resize and turn it.',
      icon: MousePointer2,
    },
    {
      id: 'MARQUEE',
      label: 'Sweep a box',
      hint: 'Drag a box over the tables you want. Hold Shift to sweep again and add to the group. Returns to Select when you let go.',
      icon: BoxSelect,
    },
    {
      id: 'HAND',
      label: 'Hand',
      hint: 'Drag to move the view. Holding Space does the same from any tool, and two fingers on a trackpad slide the plan without either.',
      icon: Hand,
    },
  ],
  [
    { id: 'ROOM_RECT', label: 'Rectangular room', hint: 'Click the floor to place a rectangular room', icon: Square },
    { id: 'ROOM_CIRCLE', label: 'Round room', hint: 'Click the floor to place a circular room', icon: Circle },
    { id: 'ROOM_POLY', label: 'Pen', hint: 'Click each corner, then click the first again to close  ·  Esc cancels', icon: PenTool },
  ],
  [
    { id: 'TABLE_RECT', label: 'Rectangular table', hint: 'Click inside a room to add a rectangular table', icon: RectangleHorizontal },
    { id: 'TABLE_ROUND', label: 'Round table', hint: 'Click inside a room to add a round table', icon: CircleDot },
  ],
  [
    { id: 'GATE', label: 'Door', hint: 'Click a wall to put a door on it', icon: DoorOpen },
    { id: 'PARTITION', label: 'Partition', hint: 'Click one wall then the opposite one to divide the room', icon: SplitSquareVertical },
  ],
];

export function PlanToolRail({ disabled }: { disabled: boolean }) {
  // `disabled` is true on a published layout and on an empty floor: in both cases there
  // is nothing a tool could draw into, and an enabled-looking tool that does nothing when
  // clicked is worse than one that is plainly unavailable.
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const cancelDrawing = useEditorStore((s) => s.cancelDrawing);

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2">
      {GROUPS.map((group, index) => (
        <div key={index} className="flex flex-col items-center gap-1">
          {index > 0 && <Separator className="my-1 w-6" />}
          {group.map(({ id, label, hint, icon: Icon }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={label}
                  aria-pressed={tool === id}
                  onClick={() => {
                    cancelDrawing();
                    setTool(id);
                  }}
                  className={cn(
                    'size-9',
                    tool === id && 'bg-primary/15 text-primary hover:bg-primary/20',
                  )}
                >
                  <Icon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[280px]">
                <p className="flex items-center font-medium">
                  {label}
                  <Shortcut keys={[keyForTool(id)]} />
                </p>
                <p className="text-muted-foreground">{hint}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      ))}
    </nav>
  );
}
