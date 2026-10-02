'use client';

import { Box, Check, CloudUpload, Loader2, Magnet, Redo2, Square, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/state/editorStore';

/**
 * State on the left, actions on the right.
 *
 * <p>The old bar mixed tools, view switches and publish into one row of equal-looking
 * buttons, so "which of these changes the layout" had no answer. Publishing is the only
 * thing here that other people see, so it is the only filled button.
 */
export function PlanTopBar({
  onValidate,
  onPublish,
  onCreateDraft,
  busy,
  canEdit,
  noLayout,
  canStart,
}: {
  onValidate: () => void;
  onPublish: () => void;
  onCreateDraft: () => void;
  busy: string | null;
  canEdit: boolean;
  noLayout: boolean;
  canStart: boolean;
}) {
  const scene = useEditorStore((s) => s.scene);
  const dirty = useEditorStore((s) => s.dirty);
  const view = useEditorStore((s) => s.view);
  const setView = useEditorStore((s) => s.setView);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const drawing = useEditorStore((s) => s.drawing);
  const temporal = useEditorStore.temporal;

  const canUndo = temporal.getState().pastStates.length > 0;
  const canRedo = temporal.getState().futureStates.length > 0;

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
      {scene && (
        <Badge variant={scene.status === 'DRAFT' ? 'secondary' : 'outline'} className="font-mono text-[11px]">
          {scene.status === 'DRAFT' ? 'Draft' : 'Published'} · rev {scene.revision}
        </Badge>
      )}

      {noLayout && <span className="text-sm text-muted-foreground">This floor is empty</span>}

      {canEdit && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {busy === 'saving' ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Saving
            </>
          ) : dirty ? (
            <>
              <span className="size-1.5 rounded-full bg-primary" /> Unsaved
            </>
          ) : (
            <>
              <Check className="size-3" /> Saved
            </>
          )}
        </span>
      )}

      {/* The pen and partition tools need two or more clicks, so the step you are on is
          said out loud rather than left to be inferred from the drawing. */}
      {drawing && (
        <Badge className="bg-primary/15 text-primary hover:bg-primary/15">
          {drawing.kind === 'POLYGON'
            ? `${drawing.points.length} corner${drawing.points.length === 1 ? '' : 's'} — click the first to close`
            : 'Click the opposite wall to finish'}
          <span className="ml-1.5 text-muted-foreground">Esc to cancel</span>
        </Badge>
      )}

      <div className="ml-auto flex items-center gap-1">
        {canEdit && (
          <>
            <IconButton label="Undo  ·  Cmd Z" disabled={!canUndo} onClick={() => temporal.getState().undo()}>
              <Undo2 className="size-4" />
            </IconButton>
            <IconButton label="Redo  ·  Cmd Shift Z" disabled={!canRedo} onClick={() => temporal.getState().redo()}>
              <Redo2 className="size-4" />
            </IconButton>
            <IconButton
              label={snapEnabled ? 'Snapping on — grid 0.25 m, angle 15°, walls and table edges' : 'Snapping off'}
              onClick={toggleSnap}
              active={snapEnabled}
            >
              <Magnet className="size-4" />
            </IconButton>
            <Separator orientation="vertical" className="mx-1 h-6" />
          </>
        )}

        <IconButton
          label={view === '2D' ? 'Switch to the 3D review view' : 'Back to the 2D plan'}
          onClick={() => setView(view === '2D' ? '3D' : '2D')}
          active={view === '3D'}
        >
          {view === '2D' ? <Box className="size-4" /> : <Square className="size-4" />}
        </IconButton>

        {!canEdit && (scene || noLayout) && canStart && (
          <Button size="sm" variant={noLayout ? 'default' : 'outline'} className="ml-2"
            onClick={onCreateDraft} disabled={busy !== null}>
            {busy === 'drafting' && <Loader2 className="size-3.5 animate-spin" />}
            {noLayout ? 'Start drawing' : 'Edit layout'}
          </Button>
        )}

        {canEdit && (
          <>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <Button size="sm" variant="ghost" onClick={onValidate} disabled={busy !== null}>
              Check
            </Button>
            <Button size="sm" onClick={onPublish} disabled={busy !== null}>
              {busy === 'publishing' ? <Loader2 className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
              Publish
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function IconButton({
  label, children, onClick, disabled, active,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-8', active && 'bg-primary/15 text-primary hover:bg-primary/20')}
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px]">{label}</TooltipContent>
    </Tooltip>
  );
}
