'use client';

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useEffect, useRef } from 'react';
import { applyTransform, composeTransform, invertTransform } from '@seat-booking/geometry';
import { useEditorStore, type Selection } from '@/state/editorStore';
import type { SceneJson, TransformJson } from '@/api/types';
import { buildSceneGraph, disposeGraph, type PickData } from './sceneGraph';
import { ringFor } from './shapeToThree';

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
  const dragRef = useRef<{ selection: NonNullable<Selection>; offset: THREE.Vector2 } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0f1115, 1);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(8, -10, 14);
    scene.add(sun);

    const grid = new THREE.GridHelper(200, 800, 0x262c36, 0x1b2029);
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

    const onPointerDown = (event: PointerEvent) => {
      const state = useEditorStore.getState();
      const s = state.scene;
      if (!s) return;
      const world = toWorld(event);

      if (state.tool !== 'SELECT') {
        if (state.tool === 'ROOM_RECT') state.addRoom({ kind: 'RECT', w: 8, h: 6 }, world);
        else if (state.tool === 'ROOM_CIRCLE') state.addRoom({ kind: 'CIRCLE', r: 3.5 }, world);
        else {
          const room = s.rooms.find(
            (r) => Math.hypot(world.x - r.transform.x, world.y - r.transform.y) < 14,
          );
          if (room) {
            const local = applyTransform(invertTransform(room.transform), { x: world.x, y: world.y });
            state.addTable(
              room.id,
              state.tool === 'TABLE_RECT' ? { kind: 'RECT', w: 2.4, h: 1.2 } : { kind: 'CIRCLE', r: 0.9 },
              local,
            );
          }
        }
        return;
      }

      // Pick the most SPECIFIC thing under the cursor, not the nearest. A seat sits on a
      // table which sits in a room, and all three are under the pointer at once; depth
      // order is a fragile way to choose between them, and the one the admin means is
      // always the innermost.
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

      const local = toLocal(s, pick.selection, world);
      dragRef.current = {
        selection: pick.selection,
        offset: new THREE.Vector2(local.x - pick.local.x, local.y - pick.local.y),
      };
      state.beginDrag();
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const state = useEditorStore.getState();
      if (!state.scene) return;
      const local = toLocal(state.scene, drag.selection, toWorld(event));
      state.moveEntity(drag.selection, local.x - drag.offset.x, local.y - drag.offset.y);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!dragRef.current) return;
      dragRef.current = null;
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
      const { scene: s, selection, violations, view } = useEditorStore.getState();
      if (!s) return;
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
        s.rooms.map((r) => `${r.transform.x},${r.transform.y},${r.transform.rot},${JSON.stringify(r.shape)}`).join('|'),
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
      graph = buildSceneGraph(s, selection, invalid, view);
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
