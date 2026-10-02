'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/api/client';
import type { AffectedBookingJson, BuildingJson, SessionJson } from '@/api/types';
import { EditorCanvas } from '@/canvas/EditorCanvas';
import { AppHeader } from '@/components/AppHeader';
import { BookPanel } from '@/components/book/BookPanel';
import { EstateDialog } from '@/components/EstateDialog';
import { InspectorPanel } from '@/components/plan/InspectorPanel';
import { IssuesBar } from '@/components/plan/IssuesBar';
import { PlanToolRail } from '@/components/plan/PlanToolRail';
import { PlanTopBar } from '@/components/plan/PlanTopBar';
import { StatusReadout } from '@/components/plan/StatusReadout';
import { useEditorStore } from '@/state/editorStore';

/** A short, human reason from an ApiError, or nothing rather than a stack trace. */
function describe(e: unknown): string | undefined {
  if (e instanceof ApiError) {
    const body = e.body as { message?: string } | null;
    return body?.message ?? e.message;
  }
  return undefined;
}

/** Arrow key to a direction on the floor. Y grows upward, the way the canvas draws it. */
const NUDGES: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/** Where the selected thing currently sits, in its own parent's frame. */
function positionOf(
  scene: ReturnType<typeof useEditorStore.getState>['scene'],
  sel: NonNullable<ReturnType<typeof useEditorStore.getState>['selection']>,
): { x: number; y: number } | null {
  if (!scene) return null;
  if (sel.type === 'room') return scene.rooms.find((r) => r.id === sel.id)?.transform ?? null;
  if (sel.type === 'furniture') return scene.furniture.find((f) => f.id === sel.id)?.transform ?? null;
  return scene.seats.find((s) => s.id === sel.id)?.localTransform ?? null;
}

export function Workspace({ session, onSignOut }: { session: SessionJson; onSignOut: () => void }) {
  const scene = useEditorStore((s) => s.scene);
  const etag = useEditorStore((s) => s.etag);
  const dirty = useEditorStore((s) => s.dirty);
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const drawing = useEditorStore((s) => s.drawing);
  const loadScene = useEditorStore((s) => s.loadScene);
  const markSaved = useEditorStore((s) => s.markSaved);
  const setViolations = useEditorStore((s) => s.setViolations);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const setTool = useEditorStore((s) => s.setTool);
  const cancelDrawing = useEditorStore((s) => s.cancelDrawing);

  const [buildings, setBuildings] = useState<BuildingJson[]>([]);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [affected, setAffected] = useState<AffectedBookingJson[]>([]);
  // A brand-new floor has no published version and no draft. Without tracking that,
  // the editor renders nothing at all and offers no way to start.
  const [noLayout, setNoLayout] = useState(false);
  const [estateOpen, setEstateOpen] = useState(false);

  const isAdmin = session.user.role === 'ADMIN';
  const canEdit = mode === 'PLAN' && scene?.status === 'DRAFT' && isAdmin;

  // The canvas is driven imperatively and reads the store directly, so the one condition
  // that decides whether a gesture is allowed has to live there too.
  const setEditable = useEditorStore((s) => s.setEditable);
  useEffect(() => setEditable(!!canEdit), [canEdit, setEditable]);

  useEffect(() => {
    if (!isAdmin) setMode('BOOK');
  }, [isAdmin, setMode]);

  useEffect(() => {
    void api
      .buildings()
      .then((list) => {
        setBuildings(list);
        const first = list[0]?.floors[0];
        if (first) setFloorId(first.id);
      })
      .catch((e) => toast.error('Could not load buildings', { description: describe(e) }));
  }, []);

  // A floor can disappear underneath us when it is deleted from the estate dialog, and
  // an organisation with no floors at all is the state a new customer starts in.
  useEffect(() => {
    const stillThere = buildings.some((b) => b.floors.some((f) => f.id === floorId));
    if (floorId && !stillThere) {
      setFloorId(buildings.flatMap((b) => b.floors)[0]?.id ?? null);
    }
    if (!floorId && buildings.length > 0) {
      const first = buildings.flatMap((b) => b.floors)[0];
      if (first) setFloorId(first.id);
    }
    if (buildings.length > 0 && buildings.every((b) => b.floors.length === 0)) {
      useEditorStore.setState({ scene: null, etag: null });
      setNoLayout(true);
    }
  }, [buildings, floorId]);

  useEffect(() => {
    if (!floorId) return;
    const building = buildings.find((b) => b.floors.some((f) => f.id === floorId));
    const floor = building?.floors.find((f) => f.id === floorId);
    // Booking always reads the PUBLISHED layout: a draft's seats may not exist yet, and
    // offering them would sell a chair nobody can sit in.
    const load = mode === 'PLAN' && floor?.draftVersionId
      ? api.scene(floor.draftVersionId)
      : api.publishedScene(floorId);
    load
      .then(({ scene: s, etag: e }) => {
        loadScene(s, e);
        setNoLayout(false);
      })
      .catch(() => {
        useEditorStore.setState({ scene: null, etag: null });
        setNoLayout(true);
      });
  }, [floorId, buildings, loadScene, mode]);

  const refreshBuildings = useCallback(async () => setBuildings(await api.buildings()), []);

  const save = useCallback(async () => {
    if (!scene) return;
    setBusy('saving');
    try {
      const { scene: saved, etag: next } = await api.saveScene(scene.planVersionId, scene, etag);
      markSaved(saved, next);
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.status === 412
          ? 'Someone else changed this layout'
          : 'Could not save',
        {
          description: e instanceof ApiError && e.status === 412
            ? 'Reload before saving so their work is not lost.'
            : undefined,
        },
      );
    } finally {
      setBusy(null);
    }
  }, [scene, etag, markSaved]);

  // Autosave a few seconds after editing stops, and never mid-stroke: the scene save
  // replaces the whole graph, so firing it per change would send dozens of full layouts.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!canEdit || !dirty || busy !== null || drawing) return;
    const timer = setTimeout(() => void saveRef.current(), 2500);
    return () => clearTimeout(timer);
  }, [canEdit, dirty, busy, drawing, scene]);

  const validate = useCallback(async () => {
    if (!scene) return;
    setBusy('validating');
    try {
      const found = await api.validate(scene.planVersionId);
      setViolations(found);
      setAffected([]);
      if (found.length === 0) toast.success('No problems found');
    } catch (e) {
      // Without this an ApiError escapes into Next's runtime overlay, which is a
      // full-screen crash report for what is only a request that failed.
      toast.error('Could not check the layout', { description: describe(e) });
    } finally {
      setBusy(null);
    }
  }, [scene, setViolations]);

  const publish = useCallback(async () => {
    if (!scene) return;
    setBusy('publishing');
    try {
      if (dirty) {
        const { scene: saved, etag: next } = await api.saveScene(scene.planVersionId, scene, etag);
        markSaved(saved, next);
      }
      const result = await api.publish(scene.planVersionId);
      setViolations(result.violations);
      setAffected(result.affectedBookings);
      if (result.published) {
        loadScene(result.scene, String(result.scene.revision));
        toast.success('Layout published', { description: 'Everyone sees this version now.' });
        await refreshBuildings();
      } else {
        toast.error('Publishing was refused', {
          description: result.affectedBookings.length > 0
            ? 'It would leave live bookings without a seat.'
            : 'Fix the problems listed at the bottom.',
        });
      }
    } catch (e) {
      toast.error('Could not publish', { description: describe(e) });
    } finally {
      setBusy(null);
    }
  }, [scene, dirty, etag, markSaved, setViolations, loadScene, refreshBuildings]);

  const createDraft = useCallback(async () => {
    if (!floorId) return;
    setBusy('drafting');
    try {
      const draft = await api.createDraft(floorId);
      loadScene(draft, String(draft.revision));
      setNoLayout(false);
      await refreshBuildings();
      toast.success('Editable draft created', { description: 'Changes stay private until you publish.' });
    } catch (e) {
      toast.error('Could not start a draft', { description: describe(e) });
    } finally {
      setBusy(null);
    }
  }, [floorId, loadScene, refreshBuildings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      const temporal = useEditorStore.temporal.getState();
      if (e.key === 'Escape') {
        cancelDrawing();
        setTool('SELECT');
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) temporal.redo();
        else temporal.undo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key.toLowerCase() === 'v') {
        setTool('SELECT');
      } else if (canEdit && NUDGES[e.key]) {
        // A drag cannot reliably move something by one grid square, and on a trackpad it
        // often cannot move it by a small amount at all. Arrows can.
        e.preventDefault();
        const store = useEditorStore.getState();
        const sel = store.selection;
        if (!sel) return;
        const here = positionOf(store.scene, sel);
        if (!here) return;
        const [dx, dy] = NUDGES[e.key]!;
        const step = e.shiftKey ? store.gridSnap * 4 : store.gridSnap;
        // One history entry for the whole press-and-hold, the same as one drag.
        store.beginDrag();
        store.moveEntity(sel, here.x + dx * step, here.y + dy * step, false);
        store.endDrag();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, deleteSelected, setTool, cancelDrawing]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppHeader
        session={session}
        buildings={buildings}
        floorId={floorId}
        onFloorChange={setFloorId}
        onSignOut={onSignOut}
        onManageEstate={() => setEstateOpen(true)}
      />

      <EstateDialog
        open={estateOpen}
        onOpenChange={setEstateOpen}
        currentFloorId={floorId}
        onChanged={(selectFloorId) => {
          void refreshBuildings();
          if (selectFloorId) setFloorId(selectFloorId);
        }}
      />

      <div className="flex min-h-0 flex-1">
        {mode === 'PLAN' && <PlanToolRail disabled={!canEdit} />}

        <div className="flex min-w-0 flex-1 flex-col">
          {mode === 'PLAN' && (
            <PlanTopBar
              onValidate={validate}
              onPublish={publish}
              onCreateDraft={createDraft}
              busy={busy}
              canEdit={!!canEdit}
              noLayout={noLayout}
              canStart={isAdmin}
            />
          )}

          <div className="relative min-h-0 flex-1 bg-canvas">
            <EditorCanvas />
            {mode === 'PLAN' && <StatusReadout />}
          </div>

          {mode === 'PLAN' && <IssuesBar affected={affected} />}
        </div>

        <aside className="flex w-[320px] shrink-0 flex-col border-l bg-sidebar">
          {mode === 'PLAN' ? (
            <InspectorPanel
              noLayout={noLayout}
              canStart={isAdmin}
              onStart={createDraft}
              starting={busy === 'drafting'}
            />
          ) : (
            <BookPanel
              floorId={floorId}
              canManage={session.user.role === 'MANAGER' || session.user.role === 'ADMIN'}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
