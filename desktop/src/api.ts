import { AdminOverview, ConnectSession, UserProfile, VpnNode } from './types';

export function normalizeServerUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');
  if (!s) return 'http://10.77.0.1:8000';
  if (!/^https?:\/\//i.test(s)) {
    // trycloudflare or domain defaults to https, private IP defaults to http
    const isPrivateIp = /^(10\.|192\.168\.|127\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(s);
    s = `${isPrivateIp ? 'http' : 'https'}://${s}`;
  }
  return s;
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
  token?: string | null,
  timeoutMs = 6000
): Promise<T> {
  const normalizedBase = normalizeServerUrl(baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${normalizedBase}${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isInternalAddr = normalizedBase.includes('10.77.0.1');
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(
        isInternalAddr
          ? '응답 시간 초과: 아직 VPN 연결 전이므로 [서버 설정]에 외부 주소(https://...trycloudflare.com)를 입력해 주세요.'
          : `서버 응답 시간 초과 (${normalizedBase}) — 주소를 다시 확인해 주세요.`
      );
    }
    throw new Error(
      isInternalAddr
        ? '내부 주소(10.77.0.1)에 닿을 수 없습니다. [서버 설정]에 외부 주소(https://...trycloudflare.com)를 입력해 주세요.'
        : `서버에 연결할 수 없습니다 (${normalizedBase}).`
    );
  }

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
  checkHealth: async (baseUrl: string) => {
    const t0 = performance.now();
    const data = await requestJson<{ status: string; bootstrap_required: boolean }>(
      baseUrl,
      '/api/v1/health',
      {},
      null,
      3500
    );
    const rttMs = Math.max(1, Math.round(performance.now() - t0));
    return { ...data, rttMs, normalizedUrl: normalizeServerUrl(baseUrl) };
  },

  bootstrap: (baseUrl: string, username: string, password: string) =>
    requestJson<{ access_token: string; user: UserProfile }>(
      baseUrl,
      '/api/v1/auth/bootstrap',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      },
      null,
      7000
    ),

  register: (baseUrl: string, username: string, password: string, inviteCode: string) =>
    requestJson<{ access_token: string; user: UserProfile }>(
      baseUrl,
      '/api/v1/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ username, password, invite_code: inviteCode }),
      },
      null,
      7000
    ),

  login: (baseUrl: string, username: string, password: string) =>
    requestJson<{ access_token: string; user: UserProfile }>(
      baseUrl,
      '/api/v1/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      },
      null,
      7000
    ),

  changePassword: (
    baseUrl: string,
    token: string,
    currentPassword: string,
    newPassword: string
  ) =>
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
    requestJson<{ user: UserProfile }>(baseUrl, '/api/v1/me', {}, token, 5000),

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
      token,
      8000
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
