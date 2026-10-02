'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/api/client';
import type { AffectedBookingJson, BuildingJson, SessionJson } from '@/api/types';
import { useEditorStore } from '@/state/editorStore';
import { EditorCanvas } from '@/canvas/EditorCanvas';
import { BookingPanel } from './BookingPanel';
import { DimensionReadout } from './DimensionReadout';
import { PropertiesPanel } from './PropertiesPanel';
import { Toolbar } from './Toolbar';
import { ValidationPanel } from './ValidationPanel';

export function Editor({ session, onSignOut }: { session: SessionJson; onSignOut: () => void }) {
  const scene = useEditorStore((s) => s.scene);
  const etag = useEditorStore((s) => s.etag);
  const dirty = useEditorStore((s) => s.dirty);
  const loadScene = useEditorStore((s) => s.loadScene);
  const markSaved = useEditorStore((s) => s.markSaved);
  const setViolations = useEditorStore((s) => s.setViolations);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const setTool = useEditorStore((s) => s.setTool);
  const cancelDrawing = useEditorStore((s) => s.cancelDrawing);
  const drawing = useEditorStore((s) => s.drawing);
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);

  const [buildings, setBuildings] = useState<BuildingJson[]>([]);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [affected, setAffected] = useState<AffectedBookingJson[]>([]);

  const isAdmin = session.user.role === 'ADMIN';
  const canEdit = mode === 'PLAN' && scene?.status === 'DRAFT' && isAdmin;

  // Everyone but an admin is here to book, so start them there rather than on an
  // editor they are not allowed to use.
  useEffect(() => {
    if (!isAdmin) setMode('BOOK');
  }, [isAdmin, setMode]);

  useEffect(() => {
    api.buildings().then((list) => {
      setBuildings(list);
      const first = list[0]?.floors[0];
      if (first) setFloorId(first.id);
    });
  }, []);

  useEffect(() => {
    if (!floorId) return;
    const building = buildings.find((b) => b.floors.some((f) => f.id === floorId));
    const floor = building?.floors.find((f) => f.id === floorId);
    // Booking always reads the PUBLISHED layout: a draft is a work in progress and its
    // seats may not exist yet, so offering them would sell a chair nobody can sit in.
    const load = mode === 'PLAN' && floor?.draftVersionId
      ? api.scene(floor.draftVersionId)
      : api.publishedScene(floorId);
    load
      .then(({ scene: s, etag: e }) => loadScene(s, e))
      .catch(() => setMessage('This floor has no published layout yet.'));
  }, [floorId, buildings, loadScene, mode]);

  const refreshBuildings = useCallback(async () => {
    setBuildings(await api.buildings());
  }, []);

  const save = useCallback(async () => {
    if (!scene) return;
    setBusy('saving');
    setMessage(null);
    try {
      const { scene: saved, etag: next } = await api.saveScene(scene.planVersionId, scene, etag);
      markSaved(saved, next);
      setMessage('Saved.');
    } catch (e) {
      // 412 means someone else saved while this tab was editing. Saying so plainly is
      // better than a generic failure, because the fix is specific: reload first.
      setMessage(
        e instanceof ApiError && e.status === 412
          ? 'Someone else changed this layout while you were editing. Reload before saving.'
          : 'Could not save.',
      );
    } finally {
      setBusy(null);
    }
  }, [scene, etag, markSaved]);

  const validate = useCallback(async () => {
    if (!scene) return;
    setBusy('validating');
    try {
      const found = await api.validate(scene.planVersionId);
      setViolations(found);
      setAffected([]);
      setMessage(found.length === 0 ? 'No problems found.' : null);
    } finally {
      setBusy(null);
    }
  }, [scene, setViolations]);

  const publish = useCallback(async () => {
    if (!scene) return;
    setBusy('publishing');
    setMessage(null);
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
        setMessage('Published.');
        await refreshBuildings();
      } else if (result.affectedBookings.length > 0) {
        setMessage('Publishing was refused: it would orphan live bookings.');
      } else {
        setMessage('Publishing was refused: fix the problems below.');
      }
    } finally {
      setBusy(null);
    }
  }, [scene, dirty, etag, markSaved, setViolations, loadScene, refreshBuildings]);

  /**
   * Autosave, a few seconds after editing stops.
   *
   * <p>Debounced rather than per-change: the scene save replaces the whole graph, so
   * firing it on every pointer move during a drag would send dozens of full layouts and
   * bump the revision out from under the editor's own ETag.
   */
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!canEdit || !dirty || busy !== null || drawing) return;
    const timer = setTimeout(() => void saveRef.current(), 2500);
    return () => clearTimeout(timer);
  }, [canEdit, dirty, busy, drawing, scene]);

  const createDraft = useCallback(async () => {
    if (!floorId) return;
    setBusy('drafting');
    try {
      const draft = await api.createDraft(floorId);
      loadScene(draft, String(draft.revision));
      await refreshBuildings();
      setMessage('Editable draft created.');
    } catch {
      setMessage('Only an admin can edit a layout.');
    } finally {
      setBusy(null);
    }
  }, [floorId, loadScene, refreshBuildings]);

  // Keyboard: undo/redo, delete, and the select tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
      const temporal = useEditorStore.temporal.getState();
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelDrawing();
        setTool('SELECT');
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) temporal.redo();
        else temporal.undo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (canEdit) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.key.toLowerCase() === 'v') {
        setTool('SELECT');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, deleteSelected, setTool, cancelDrawing]);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--panel-2)',
        }}
      >
        <strong style={{ fontSize: 13 }}>Parametric Seat Booking</strong>
        <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
          {(['PLAN', 'BOOK'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={m === 'PLAN' && !isAdmin}
              style={{
                border: 'none',
                borderRadius: 0,
                padding: '5px 12px',
                background: mode === m ? 'var(--accent)' : 'transparent',
                color: mode === m ? '#06121f' : 'var(--text)',
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m === 'PLAN' ? 'Plan' : 'Book'}
            </button>
          ))}
        </div>
        <select
          style={{ width: 240 }}
          value={floorId ?? ''}
          onChange={(e) => setFloorId(e.target.value)}
        >
          {buildings.flatMap((b) =>
            b.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {b.name} &middot; {f.name}
              </option>
            )),
          )}
        </select>
        <span style={{ flex: 1 }} />
        {message && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{message}</span>}
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {session.user.displayName} ({session.user.role})
        </span>
        <button onClick={onSignOut}>Sign out</button>
      </div>

      {mode === 'PLAN' && (
        <Toolbar
          onSave={save}
          onValidate={validate}
          onPublish={publish}
          onCreateDraft={createDraft}
          busy={busy}
          canEdit={!!canEdit}
        />
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <EditorCanvas />
          {mode === 'PLAN' && <DimensionReadout />}
        </div>
        <aside
          style={{
            width: 310,
            borderLeft: '1px solid var(--line)',
            background: 'var(--panel)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
          }}
        >
          {mode === 'PLAN' ? <PropertiesPanel /> : <BookingPanel floorId={floorId} />}
        </aside>
      </div>

      {mode === 'PLAN' && <ValidationPanel affected={affected} />}
    </main>
  );
}
