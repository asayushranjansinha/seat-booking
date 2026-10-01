/**
 * Wire format <-> domain model.
 *
 * On the wire (fixtures, API DTOs, JSONB columns) a point is the compact tuple [x, y],
 * which keeps rings cheap to store and is the single representation shared with the Java
 * side. In the domain model a point is a `Vec2` object, which is far more readable in the
 * geometry code. The conversion is explicit and lives only here.
 */
import type { Ring, Shape, Vec2 } from './types';

export type Vec2Json = readonly [number, number];

export interface ShapeJson {
  readonly kind: string;
  readonly w?: number;
  readonly h?: number;
  readonly r?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly points?: readonly Vec2Json[];
}

export const vec2FromJson = (p: Vec2Json): Vec2 => ({ x: p[0], y: p[1] });
export const vec2ToJson = (p: Vec2): Vec2Json => [p.x, p.y];

export const ringFromJson = (pts: readonly Vec2Json[]): Ring => pts.map(vec2FromJson);
export const ringToJson = (ring: Ring): Vec2Json[] => ring.map(vec2ToJson);

export function shapeFromJson(json: ShapeJson): Shape {
  switch (json.kind) {
    case 'RECT':
      return { kind: 'RECT', w: json.w!, h: json.h! };
    case 'CIRCLE':
      return { kind: 'CIRCLE', r: json.r! };
    case 'ELLIPSE':
      return { kind: 'ELLIPSE', rx: json.rx!, ry: json.ry! };
    case 'POLYGON':
      return { kind: 'POLYGON', points: (json.points ?? []).map(vec2FromJson) };
    default:
      throw new Error(`unsupported shape kind: ${json.kind}`);
  }
}

export function shapeToJson(shape: Shape): ShapeJson {
  switch (shape.kind) {
    case 'RECT':
      return { kind: 'RECT', w: shape.w, h: shape.h };
    case 'CIRCLE':
      return { kind: 'CIRCLE', r: shape.r };
    case 'ELLIPSE':
      return { kind: 'ELLIPSE', rx: shape.rx, ry: shape.ry };
    case 'POLYGON':
      return { kind: 'POLYGON', points: shape.points.map(vec2ToJson) };
  }
}
