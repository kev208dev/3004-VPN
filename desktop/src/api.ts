import { AdminOverview, ConnectSession, UserProfile, VpnNode } from './types';

function cleanBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${cleanBase(baseUrl)}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let detail = `서버 오류 (HTTP ${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody?.detail) detail = String(errBody.detail);
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const apiClient = {
  checkHealth: (baseUrl: string) =>
    requestJson<{ status: string; bootstrap_required: boolean }>(baseUrl, '/api/v1/health'),

  bootstrap: (baseUrl: string, username: string, password: string) =>
    requestJson<{ access_token: string; user: UserProfile }>(baseUrl, '/api/v1/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  register: (baseUrl: string, username: string, password: string, inviteCode: string) =>
    requestJson<{ access_token: string; user: UserProfile }>(baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, invite_code: inviteCode }),
    }),

  login: (baseUrl: string, username: string, password: string) =>
    requestJson<{ access_token: string; user: UserProfile }>(baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  changePassword: (baseUrl: string, token: string, currentPassword: string, newPassword: string) =>
    requestJson<{ ok: boolean }>(
      baseUrl,
      '/api/v1/auth/change-password',
      {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      },
      token
    ),

  getMe: (baseUrl: string, token: string) =>
    requestJson<{ user: UserProfile }>(baseUrl, '/api/v1/me', {}, token),

  listNodes: (baseUrl: string, token: string) =>
    requestJson<VpnNode[]>(baseUrl, '/api/v1/nodes', {}, token),

  connect: (
    baseUrl: string,
    token: string,
    payload: {
      node_id: string;
      device_uid: string;
      device_name: string;
      platform: 'windows' | 'macos' | 'linux' | 'other';
      mode: 'full' | 'split';
    }
  ) =>
    requestJson<ConnectSession>(
      baseUrl,
      '/api/v1/connect',
      { method: 'POST', body: JSON.stringify(payload) },
      token
    ),

  getAdminOverview: (baseUrl: string, token: string) =>
    requestJson<AdminOverview>(baseUrl, '/api/v1/admin/overview', {}, token),

  createInvite: (baseUrl: string, token: string, memo: string, maxUses = 1) =>
    requestJson<{ code: string }>(
      baseUrl,
      '/api/v1/admin/invites',
      { method: 'POST', body: JSON.stringify({ memo, max_uses: maxUses }) },
      token
    ),

  toggleDevice: (baseUrl: string, token: string, deviceId: number) =>
    requestJson<{ id: number; enabled: boolean }>(
      baseUrl,
      `/api/v1/admin/devices/${deviceId}/toggle`,
      { method: 'POST' },
      token
    ),

  deleteDevice: (baseUrl: string, token: string, deviceId: number) =>
    requestJson<{ id: number; deleted: boolean }>(
      baseUrl,
      `/api/v1/admin/devices/${deviceId}`,
      { method: 'DELETE' },
      token
    ),

  addNode: (baseUrl: string, token: string, payload: Record<string, unknown>) =>
    requestJson<{ id: string }>(
      baseUrl,
      '/api/v1/admin/nodes',
      { method: 'POST', body: JSON.stringify(payload) },
      token
    ),
};
