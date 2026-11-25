import { AdminOverview, ConnectSession, MyDeviceItem, UserProfile, VpnNode } from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

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
  timeoutMs = 9000
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
      throw new ApiError(
        isInternalAddr
          ? '응답 시간 초과: 아직 VPN 연결 전이므로 [서버 설정]에 외부 주소(https://...trycloudflare.com)를 입력해 주세요.'
          : `서버 응답 시간 초과 (${normalizedBase}) — 네트워크 상태나 주소를 확인해 주세요.`,
        0
      );
    }
    throw new ApiError(
      isInternalAddr
        ? '내부 주소(10.77.0.1)에 닿을 수 없습니다. [서버 설정]에 외부 주소(https://...trycloudflare.com)를 입력해 주세요.'
        : `서버에 연결할 수 없습니다 (${normalizedBase}).`,
      0
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
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

export const apiClient = {
  checkHealth: async (baseUrl: string) => {
    const t0 = performance.now();
    let data: { status: string; bootstrap_required: boolean };
    try {
      data = await requestJson<{ status: string; bootstrap_required: boolean }>(
        baseUrl,
        '/api/v1/health',
        {},
        null,
        7500
      );
    } catch (firstErr) {
      // One automatic retry on transient network/DNS wakeup blip
      if (firstErr instanceof ApiError && firstErr.status === 0) {
        await new Promise((r) => setTimeout(r, 700));
        data = await requestJson<{ status: string; bootstrap_required: boolean }>(
          baseUrl,
          '/api/v1/health',
          {},
          null,
          7500
        );
      } else {
        throw firstErr;
      }
    }
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
    requestJson<{ user: UserProfile; devices?: MyDeviceItem[] }>(baseUrl, '/api/v1/me', {}, token, 6000),

  listMyDevices: async (baseUrl: string, token: string): Promise<MyDeviceItem[]> => {
    try {
      return await requestJson<MyDeviceItem[]>(baseUrl, '/api/v1/my-devices', {}, token, 6000);
    } catch (err) {
      // Graceful fallback for older Raspberry Pi backend before pull
      if (err instanceof ApiError && err.status === 404) {
        const me = await requestJson<{ user: UserProfile; devices?: MyDeviceItem[] }>(
          baseUrl,
          '/api/v1/me',
          {},
          token,
          6000
        );
        return (me.devices || []).map((d) => ({
          ...d,
          enabled: Boolean(d.enabled),
          online: Boolean(d.online),
          rx_bytes: d.rx_bytes ?? 0,
          tx_bytes: d.tx_bytes ?? 0,
        }));
      }
      throw err;
    }
  },

  deleteMyDevice: (baseUrl: string, token: string, deviceId: number) =>
    requestJson<{ id: number; deleted: boolean }>(
      baseUrl,
      `/api/v1/my-devices/${deviceId}`,
      { method: 'DELETE' },
      token
    ),

  updateUserRole: (baseUrl: string, token: string, userId: number, role: 'admin' | 'member') =>
    requestJson<{ id: number; username: string; role: 'admin' | 'member' }>(
      baseUrl,
      `/api/v1/admin/users/${userId}/role`,
      { method: 'POST', body: JSON.stringify({ role }) },
      token
    ),

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

  reconcilePeers: (baseUrl: string, token: string) =>
    requestJson<{ managed_count: number; removed_conf_peers: number; removed_live_peers: number }>(
      baseUrl,
      '/api/v1/admin/reconcile',
      { method: 'POST' },
      token
    ),
};
