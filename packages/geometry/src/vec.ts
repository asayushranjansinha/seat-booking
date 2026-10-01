import type { Vec2 } from './types';

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const length = (a: Vec2): number => Math.sqrt(a.x * a.x + a.y * a.y);

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/**
 * Outward normal of a directed edge on a CCW ring. The interior is to the left of the
 * edge direction, so the outward side is to the right: (dy, -dx).
 */
export function outwardNormal(d: Vec2): Vec2 {
  const u = normalize(d);
  return { x: u.y, y: -u.x };
}
