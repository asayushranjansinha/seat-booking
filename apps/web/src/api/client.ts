import type {
  DemoAccountJson,
  BookingJson,
  BuildingSummaryJson,
  FloorSummaryJson,
  InviteViewJson,
  MeetingJson,
  BuildingJson,
  OccupancyJson,
  PublishResultJson,
  SceneJson,
  SessionJson,
  ViolationJson,
} from './types';

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8080';

/**
 * The access token lives in memory only.
 *
 * <p>Putting it in localStorage would make it readable by any script that gets onto the
 * page, which is the whole reason the long-lived credential is an httpOnly cookie. A
 * reload costs one silent /auth/refresh instead.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Called when the session is genuinely over, so the app can return to sign-in. */
let onAuthFailure: (() => void) | null = null;

export function setAuthFailureHandler(handler: (() => void) | null): void {
  onAuthFailure = handler;
}

/**
 * The in-flight refresh, shared by every request that needs one.
 *
 * <p>Refresh tokens ROTATE, and presenting one that has already been redeemed is treated
 * as theft and revokes the whole family. Several requests failing at once is ordinary —
 * the editor loads a scene and the occupancy together — so letting each start its own
 * refresh would mean the second replays a spent token and signs the person out entirely.
 * They all wait on one.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(`${BASE}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!response.ok) return false;
        const session = (await response.json()) as SessionJson;
        accessToken = session.accessToken;
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  ifMatch?: string;
  /** Set when the caller handles a non-2xx status itself rather than throwing. */
  allowStatuses?: number[];
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<{ data: T; etag: string | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.ifMatch) headers['If-Match'] = options.ifMatch;

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    // Required so the httpOnly refresh cookie is sent to /api/auth.
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const etag = response.headers.get('ETag');
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  // An access token lasts 15 minutes, so a tab left open will hit this. Refresh once and
  // replay the request, rather than making the person reload and lose what they were
  // doing. Auth endpoints are excluded or a failed refresh would recurse.
  if (
    response.status === 401 &&
    !isRetry &&
    !path.startsWith('/api/auth/') &&
    !path.startsWith('/api/invites/')
  ) {
    if (await refreshAccessToken()) {
      return request<T>(path, options, true);
    }
    setAccessToken(null);
    onAuthFailure?.();
  }

  if (!response.ok && !(options.allowStatuses ?? []).includes(response.status)) {
    const message =
      typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : `${response.status} ${response.statusText}`;
    throw new ApiError(response.status, message, parsed);
  }
  return { data: parsed as T, etag };
}

export const api = {
  /**
   * Accounts a demo can sign in as, or nothing.
   *
   * <p>The server answers this only while it is running on the development secret, so a
   * real deployment returns 404 and the page falls back to showing no list at all. The
   * failure is swallowed deliberately: an absent list is the CORRECT state in production,
   * not an error worth telling anyone about.
   */
  async demoAccounts(): Promise<DemoAccountJson[]> {
    try {
      const { data } = await request<DemoAccountJson[]>('/api/auth/demo-accounts');
      return data;
    } catch {
      return [];
    }
  },

  async login(email: string, password: string): Promise<SessionJson> {
    const { data } = await request<SessionJson>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setAccessToken(data.accessToken);
    return data;
  },

  /** Restores a session from the httpOnly refresh cookie after a reload. */
  async refresh(): Promise<SessionJson | null> {
    try {
      const { data } = await request<SessionJson>('/api/auth/refresh', { method: 'POST' });
      setAccessToken(data.accessToken);
      return data;
    } catch {
      setAccessToken(null);
      return null;
    }
  },

  async logout(): Promise<void> {
    await request<null>('/api/auth/logout', { method: 'POST' });
    setAccessToken(null);
  },

  async buildings(): Promise<BuildingJson[]> {
    const { data } = await request<BuildingJson[]>('/api/buildings');
    return data;
  },

  async scene(planVersionId: string): Promise<{ scene: SceneJson; etag: string | null }> {
    const { data, etag } = await request<SceneJson>(`/api/plan-versions/${planVersionId}/scene`);
    return { scene: data, etag };
  },

  async publishedScene(floorId: string): Promise<{ scene: SceneJson; etag: string | null }> {
    const { data, etag } = await request<SceneJson>(`/api/floors/${floorId}/published`);
    return { scene: data, etag };
  },

  /**
   * Start a draft on a floor.
   *
   * <p>`fromFloorId` copies another floor's layout into it instead of starting from this
   * floor's own published version. The server refuses if the floor already has a draft,
   * rather than overwriting unpublished work.
   */
  async createDraft(floorId: string, fromFloorId?: string): Promise<SceneJson> {
    // Typed as a string, but this is handed to onClick in places and a React event is
    // truthy — it would go up the wire as "[object Object]" and come back a 400.
    const query = typeof fromFloorId === 'string' && fromFloorId !== ''
      ? `?from=${encodeURIComponent(fromFloorId)}`
      : '';
    const { data } = await request<SceneJson>(
      `/api/floors/${floorId}/draft${query}`, { method: 'POST' },
    );
    return data;
  },

  async saveScene(
    planVersionId: string,
    scene: SceneJson,
    etag: string | null,
  ): Promise<{ scene: SceneJson; etag: string | null }> {
    const { data, etag: next } = await request<SceneJson>(
      `/api/plan-versions/${planVersionId}/scene`,
      { method: 'PUT', body: scene, ifMatch: etag ?? undefined },
    );
    return { scene: data, etag: next };
  },

  async validate(planVersionId: string): Promise<ViolationJson[]> {
    const { data } = await request<ViolationJson[]>(
      `/api/plan-versions/${planVersionId}/validate`,
      { method: 'POST' },
    );
    return data;
  },

  async occupancy(floorId: string, from: Date, to: Date): Promise<OccupancyJson> {
    const query = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    const { data } = await request<OccupancyJson>(`/api/floors/${floorId}/occupancy?${query}`);
    return data;
  },

  async book(seatId: string, from: Date, to: Date): Promise<BookingJson> {
    const { data } = await request<BookingJson>('/api/bookings', {
      method: 'POST',
      body: { seatId, startsAt: from.toISOString(), endsAt: to.toISOString() },
    });
    return data;
  },

  async myBookings(): Promise<BookingJson[]> {
    const { data } = await request<BookingJson[]>('/api/bookings/mine');
    return data;
  },

  async cancelBooking(id: string): Promise<BookingJson> {
    const { data } = await request<BookingJson>(`/api/bookings/${id}`, { method: 'DELETE' });
    return data;
  },

  /**
   * Live occupancy deltas.
   *
   * <p>EventSource cannot carry an Authorization header, so the stream endpoint is
   * floor-scoped and carries no personal data: it says only that some seat changed, and
   * the client re-reads occupancy through the authenticated endpoint to find out how.
   */
  subscribeToOccupancy(floorId: string, onChange: () => void): () => void {
    const source = new EventSource(`${BASE}/api/floors/${floorId}/occupancy/stream`);
    source.addEventListener('seat-changed', onChange);
    source.onerror = () => {
      // EventSource reconnects by itself; this is here so a dropped connection is not
      // mistaken for a dead one during development.
      if (source.readyState === EventSource.CLOSED) onChange();
    };
    return () => source.close();
  },

  async createMeeting(input: {
    tableId: string;
    title: string;
    agenda: string;
    startsAt: Date;
    endsAt: Date;
    inviteEmails: string[];
  }): Promise<MeetingJson> {
    const { data } = await request<MeetingJson>('/api/meetings', {
      method: 'POST',
      body: {
        tableId: input.tableId,
        title: input.title,
        agenda: input.agenda,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        inviteEmails: input.inviteEmails,
      },
    });
    return data;
  },

  async myMeetings(): Promise<MeetingJson[]> {
    const { data } = await request<MeetingJson[]>('/api/meetings/mine');
    return data;
  },

  /** Unauthenticated: an invitee may have no account, and the token is the credential. */
  async viewInvite(token: string): Promise<InviteViewJson> {
    const { data } = await request<InviteViewJson>(`/api/invites/${token}`);
    return data;
  },

  async respondToInvite(token: string, reply: 'accept' | 'decline'): Promise<InviteViewJson> {
    const { data } = await request<InviteViewJson>(
      `/api/invites/${token}/respond?reply=${reply}`,
      { method: 'POST' },
    );
    return data;
  },

  // --- buildings and floors (admin) ---

  async estate(): Promise<BuildingSummaryJson[]> {
    const { data } = await request<BuildingSummaryJson[]>('/api/estate');
    return data;
  },

  async createBuilding(name: string, address: string): Promise<BuildingSummaryJson> {
    const { data } = await request<BuildingSummaryJson>('/api/estate/buildings', {
      method: 'POST',
      body: { name, address },
    });
    return data;
  },

  async updateBuilding(id: string, name: string, address: string): Promise<BuildingSummaryJson> {
    const { data } = await request<BuildingSummaryJson>(`/api/estate/buildings/${id}`, {
      method: 'PATCH',
      body: { name, address },
    });
    return data;
  },

  async deleteBuilding(id: string): Promise<void> {
    await request<null>(`/api/estate/buildings/${id}`, { method: 'DELETE' });
  },

  async createFloor(buildingId: string, name: string, level: number): Promise<FloorSummaryJson> {
    const { data } = await request<FloorSummaryJson>(`/api/estate/buildings/${buildingId}/floors`, {
      method: 'POST',
      body: { name, level },
    });
    return data;
  },

  async updateFloor(id: string, name: string, level: number): Promise<FloorSummaryJson> {
    const { data } = await request<FloorSummaryJson>(`/api/estate/floors/${id}`, {
      method: 'PATCH',
      body: { name, level },
    });
    return data;
  },

  async deleteFloor(id: string): Promise<void> {
    await request<null>(`/api/estate/floors/${id}`, { method: 'DELETE' });
  },

  async discardDraft(floorId: string): Promise<void> {
    await request<null>(`/api/estate/floors/${floorId}/draft`, { method: 'DELETE' });
  },

  async publish(planVersionId: string): Promise<PublishResultJson> {
    // A refusal is a complete answer carrying what is wrong, not an error to throw on.
    const { data } = await request<PublishResultJson>(
      `/api/plan-versions/${planVersionId}/publish`,
      { method: 'POST', allowStatuses: [409] },
    );
    return data;
  },
};
