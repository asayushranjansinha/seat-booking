import type {
  BuildingJson,
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; etag: string | null }> {
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

  async createDraft(floorId: string): Promise<SceneJson> {
    const { data } = await request<SceneJson>(`/api/floors/${floorId}/draft`, { method: 'POST' });
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

  async publish(planVersionId: string): Promise<PublishResultJson> {
    // A refusal is a complete answer carrying what is wrong, not an error to throw on.
    const { data } = await request<PublishResultJson>(
      `/api/plan-versions/${planVersionId}/publish`,
      { method: 'POST', allowStatuses: [409] },
    );
    return data;
  },
};
