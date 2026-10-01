import type { Transform, Vec2 } from './types';

/**
 * Compose a child's local transform with its parent's. This is the whole trick: a seat
 * stores its position in table-local space, so rotating the table changes one transform
 * and every seat follows. No seat record is rewritten, so nothing can drift.
 */
export function composeTransform(parent: Transform, child: Transform): Transform {
  const c = Math.cos(parent.rot);
  const s = Math.sin(parent.rot);
  return {
    x: parent.x + c * child.x - s * child.y,
    y: parent.y + s * child.x + c * child.y,
    rot: parent.rot + child.rot,
  };
}

export function applyTransform(t: Transform, p: Vec2): Vec2 {
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  return { x: t.x + c * p.x - s * p.y, y: t.y + s * p.x + c * p.y };
}

export function invertTransform(t: Transform): Transform {
  const c = Math.cos(-t.rot);
  const s = Math.sin(-t.rot);
  return {
    x: -(c * t.x - s * t.y),
    y: -(s * t.x + c * t.y),
    rot: -t.rot,
  };
}

/** Compose a chain root-first: floor -> room -> table -> seat. */
export function composeChain(chain: readonly Transform[]): Transform {
  return chain.reduce(composeTransform, { x: 0, y: 0, rot: 0 });
}
