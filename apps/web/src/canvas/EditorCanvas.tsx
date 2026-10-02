'use client';

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useEffect, useRef } from 'react';
import { applyTransform, composeTransform, invertTransform } from '@seat-booking/geometry';
import { snapValue, useEditorStore, type Selection } from '@/state/editorStore';
import type { SceneJson, TransformJson } from '@/api/types';
import { buildSceneGraph, disposeGraph, type HandleData, type PickData } from './sceneGraph';
import { ringFor } from './shapeToThree';
import { nearestWall, roomAt, snapToGeometry, SNAP_DISTANCE } from './snapping';
import type { ShapeJson } from '@/api/types';

const IDENTITY: TransformJson = { x: 0, y: 0, rot: 0 };
const GROUND = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

/**
 * The authoring surface, driven imperatively against three.js.
 *
 * <p>Deliberately NOT react-three-fiber. R3F 9.8.1 produced zero draw calls in this
 * stack (verified against Next 15 and 16, React 19.2 and 19.3, Turbopack and webpack,
 * with a single React and a single three resolved), while plain three.js rendered
 * correctly in the same slot. The canvas is also the one surface where React's
 * reconciler buys least: it is redrawn from a store on every frame of a drag.
 *
 * <p>Top-down authoring uses an ORTHOGRAPHIC camera because plan drawing has to be
 * precise: under perspective, two seats the same distance apart measure differently
 * depending on where they fall on screen. The 3D toggle swaps in a perspective camera
 * over the very same scene graph, so the two views cannot disagree.
 */
export function EditorCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    | { mode: 'move'; selection: NonNullable<Selection>; offset: THREE.Vector2 }
    | { mode: 'handle'; handle: HandleData; parent: TransformJson }
    | null
  >(null);
  const guidesRef = useRef<Array<[{ x: number; y: number }, { x: number; y: number }]>>([]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x161b24, 1);  // matches --canvas
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(8, -10, 14);
    scene.add(sun);

    const grid = new THREE.GridHelper(200, 800, 0x2b3240, 0x1f2531);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.05;
    scene.add(grid);

    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    ortho.position.set(6, 4, 60);
    ortho.up.set(0, 1, 0);
    const perspective = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    perspective.position.set(10, -16, 12);
    perspective.up.set(0, 0, 1);

    let camera: THREE.OrthographicCamera | THREE.PerspectiveCamera = ortho;
    // The generic parameter follows the camera type, and this one is reassigned when the
    // 2D/3D toggle swaps cameras, so it is typed against the union.
    let controls: OrbitControls<THREE.OrthographicCamera | THREE.PerspectiveCamera> =
      new OrbitControls(ortho, renderer.domElement);
    controls.enableRotate = false;
    controls.target.set(6, 4, 0);
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.update();

    /** Metres visible across the viewport width in the top-down view. */
    let orthoSpan = 42;
    let graph: THREE.Group | null = null;
    let framed = false;

    /** Frame the whole floor on first load, so the editor never opens on empty space. */
    const frameToContent = (s: SceneJson) => {
      if (s.rooms.length === 0) return;
      const box = new THREE.Box2();
      for (const room of s.rooms) {
        for (const p of ringFor(room.shape)) {
          const w = applyTransform(room.transform, p);
          box.expandByPoint(new THREE.Vector2(w.x, w.y));
        }
      }
      const size = box.getSize(new THREE.Vector2());
      const centre = box.getCenter(new THREE.Vector2());
      const aspect = Math.max(el.clientWidth / Math.max(el.clientHeight, 1), 0.1);
      // Fit the larger of width and height-scaled-by-aspect, with a margin.
      orthoSpan = Math.max(size.x, size.y * aspect) * 1.25 + 2;
      ortho.position.set(centre.x, centre.y, 60);
      controls.target.set(centre.x, centre.y, 0);
      perspective.position.set(centre.x, centre.y - size.y * 1.3, Math.max(size.x, size.y) * 0.8);
      controls.update();
      resize();
    };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      // updateStyle must stay on: with it off the drawing buffer resizes but the canvas
      // element keeps its intrinsic 300x150 CSS size and visually overflows its slot.
      renderer.setSize(w, h);
      const aspect = w / h;
      ortho.left = -orthoSpan / 2;
      ortho.right = orthoSpan / 2;
      ortho.top = orthoSpan / 2 / aspect;
      ortho.bottom = -orthoSpan / 2 / aspect;
      ortho.updateProjectionMatrix();
      perspective.aspect = aspect;
      perspective.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    // Zooming an orthographic camera through OrbitControls changes camera.zoom; mirror
    // that into the span so hit-testing and the view agree.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const toWorld = (event: PointerEvent): THREE.Vector2 => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = new THREE.Vector3();
      raycaster.ray.intersectPlane(GROUND, hit);
      return new THREE.Vector2(hit.x, hit.y);
    };

    /** What the pointer is over right now, expressed as a CSS cursor. */
    const hoverCursor = (state: ReturnType<typeof useEditorStore.getState>): string => {
      if (state.mode === 'PLAN' && state.tool !== 'SELECT') {
        return state.editable ? 'crosshair' : 'not-allowed';
      }
      if (!graph) return 'default';
      graph.updateMatrixWorld(true);
      const hits = raycaster.intersectObjects(graph.children, true);
      const overHandle = hits.some((h) => (h.object.userData as { handle?: HandleData }).handle);
      const overEntity = hits.some((h) => (h.object.userData as { pick?: PickData }).pick);
      if (state.mode === 'BOOK') return overEntity ? 'pointer' : 'default';
      if (!overHandle && !overEntity) return 'default';
      // 3D selects but never moves. Promising a grab here is how someone ends up dragging
      // a chair around a picture of a room and concluding the editor is broken.
      if (state.view === '3D') return 'pointer';
      // Selecting is allowed on a published layout even though moving is not, so the
      // cursor promises a click, not a drag.
      return state.editable ? 'grab' : 'pointer';
    };

    const parentWorld = (s: SceneJson, sel: NonNullable<Selection>): TransformJson => {
      if (sel.type === 'room') return IDENTITY;
      if (sel.type === 'furniture') {
        const table = s.furniture.find((f) => f.id === sel.id);
        return s.rooms.find((r) => r.id === table?.roomId)?.transform ?? IDENTITY;
      }
      const seat = s.seats.find((x) => x.id === sel.id);
      const room = s.rooms.find((r) => r.id === seat?.roomId);
      if (!room) return IDENTITY;
      const table = seat?.tableId ? s.furniture.find((f) => f.id === seat.tableId) : undefined;
      return table ? composeTransform(room.transform, table.transform) : room.transform;
    };

    // World metres pushed back into the entity's own local space. Every transform in the
    // model is local to its parent, so skipping this looks right until something sits in
    // a rotated room, at which point dragging sends it off at an angle.
    const toLocal = (s: SceneJson, sel: NonNullable<Selection>, world: THREE.Vector2) => {
      const p = applyTransform(invertTransform(parentWorld(s, sel)), { x: world.x, y: world.y });
      return new THREE.Vector2(p.x, p.y);
    };

    /**
     * Resize a shape from a grip dragged to `p`, expressed in the shape's own frame.
     *
     * <p>Snapping applies to the resulting DIMENSION, not to the grip position: an admin
     * sizing a room wants a 12.00m wall, and snapping the grip to the grid gives
     * 11.97m whenever the room's centre is off-grid.
     */
    const resizedShape = (shape: ShapeJson, index: number, p: THREE.Vector2): ShapeJson => {
      const { gridSnap, snapEnabled } = useEditorStore.getState();
      const min = 0.2;
      const fit = (v: number) => Math.max(min, snapValue(Math.abs(v), gridSnap, snapEnabled));
      switch (shape.kind) {
        case 'RECT':
          // The grip is a corner, so its distance from the centre is the half-extent.
          return { kind: 'RECT', w: fit(p.x * 2), h: fit(p.y * 2) };
        case 'CIRCLE':
          return { kind: 'CIRCLE', r: fit(Math.hypot(p.x, p.y)) };
        case 'ELLIPSE':
          return index === 0
            ? { kind: 'ELLIPSE', rx: fit(p.x), ry: shape.ry }
            : { kind: 'ELLIPSE', rx: shape.rx, ry: fit(p.y) };
        default:
          return shape;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const state = useEditorStore.getState();
      const s = state.scene;
      if (!s) return;
      const world = toWorld(event);

      if (state.mode === 'PLAN' && state.tool !== 'SELECT' && state.editable) {
        switch (state.tool) {
          case 'ROOM_RECT':
            state.addRoom({ kind: 'RECT', w: 8, h: 6 }, world);
            return;
          case 'ROOM_CIRCLE':
            state.addRoom({ kind: 'CIRCLE', r: 3.5 }, world);
            return;
          case 'ROOM_POLY': {
            // The pen traces one vertex per click. Clicking the first point again closes
            // the outline, which is how every drawing tool people already know behaves.
            const pen = state.drawing;
            const p = { x: world.x, y: world.y };
            if (pen?.kind !== 'POLYGON') {
              state.startPolygon(p);
            } else if (
              pen.points.length >= 3 &&
              Math.hypot(p.x - pen.points[0]!.x, p.y - pen.points[0]!.y) < 0.4
            ) {
              state.commitPolygon();
            } else {
              state.addPolygonPoint(p);
            }
            return;
          }
          case 'TABLE_RECT':
          case 'TABLE_ROUND': {
            const room = roomAt(s, world);
            if (!room) return; // a table belongs to a room, so a click outside one does nothing
            const local = applyTransform(invertTransform(room.transform), { x: world.x, y: world.y });
            state.addTable(
              room.id,
              state.tool === 'TABLE_RECT' ? { kind: 'RECT', w: 2.4, h: 1.2 } : { kind: 'CIRCLE', r: 0.9 },
              local,
            );
            return;
          }
          case 'GATE': {
            const wall = nearestWall(s, world, 1.0);
            if (!wall) return;
            // Keep the gate clear of the corners: offsetT is its centre, so half its
            // width has to fit either side or the validator will reject it.
            const width = Math.min(1.2, wall.wallLength * 0.8);
            const half = width / 2 / wall.wallLength;
            const t = Math.min(1 - half, Math.max(half, wall.t));
            state.addGate(wall.roomId, wall.edgeIdx, t, width, 'DOOR');
            return;
          }
          case 'PARTITION': {
            // Both ends must meet the room boundary, so each click snaps to the nearest
            // wall rather than landing wherever the pointer happened to be.
            const wall = nearestWall(s, world, 1.5);
            if (!wall) return;
            const room = s.rooms.find((r) => r.id === wall.roomId);
            if (!room) return;
            const localPoint = applyTransform(invertTransform(room.transform), wall.point);
            if (state.drawing?.kind !== 'PARTITION') {
              state.startPartition(room.id, localPoint);
            } else if (state.drawing.roomId === room.id) {
              state.commitPartition(localPoint);
            }
            return;
          }
          default:
            return;
        }
      }

      // Pick the most SPECIFIC thing under the cursor, not the nearest. A seat sits on a
      // table which sits in a room, and all three are under the pointer at once; depth
      // order is a fragile way to choose between them, and the one the admin means is
      // always the innermost.
      // Grips win over everything: they sit on top of the entity they belong to, and a
      // click on one is never meant for the shape underneath.
      graph?.updateMatrixWorld(true);
      const gripHit = graph
        ? raycaster.intersectObjects(graph.children, true)
            .find((h) => (h.object.userData as { handle?: HandleData }).handle)
        : undefined;
      if (gripHit && state.editable) {
        const handle = (gripHit.object.userData as { handle: HandleData }).handle;
        dragRef.current = { mode: 'handle', handle, parent: parentWorld(s, handle.selection) };
        state.beginDrag();
        renderer.domElement.setPointerCapture(event.pointerId);
        return;
      }

      const specificity = { seat: 0, furniture: 1, room: 2 } as const;
      // Raycasting reads matrixWorld, which three.js refreshes during render. A graph
      // rebuilt since the last frame still carries identity matrices, so every room
      // tests as if it sat at the origin: clicks land on whichever room happens to
      // overlap the origin and nothing else is hit at all.
      graph?.updateMatrixWorld(true);
      const hits = graph ? raycaster.intersectObjects(graph.children, true) : [];
      const picked = hits
        .filter((h) => (h.object.userData as { pick?: PickData }).pick)
        .sort((a, b) => {
          const pa = (a.object.userData as { pick: PickData }).pick.selection.type;
          const pb = (b.object.userData as { pick: PickData }).pick.selection.type;
          return specificity[pa] - specificity[pb] || a.distance - b.distance;
        })[0];
      if (!picked) {
        state.setSelection(null);
        return;
      }
      const pick = (picked.object.userData as { pick: PickData }).pick;
      state.setSelection(pick.selection);
      if (state.view === '3D') return; // 3D is for review, not authoring

      if (state.mode === 'BOOK') {
        return; // booking selects a seat; it never moves one
      }
      // A published layout is a record of what people are booking against, not a
      // scratchpad. Letting it drag would move it on screen and then lose the move,
      // because the save is gated on exactly this condition.
      if (!state.editable) return;

      const local = toLocal(s, pick.selection, world);
      dragRef.current = {
        mode: 'move',
        selection: pick.selection,
        offset: new THREE.Vector2(local.x - pick.local.x, local.y - pick.local.y),
      };
      state.beginDrag();
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const state = useEditorStore.getState();
      const s = state.scene;
      if (!s) return;
      const world = toWorld(event);
      const drag = dragRef.current;

      if (!drag) {
        // Nothing on a canvas announces itself as draggable the way a button announces
        // itself as clickable. The cursor is the only affordance there is, so it has to
        // say which of the three things is true here: draw, grab, or look.
        renderer.domElement.style.cursor = hoverCursor(state);
        // Only track the cursor while a stroke is open; otherwise every mouse move would
        // rebuild the scene graph for nothing.
        if (state.drawing) state.setCursor({ x: world.x, y: world.y });
        return;
      }
      renderer.domElement.style.cursor = 'grabbing';

      if (drag.mode === 'handle') {
        const { handle, parent } = drag;
        if (handle.kind === 'rotate') {
          // The grip starts directly above the entity, so the angle to it IS the heading
          // once the quarter turn is taken back out.
          const inParent = applyTransform(invertTransform(parent), { x: world.x, y: world.y });
          const angle = Math.atan2(inParent.y - handle.local.y, inParent.x - handle.local.x) - Math.PI / 2;
          state.rotateEntity(handle.selection, angle);
        } else {
          const entityWorld = composeTransform(parent, handle.local);
          const inEntity = applyTransform(invertTransform(entityWorld), { x: world.x, y: world.y });
          state.resizeShape(
            handle.selection,
            resizedShape(handle.shape, handle.index, new THREE.Vector2(inEntity.x, inEntity.y)),
          );
        }
        return;
      }

      // Walls and table edges pull the drag before the grid does, because a table is
      // meant to sit against a wall and the wall is rarely on a 0.25m grid.
      const snapped = state.snapEnabled
        ? snapToGeometry(s, { x: world.x, y: world.y }, drag.selection.id)
        : { point: { x: world.x, y: world.y }, guides: [] };
      guidesRef.current = snapped.guides;

      const local = toLocal(s, drag.selection, new THREE.Vector2(snapped.point.x, snapped.point.y));
      state.moveEntity(drag.selection, local.x - drag.offset.x, local.y - drag.offset.y);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      renderer.domElement.style.cursor = 'grab';
      guidesRef.current = [];
      // Ending the drag re-arms history, so the whole gesture is ONE undo step rather
      // than one per pointer move.
      useEditorStore.getState().endDrag();
      renderer.domElement.releasePointerCapture?.(event.pointerId);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);

    // Rebuild the graph whenever anything it depends on changes. At this scale that is a
    // fraction of a millisecond, and it keeps the renderer a pure function of the store.
    let lastKey = '';
    const rebuild = () => {
      const { scene: s, selection, violations, view, drawing, cursor, mode, occupancy } =
        useEditorStore.getState();

      // No scene means an empty floor, which is a state to DRAW rather than to skip.
      // Returning early here leaves the previous floor's rooms on screen, so switching
      // to a brand-new floor shows someone else's layout under an "empty floor" panel.
      if (!s) {
        if (graph) {
          scene.remove(graph);
          disposeGraph(graph);
          graph = null;
        }
        lastKey = 'empty';
        return;
      }
      const key = [
        s.planVersionId,
        s.revision,
        view,
        selection ? `${selection.type}:${selection.id}` : '-',
        violations.length,
        // Positions change without the revision changing, so the graph must follow them.
        s.rooms.length, s.furniture.length, s.seats.length,
        s.seats.map((x) => `${x.localTransform.x.toFixed(4)},${x.localTransform.y.toFixed(4)},${x.localTransform.rot.toFixed(4)},${x.override ? 1 : 0}`).join('|'),
        s.furniture.map((f) => `${f.transform.x},${f.transform.y},${f.transform.rot},${JSON.stringify(f.shape)}`).join('|'),
        s.rooms.map((r) => `${r.transform.x},${r.transform.y},${r.transform.rot},${JSON.stringify(r.shape)},${r.gates.length},${r.partitions.length},${(r.subZones ?? []).length}`).join('|'),
        mode,
        // Seat colour follows occupancy, so the graph must rebuild when it changes.
        Object.entries(occupancy).map(([k, v]) => `${k}:${v}`).join(','),
        JSON.stringify(drawing),
        drawing ? JSON.stringify(cursor) : '-',
        JSON.stringify(guidesRef.current),
      ].join('#');
      if (key === lastKey) return;
      lastKey = key;

      if (graph) {
        scene.remove(graph);
        disposeGraph(graph);
      }
      const invalid = new Set(
        violations.filter((v) => v.entityId).map((v) => v.entityId as string),
      );
      graph = buildSceneGraph(s, {
        selection,
        mode,
        occupancy,
        invalidIds: invalid,
        view,
        drawing,
        cursor,
        snapGuides: guidesRef.current,
        // Grips are sized in world metres, so they have to shrink as the view zooms in.
        handleScale: orthoSpan / ortho.zoom / 42,
      });
      scene.add(graph);

      if (!framed) {
        framed = true;
        frameToContent(s);
      }


      if (view === '3D' && camera !== perspective) {
        camera = perspective;
        controls.dispose();
        controls = new OrbitControls(perspective, renderer.domElement);
        controls.target.set(6, 4, 0);
        controls.enableDamping = true;
        controls.update();
      } else if (view === '2D' && camera !== ortho) {
        camera = ortho;
        controls.dispose();
        controls = new OrbitControls(ortho, renderer.domElement);
        controls.enableRotate = false;
        controls.target.set(6, 4, 0);
        controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
        controls.update();
      }
    };

    const unsubscribe = useEditorStore.subscribe(rebuild);
    rebuild();

    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      controls.dispose();
      if (graph) disposeGraph(graph);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={host} style={{ position: 'absolute', inset: 0 }} />;
}
