import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from './api';
import {
  AdminOverview,
  ConnectSession,
  PersistedSettings,
  TunnelRuntimeState,
  UserProfile,
  VpnNode,
} from './types';

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${Math.round(bytes || 0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  if (!bps || bps < 1024) return `${Math.round(bps || 0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatDuration(sec: number): string {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export const App: React.FC = () => {
  const [booting, setBooting] = useState(true);
  const [settings, setSettings] = useState<PersistedSettings>({
    apiUrl: 'http://10.77.0.1:8000',
    token: null,
    deviceUid: 'desk-local',
    deviceName: '3004-Desktop',
    selectedNodeId: null,
    launchAtStartup: false,
    autoConnect: true,
    tunnelMode: 'full',
  });

  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeNav, setActiveNav] = useState<'vpn' | 'admin'>('vpn');

  // Auth form states
  const [urlInput, setUrlInput] = useState('http://10.77.0.1:8000');
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [bootstrapMode, setBootstrapMode] = useState(false);
  const [serverOnline, setServerOnline] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Dashboard states
  const [nodes, setNodes] = useState<VpnNode[]>([]);
  const [pings, setPings] = useState<Record<string, number | null>>({});
  const [publicIp, setPublicIp] = useState('확인 중...');
  const [session, setSession] = useState<ConnectSession | null>(null);
  const [vpnState, setVpnState] = useState<TunnelRuntimeState>({
    connected: false,
    connecting: false,
    assignedIp: null,
    nodeName: null,
    connectedAt: null,
    rxBytes: 0,
    txBytes: 0,
    rxSpeedBps: 0,
    txSpeedBps: 0,
    toolMissing: false,
    lastError: null,
  });
  const [speedHistory, setSpeedHistory] = useState<number[]>(Array(24).fill(0));
  const [uptimeSec, setUptimeSec] = useState(0);
  const autoConnectTriggered = useRef(false);

  // Admin states
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [inviteMemo, setInviteMemo] = useState('');
  const [newNodeForm, setNewNodeForm] = useState({
    id: '',
    name: '',
    region: 'JP',
    country_flag: '🇯🇵',
    endpoint: '',
    subnet: '10.78.0.0/24',
    server_ip: '10.78.0.1',
    agent_url: '',
    agent_secret: '',
  });

  const patchSettings = useCallback(async (patch: Partial<PersistedSettings>) => {
    if (window.vpnDesktop) {
      const updated = await window.vpnDesktop.updateSettings(patch);
      setSettings(updated);
      return updated;
    }
    setSettings((prev) => ({ ...prev, ...patch }));
    return null;
  }, []);

  const refreshPublicIp = useCallback(async (apiUrl: string) => {
    if (window.vpnDesktop) {
      const ip = await window.vpnDesktop.fetchPublicIp(apiUrl);
      setPublicIp(ip);
      return;
    }
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      setPublicIp(data.ip);
    } catch {
      setPublicIp('조회 실패');
    }
  }, []);

  const probeHealth = useCallback(async (targetUrl: string) => {
    try {
      const h = await apiClient.checkHealth(targetUrl);
      setServerOnline(true);
      setBootstrapMode(Boolean(h.bootstrap_required));
      setNotice(
        h.bootstrap_required
          ? '첫 실행 감지됨: 사용할 관리자 아이디·비밀번호를 생성해 주세요.'
          : null
      );
    } catch {
      setServerOnline(false);
    }
  }, []);

  // Initial boot
  useEffect(() => {
    (async () => {
      let loaded = settings;
      if (window.vpnDesktop) {
        loaded = await window.vpnDesktop.getSettings();
        const st = await window.vpnDesktop.getVpnState();
        setVpnState(st);
      }
      setSettings(loaded);
      setUrlInput(loaded.apiUrl);
      await probeHealth(loaded.apiUrl);

      if (loaded.token) {
        try {
          const me = await apiClient.getMe(loaded.apiUrl, loaded.token);
          setUser(me.user);
        } catch {
          await patchSettings({ token: null });
        }
      }
      setBooting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to Electron tunnel state updates
  useEffect(() => {
    if (!window.vpnDesktop) return;
    const offState = window.vpnDesktop.onStateChange((s) => {
      setVpnState(s);
      setSpeedHistory((prev) => [...prev.slice(1), Math.round((s.rxSpeedBps || 0) / 1024)]);
    });
    return () => {
      offState();
    };
  }, []);

  // Uptime timer
  useEffect(() => {
    const id = setInterval(() => {
      if (vpnState.connected && vpnState.connectedAt) {
        setUptimeSec(Math.floor((Date.now() - vpnState.connectedAt) / 1000));
      } else {
        setUptimeSec(0);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [vpnState.connected, vpnState.connectedAt]);

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === settings.selectedNodeId) || nodes[0] || null;
  }, [nodes, settings.selectedNodeId]);

  const loadNodesAndPings = useCallback(
    async (apiUrl: string, token: string) => {
      const list = await apiClient.listNodes(apiUrl, token);
      setNodes(list);
      if (list.length > 0 && !settings.selectedNodeId) {
        await patchSettings({ selectedNodeId: list[0].id });
      }
      for (const n of list) {
        if (window.vpnDesktop) {
          const ms = await window.vpnDesktop.measurePing({
            host: n.host,
            apiUrl,
            isLocal: n.is_local,
          });
          setPings((prev) => ({ ...prev, [n.id]: ms }));
        }
      }
    },
    [patchSettings, settings.selectedNodeId]
  );

  const handleConnect = useCallback(
    async (overrideNode?: VpnNode) => {
      const target = overrideNode || selectedNode;
      if (!target || !settings.token) return;
      setNotice(null);
      try {
        const osPlat =
          vpnState.platform === 'win32'
            ? 'windows'
            : vpnState.platform === 'darwin'
            ? 'macos'
            : 'other';
        const issued = await apiClient.connect(settings.apiUrl, settings.token, {
          node_id: target.id,
          device_uid: settings.deviceUid,
          device_name: settings.deviceName,
          platform: osPlat,
          mode: settings.tunnelMode,
        });
        setSession(issued);
        if (window.vpnDesktop) {
          await window.vpnDesktop.connectTunnel({
            config: issued.config,
            assignedIp: issued.assigned_ip,
            nodeName: issued.node_name,
          });
        }
        setTimeout(() => refreshPublicIp(settings.apiUrl), 1800);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    },
    [
      refreshPublicIp,
      selectedNode,
      settings.apiUrl,
      settings.deviceName,
      settings.deviceUid,
      settings.token,
      settings.tunnelMode,
      vpnState.platform,
    ]
  );

  // Tray quick connect listener
  useEffect(() => {
    if (!window.vpnDesktop) return;
    return window.vpnDesktop.onTrayQuickConnect(() => {
      if (!vpnState.connected && user && selectedNode) {
        void handleConnect(selectedNode);
      }
    });
  }, [handleConnect, selectedNode, user, vpnState.connected]);

  // Load dashboard data once authenticated
  useEffect(() => {
    if (!user || !settings.token) return;
    void refreshPublicIp(settings.apiUrl);
    void loadNodesAndPings(settings.apiUrl, settings.token);
  }, [loadNodesAndPings, refreshPublicIp, settings.apiUrl, settings.token, user]);

  // Auto-connect on launch if enabled
  useEffect(() => {
    if (
      user &&
      nodes.length > 0 &&
      settings.autoConnect &&
      !vpnState.connected &&
      !autoConnectTriggered.current
    ) {
      autoConnectTriggered.current = true;
      void handleConnect(nodes.find((n) => n.id === settings.selectedNodeId) || nodes[0]);
    }
  }, [handleConnect, nodes, settings.autoConnect, settings.selectedNodeId, user, vpnState.connected]);

  const handleDisconnect = async () => {
    if (window.vpnDesktop) {
      await window.vpnDesktop.disconnectTunnel();
    }
    setTimeout(() => refreshPublicIp(settings.apiUrl), 1200);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setNotice(null);
    try {
      const cleanUrl = urlInput.trim();
      const resp = bootstrapMode
        ? await apiClient.bootstrap(cleanUrl, username.trim(), password)
        : authTab === 'register'
        ? await apiClient.register(cleanUrl, username.trim(), password, inviteCode.trim())
        : await apiClient.login(cleanUrl, username.trim(), password);

      await patchSettings({ apiUrl: cleanUrl, token: resp.access_token });
      setUser(resp.user);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    if (vpnState.connected && window.vpnDesktop) {
      await window.vpnDesktop.disconnectTunnel().catch(() => undefined);
    }
    await patchSettings({ token: null });
    setUser(null);
    autoConnectTriggered.current = false;
  };

  const loadAdminOverview = useCallback(async () => {
    if (!settings.token || user?.role !== 'admin') return;
    try {
      const data = await apiClient.getAdminOverview(settings.apiUrl, settings.token);
      setOverview(data);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }, [settings.apiUrl, settings.token, user?.role]);

  useEffect(() => {
    if (activeNav === 'admin') {
      void loadAdminOverview();
    }
  }, [activeNav, loadAdminOverview]);

  const sparklinePoints = useMemo(() => {
    const maxVal = Math.max(10, ...speedHistory);
    return speedHistory
      .map((val, idx) => {
        const x = (idx / (speedHistory.length - 1)) * 280;
        const y = 44 - (val / maxVal) * 38;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [speedHistory]);

  if (booting) {
    return <div className="auth-wrapper">삼천포(3004) VPN 불러오는 중...</div>;
  }

  if (!user) {
    return (
      <div className="auth-wrapper">
        <form className="auth-card" onSubmit={handleAuthSubmit}>
          <div className="brand-header">
            <div className="brand-badge">🛡️ SAMCHEONPO · 3004 VPN</div>
            <h1 style={{ fontSize: 25, fontWeight: 800 }}>삼천포(3004) VPN</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 6 }}>
              Windows · macOS · Mobile 통합 암호화 VPN 클라이언트
            </p>
          </div>

          <div className="field-group">
            <label>
              중앙 API 서버 주소{' '}
              <span style={{ color: serverOnline ? 'var(--emerald)' : 'var(--amber)' }}>
                ({serverOnline ? '● 연결됨' : '○ 확인 필요'})
              </span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="text-input"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="http://10.77.0.1:8000"
              />
              <button
                type="button"
                className="ghost-btn"
                onClick={() => probeHealth(urlInput)}
              >
                점검
              </button>
            </div>
          </div>

          {!bootstrapMode && (
            <div className="tab-strip">
              <button
                type="button"
                className={`tab-btn ${authTab === 'login' ? 'active' : ''}`}
                onClick={() => setAuthTab('login')}
              >
                로그인
              </button>
              <button
                type="button"
                className={`tab-btn ${authTab === 'register' ? 'active' : ''}`}
                onClick={() => setAuthTab('register')}
              >
                초대코드 가입
              </button>
            </div>
          )}

          <div className="field-group">
            <label>아이디</label>
            <input
              className="text-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="field-group">
            <label>비밀번호</label>
            <input
              type="password"
              className="text-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {!bootstrapMode && authTab === 'register' && (
            <div className="field-group">
              <label>초대코드 (관리자 발급)</label>
              <input
                className="text-input"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="3004-XXXX-XXXX"
                required
              />
            </div>
          )}

          {notice && (
            <div style={{ color: 'var(--amber)', fontSize: 12.5, marginBottom: 14 }}>{notice}</div>
          )}

          <button className="primary-btn" type="submit" disabled={authBusy}>
            {authBusy
              ? '연결 중...'
              : bootstrapMode
              ? '초기 관리자 계정 생성 및 시작'
              : authTab === 'register'
              ? '가입 후 바로 시작'
              : '로그인'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div style={{ padding: '0 10px 24px' }}>
            <div style={{ color: 'var(--emerald)', fontWeight: 800, fontSize: 18 }}>
              🛡️ 3004 VPN
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
              {user.username} ({user.role === 'admin' ? '관리자' : '멤버'})
            </div>
          </div>

          <button
            className={`nav-item ${activeNav === 'vpn' ? 'active' : ''}`}
            onClick={() => setActiveNav('vpn')}
          >
            ⚡ VPN 대시보드
          </button>

          {user.role === 'admin' && (
            <button
              className={`nav-item ${activeNav === 'admin' ? 'active' : ''}`}
              onClick={() => setActiveNav('admin')}
            >
              🛠️ 관리자 센터
            </button>
          )}
        </div>

        <button className="ghost-btn" onClick={handleLogout}>
          로그아웃
        </button>
      </aside>

      <main className="main-area">
        <header className="top-bar">
          <div>
            <h2 style={{ fontSize: 21, fontWeight: 800 }}>
              {activeNav === 'vpn' ? 'VPN 보안 연결' : '삼천포 VPN 관리자 센터'}
            </h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2 }}>
              창을 닫아도 메뉴바/시스템 트레이에 상주하며 연결을 유지합니다.
            </p>
          </div>

          <div className={`ip-pill ${vpnState.connected ? 'protected' : ''}`}>
            <span style={{ color: vpnState.connected ? 'var(--emerald)' : 'var(--amber)' }}>
              {vpnState.connected ? '● 보호됨' : '○ 일반망'}
            </span>
            <strong>공인 IP: {publicIp}</strong>
            <button
              className="ghost-btn"
              style={{ padding: '3px 8px' }}
              onClick={() => refreshPublicIp(settings.apiUrl)}
            >
              ↻
            </button>
          </div>
        </header>

        {notice && (
          <div
            className="glass-card"
            style={{
              marginBottom: 18,
              padding: '12px 16px',
              borderColor: 'rgba(245, 158, 11, 0.45)',
              color: '#fde68a',
              fontSize: 13,
            }}
          >
            {notice}
          </div>
        )}

        {activeNav === 'vpn' ? (
          <div className="dashboard-grid">
            {/* Left: Giant Power Ring */}
            <section className="glass-card power-zone">
              <button
                className={`power-ring ${
                  vpnState.connecting
                    ? 'connecting'
                    : vpnState.connected
                    ? 'connected'
                    : ''
                }`}
                disabled={vpnState.connecting}
                onClick={() =>
                  vpnState.connected ? handleDisconnect() : handleConnect()
                }
              >
                <span style={{ fontSize: 40, marginBottom: 6 }}>⏻</span>
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 16,
                    color: vpnState.connected ? 'var(--emerald)' : 'var(--text-main)',
                  }}
                >
                  {vpnState.connecting
                    ? '연결 처리 중...'
                    : vpnState.connected
                    ? '연결됨 (ON)'
                    : '클릭하여 연결'}
                </span>
                {vpnState.connected && (
                  <span style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
                    {formatDuration(uptimeSec)}
                  </span>
                )}
              </button>

              <div style={{ marginTop: 22, textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {selectedNode
                    ? `${selectedNode.country_flag} ${selectedNode.name}`
                    : '사용 가능한 노드 없음'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 4 }}>
                  {vpnState.assignedIp
                    ? `할당 내부 IP: ${vpnState.assignedIp}`
                    : selectedNode?.endpoint}
                </div>
              </div>

              {session && (
                <button
                  className="ghost-btn"
                  style={{ marginTop: 16 }}
                  onClick={() =>
                    window.vpnDesktop?.saveConfFile({
                      filename: `3004-VPN-${session.region}.conf`,
                      content: session.config,
                    })
                  }
                >
                  📥 .conf 프로필 파일 저장
                </button>
              )}
            </section>

            {/* Right: Server Selector + Traffic + Settings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <section className="glass-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700 }}>서버 노드 선택</h3>
                  <button
                    className="ghost-btn"
                    onClick={() =>
                      settings.token && loadNodesAndPings(settings.apiUrl, settings.token)
                    }
                  >
                    핑 새로고침
                  </button>
                </div>

                <div className="node-list">
                  {nodes.map((node) => {
                    const isSel = selectedNode?.id === node.id;
                    const ms = pings[node.id];
                    return (
                      <div
                        key={node.id}
                        className={`node-row ${isSel ? 'selected' : ''}`}
                        onClick={async () => {
                          await patchSettings({ selectedNodeId: node.id });
                          if (vpnState.connected) {
                            await handleConnect(node);
                          }
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>
                            {node.country_flag} {node.name}
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                            {node.region} · {node.host}
                          </div>
                        </div>
                        <span className="ping-tag">
                          {ms !== undefined && ms !== null ? `${ms} ms` : '대기'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="glass-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700 }}>실시간 속도 및 데이터</h3>
                  <svg width="140" height="28" viewBox="0 0 280 48">
                    <polyline
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="3"
                      points={sparklinePoints}
                    />
                  </svg>
                </div>
                <div className="speed-row">
                  <div className="stat-box">
                    <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>↓ 다운로드</div>
                    <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>
                      {formatSpeed(vpnState.rxSpeedBps)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2 }}>
                      누적 {formatBytes(vpnState.rxBytes)}
                    </div>
                  </div>
                  <div className="stat-box">
                    <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>↑ 업로드</div>
                    <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>
                      {formatSpeed(vpnState.txSpeedBps)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2 }}>
                      누적 {formatBytes(vpnState.txBytes)}
                    </div>
                  </div>
                </div>
              </section>

              <section className="glass-card" style={{ padding: '14px 20px' }}>
                <div className="toggle-row">
                  <span>컴퓨터 부팅 시 3004 VPN 자동 실행</span>
                  <input
                    type="checkbox"
                    checked={settings.launchAtStartup}
                    onChange={(e) => patchSettings({ launchAtStartup: e.target.checked })}
                  />
                </div>
                <div className="toggle-row">
                  <span>프로그램 시작 시 자동 VPN 재연결</span>
                  <input
                    type="checkbox"
                    checked={settings.autoConnect}
                    onChange={(e) => patchSettings({ autoConnect: e.target.checked })}
                  />
                </div>
                <div className="toggle-row">
                  <span>전체 트래픽 우회 (서버 공인 IP로 웹사이트 접속)</span>
                  <input
                    type="checkbox"
                    checked={settings.tunnelMode === 'full'}
                    onChange={(e) =>
                      patchSettings({ tunnelMode: e.target.checked ? 'full' : 'split' })
                    }
                  />
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Invite Generator */}
            <section className="glass-card">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
                가족·지인 초대코드 발급
              </h3>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  className="text-input"
                  placeholder="메모 (예: 동생 윈도우 노트북)"
                  value={inviteMemo}
                  onChange={(e) => setInviteMemo(e.target.value)}
                />
                <button
                  className="primary-btn"
                  style={{ width: 160 }}
                  onClick={async () => {
                    if (!settings.token) return;
                    const created = await apiClient.createInvite(
                      settings.apiUrl,
                      settings.token,
                      inviteMemo,
                      1
                    );
                    await navigator.clipboard.writeText(created.code).catch(() => undefined);
                    setInviteMemo('');
                    setNotice(`새 초대코드 생성 및 복사됨: ${created.code}`);
                    await loadAdminOverview();
                  }}
                >
                  + 초대코드 발급
                </button>
              </div>

              {overview && overview.invites.length > 0 && (
                <table className="table-list">
                  <thead>
                    <tr>
                      <th>초대코드</th>
                      <th>메모</th>
                      <th>사용 횟수</th>
                      <th>복사</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.invites.slice(0, 6).map((inv) => (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 700, color: 'var(--emerald)' }}>{inv.code}</td>
                        <td>{inv.memo || '-'}</td>
                        <td>
                          {inv.used_count} / {inv.max_uses}
                        </td>
                        <td>
                          <button
                            className="ghost-btn"
                            onClick={() => navigator.clipboard.writeText(inv.code)}
                          >
                            복사
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Devices Management */}
            <section className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>등록 기기 실시간 제어</h3>
                <button className="ghost-btn" onClick={loadAdminOverview}>
                  새로고침
                </button>
              </div>
              <table className="table-list">
                <thead>
                  <tr>
                    <th>사용자 / 기기</th>
                    <th>노드</th>
                    <th>VPN IP</th>
                    <th>상태</th>
                    <th>트래픽</th>
                    <th>제어</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.devices.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.username}</strong> · {d.device_name} ({d.platform})
                      </td>
                      <td>{d.node_name}</td>
                      <td>{d.assigned_ip}</td>
                      <td style={{ color: !d.enabled ? 'var(--danger)' : d.online ? 'var(--emerald)' : 'var(--text-dim)' }}>
                        {!d.enabled ? '일시차단' : d.online ? '● 온라인' : '오프라인'}
                      </td>
                      <td>
                        {formatBytes(d.rx_bytes)} / {formatBytes(d.tx_bytes)}
                      </td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="ghost-btn"
                          onClick={async () => {
                            if (!settings.token) return;
                            await apiClient.toggleDevice(settings.apiUrl, settings.token, d.id);
                            await loadAdminOverview();
                          }}
                        >
                          {d.enabled ? '정지' : '허용'}
                        </button>
                        <button
                          className="ghost-btn"
                          style={{ color: 'var(--danger)' }}
                          onClick={async () => {
                            if (!settings.token) return;
                            await apiClient.deleteDevice(settings.apiUrl, settings.token, d.id);
                            await loadAdminOverview();
                          }}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* Add Remote Oracle Node */}
            <section className="glass-card">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
                해외 클라우드 노드 등록 (Oracle Cloud 등)
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <input
                  className="text-input"
                  placeholder="노드 ID (예: jp-oracle-1)"
                  value={newNodeForm.id}
                  onChange={(e) => setNewNodeForm({ ...newNodeForm, id: e.target.value })}
                />
                <input
                  className="text-input"
                  placeholder="표시 이름 (예: 일본 · 오사카)"
                  value={newNodeForm.name}
                  onChange={(e) => setNewNodeForm({ ...newNodeForm, name: e.target.value })}
                />
                <input
                  className="text-input"
                  placeholder="Endpoint (공인IP:51820)"
                  value={newNodeForm.endpoint}
                  onChange={(e) => setNewNodeForm({ ...newNodeForm, endpoint: e.target.value })}
                />
                <input
                  className="text-input"
                  placeholder="에이전트 URL (http://IP:8000)"
                  value={newNodeForm.agent_url}
                  onChange={(e) => setNewNodeForm({ ...newNodeForm, agent_url: e.target.value })}
                />
                <input
                  className="text-input"
                  placeholder="에이전트 시크릿 키"
                  value={newNodeForm.agent_secret}
                  onChange={(e) => setNewNodeForm({ ...newNodeForm, agent_secret: e.target.value })}
                />
                <button
                  className="primary-btn"
                  onClick={async () => {
                    if (!settings.token) return;
                    await apiClient.addNode(settings.apiUrl, settings.token, newNodeForm);
                    setNotice(`새 노드 등록 완료: ${newNodeForm.name}`);
                    await loadAdminOverview();
                    await loadNodesAndPings(settings.apiUrl, settings.token);
                  }}
                >
                  해외 노드 추가
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
};
