/** All angles are radians. All lengths are metres. */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * A closed polygon stored WITHOUT a repeated final vertex, wound counter-clockwise.
 * For a CCW ring the interior lies to the left of each directed edge.
 */
export type Ring = readonly Vec2[];

export type Shape =
  | { readonly kind: 'RECT'; readonly w: number; readonly h: number }
  | { readonly kind: 'CIRCLE'; readonly r: number }
  | { readonly kind: 'ELLIPSE'; readonly rx: number; readonly ry: number }
  | { readonly kind: 'POLYGON'; readonly points: readonly Vec2[] };

/** A transform local to the parent element. Never an absolute world position. */
export interface Transform {
  readonly x: number;
  readonly y: number;
  readonly rot: number;
}

export const IDENTITY: Transform = { x: 0, y: 0, rot: 0 };

export type PlacementRule =
  | { readonly kind: 'PERIMETER_EVEN'; readonly count: number; readonly startOffset?: number }
  | { readonly kind: 'EDGE_COUNTS'; readonly counts: Readonly<Record<string, number>> }
  | { readonly kind: 'RADIAL'; readonly count: number; readonly startAngle?: number }
  | { readonly kind: 'MANUAL' };

/** A seat the admin has dragged. Its stored transform wins over the generated one. */
export interface SeatOverride {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly rot: number;
}

export interface PlaceSeatsRequest {
  readonly shape: Shape;
  /** Distance from the table outline to the seat centre. */
  readonly clearance: number;
  readonly rule: PlacementRule;
  readonly overrides?: readonly SeatOverride[];
  /** Tessellation tolerance in metres. Defaults to 1mm. */
  readonly tolerance?: number;
}

/** A seat position in TABLE-LOCAL space. `rot` points from the seat toward the table. */
export interface SeatPlacement {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly override: boolean;
}

export interface ArcSample {
  readonly point: Vec2;
  readonly tangent: Vec2;
  readonly outwardNormal: Vec2;
}
