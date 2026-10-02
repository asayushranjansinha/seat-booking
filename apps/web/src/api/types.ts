/** Wire shapes shared with the Spring API. Points travel as [x, y] tuples. */

export type Vec2Json = [number, number];

export type ShapeJson =
  | { kind: 'RECT'; w: number; h: number }
  | { kind: 'CIRCLE'; r: number }
  | { kind: 'ELLIPSE'; rx: number; ry: number }
  | { kind: 'POLYGON'; points: Vec2Json[] };

export interface TransformJson {
  x: number;
  y: number;
  rot: number;
}

export interface GateJson {
  id: string;
  wallEdgeIdx: number;
  offsetT: number;
  width: number;
  type: 'DOOR' | 'GATE' | 'EMERGENCY';
}

export interface PartitionJson {
  id: string;
  polyline: Vec2Json[];
  thickness: number;
}

/** Derived server-side from the partitions; never sent back. */
export interface SubZoneJson {
  index: number;
  name: string;
  area: number;
  ring: Vec2Json[];
}

export interface RoomJson {
  id: string;
  name: string;
  shape: ShapeJson;
  transform: TransformJson;
  height: number;
  hourlyRate: number | null;
  /** ROOM, or CABIN: a call room only managers and admins may book a seat in. */
  kind?: 'ROOM' | 'CABIN';
  partitions: PartitionJson[];
  gates: GateJson[];
  subZones?: SubZoneJson[];
}

export interface FurnitureJson {
  id: string;
  roomId: string;
  kind: 'TABLE' | 'DESK' | 'CABINET' | 'PLANT' | 'OTHER';
  label: string | null;
  shape: ShapeJson;
  transform: TransformJson;
  height: number;
}

/** The rule that generated a table's seats, stored so regeneration can reproduce it. */
export type PlacementJson =
  | { kind: 'PERIMETER_EVEN'; count: number; startOffset?: number; clearance: number }
  | { kind: 'EDGE_COUNTS'; counts: Record<string, number>; clearance: number }
  | { kind: 'RADIAL'; count: number; startAngle?: number; clearance: number }
  | { kind: 'MANUAL' };

export interface SeatJson {
  id: string;
  roomId: string;
  tableId: string | null;
  code: string;
  shape: ShapeJson;
  localTransform: TransformJson;
  placement: PlacementJson | null;
  seatIndex: number;
  override: boolean;
  bookable: boolean;
  hourlyRate: number | null;
}

export interface SceneJson {
  planVersionId: string;
  floorId: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  revision: number;
  rooms: RoomJson[];
  furniture: FurnitureJson[];
  seats: SeatJson[];
}

export interface ViolationJson {
  severity: 'ERROR' | 'WARNING';
  code: string;
  entityType: string;
  entityId: string | null;
  message: string;
}

export interface AffectedBookingJson {
  bookingId: string;
  seatCode: string;
  userEmail: string;
  startsAt: string;
  endsAt: string;
}

export interface PublishResultJson {
  published: boolean;
  violations: ViolationJson[];
  affectedBookings: AffectedBookingJson[];
  scene: SceneJson;
}

export interface SessionJson {
  accessToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: 'ADMIN' | 'MANAGER' | 'USER';
    organizationId: string;
  };
}

export interface BuildingJson {
  id: string;
  name: string;
  address: string | null;
  floors: Array<{
    id: string;
    name: string;
    level: number;
    publishedVersionId: string | null;
    draftVersionId: string | null;
  }>;
}

// ---------------------------------------------------------------------- booking (M2)

export type SeatStatus = 'FREE' | 'BOOKED' | 'MINE' | 'BLOCKED';

export interface SeatOccupancyJson {
  seatId: string;
  seatCode: string;
  status: SeatStatus;
  hourlyRate: number | null;
}

export interface OccupancyJson {
  floorId: string;
  from: string;
  to: string;
  seats: SeatOccupancyJson[];
}

export interface BookingJson {
  id: string;
  seatId: string;
  seatCode: string;
  roomName: string | null;
  userId: string;
  userEmail: string;
  startsAt: string;
  endsAt: string;
  status: 'CONFIRMED' | 'CANCELLED';
  cost: number;
}

// ---------------------------------------------------------------- meetings (M3)

export interface InviteJson {
  id: string;
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
}

export interface MeetingJson {
  id: string;
  tableId: string;
  tableLabel: string | null;
  roomName: string | null;
  title: string;
  agenda: string | null;
  startsAt: string;
  endsAt: string;
  organizerEmail: string;
  seatCount: number;
  seatCodes: string[];
  totalCost: number;
  invites: InviteJson[];
}

export interface InviteViewJson {
  meetingTitle: string;
  agenda: string | null;
  startsAt: string;
  endsAt: string;
  roomName: string;
  tableLabel: string;
  organizerEmail: string;
  yourEmail: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
}

// --------------------------------------------------------------- estate (buildings)

export interface FloorSummaryJson {
  id: string;
  name: string;
  level: number;
  publishedVersionId: string | null;
  draftVersionId: string | null;
  rooms: number;
  seats: number;
  liveBookings: number;
  publishedAt: string | null;
}

export interface BuildingSummaryJson {
  id: string;
  name: string;
  address: string | null;
  floors: FloorSummaryJson[];
}
