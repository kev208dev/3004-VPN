import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from './api';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrandShieldLogo,
  ChevronRightIcon,
  ConsoleIcon,
  CopyIcon,
  DownloadFileIcon,
  GlobeIcon,
  PowerGlyph,
  RefreshIcon,
  RegionCodeBadge,
  ServerGearIcon,
  ShieldCheckIcon,
  SignalBars,
  SlidersIcon,
  WinCloseIcon,
  WinMaxIcon,
  WinMinIcon,
} from './icons';
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

const SwitchToggle: React.FC<{ checked: boolean; onChange: (next: boolean) => void }> = ({
  checked,
  onChange,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    className={`switch ${checked ? 'on' : ''}`}
    onClick={() => onChange(!checked)}
  >
    <span className="switch-knob" />
  </button>
);

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
  const [nav, setNav] = useState<'connect' | 'servers' | 'settings' | 'admin'>('connect');

  // Auth states
  const [urlInput, setUrlInput] = useState('http://10.77.0.1:8000');
  const [showEndpointDrawer, setShowEndpointDrawer] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [bootstrapMode, setBootstrapMode] = useState(false);
  const [serverOnline, setServerOnline] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  // Toast feedback
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  // VPN runtime states
  const [nodes, setNodes] = useState<VpnNode[]>([]);
  const [pings, setPings] = useState<Record<string, number | null>>({});
  const [publicIp, setPublicIp] = useState('—');
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
  const [speedHistory, setSpeedHistory] = useState<number[]>(Array(28).fill(0));
  const [uptimeSec, setUptimeSec] = useState(0);
  const autoConnectDone = useRef(false);

  // Password change states
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');

  // Admin states
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [inviteMemo, setInviteMemo] = useState('');
  const [nodeModalOpen, setNodeModalOpen] = useState(false);
  const [newNodeForm, setNewNodeForm] = useState({
    id: '',
    name: '',
    region: 'JP',
    country_flag: 'JP',
    endpoint: '',
    subnet: '10.78.0.0/24',
    server_ip: '10.78.0.1',
    agent_url: '',
    agent_secret: '',
  });

  const isMac = vpnState.platform === 'darwin';

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

  const probeHealth = useCallback(
    async (targetUrl: string, quiet = false) => {
      try {
        const h = await apiClient.checkHealth(targetUrl);
        setServerOnline(true);
        setBootstrapMode(Boolean(h.bootstrap_required));
        setShowEndpointDrawer(false);
        if (!quiet) showToast('서버 연결이 확인되었습니다.');
      } catch {
        setServerOnline(false);
        setShowEndpointDrawer(true);
        if (!quiet) showToast('서버에 연결할 수 없습니다. 주소를 확인해 주세요.');
      }
    },
    [showToast]
  );

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
      await probeHealth(loaded.apiUrl, true);

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

  useEffect(() => {
    if (!window.vpnDesktop) return;
    return window.vpnDesktop.onStateChange((s) => {
      setVpnState(s);
      setSpeedHistory((prev) => [...prev.slice(1), Math.round((s.rxSpeedBps || 0) / 1024)]);
    });
  }, []);

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

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === settings.selectedNodeId) || nodes[0] || null,
    [nodes, settings.selectedNodeId]
  );

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
        setTimeout(() => refreshPublicIp(settings.apiUrl), 1600);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
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
      showToast,
      vpnState.platform,
    ]
  );

  useEffect(() => {
    if (!window.vpnDesktop) return;
    return window.vpnDesktop.onTrayQuickConnect(() => {
      if (!vpnState.connected && user && selectedNode) {
        void handleConnect(selectedNode);
      }
    });
  }, [handleConnect, selectedNode, user, vpnState.connected]);

  useEffect(() => {
    if (!user || !settings.token) return;
    void refreshPublicIp(settings.apiUrl);
    void loadNodesAndPings(settings.apiUrl, settings.token);
  }, [loadNodesAndPings, refreshPublicIp, settings.apiUrl, settings.token, user]);

  useEffect(() => {
    if (
      user &&
      nodes.length > 0 &&
      settings.autoConnect &&
      !vpnState.connected &&
      !autoConnectDone.current
    ) {
      autoConnectDone.current = true;
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
      showToast(err instanceof Error ? err.message : String(err));
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
    autoConnectDone.current = false;
  };

  const loadAdminOverview = useCallback(async () => {
    if (!settings.token || user?.role !== 'admin') return;
    try {
      const data = await apiClient.getAdminOverview(settings.apiUrl, settings.token);
      setOverview(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }, [settings.apiUrl, settings.token, showToast, user?.role]);

  useEffect(() => {
    if (nav === 'admin') void loadAdminOverview();
  }, [nav, loadAdminOverview]);

  const sparklinePath = useMemo(() => {
    const maxVal = Math.max(8, ...speedHistory);
    return speedHistory
      .map((v, i) => {
        const x = (i / (speedHistory.length - 1)) * 120;
        const y = 26 - (v / maxVal) * 22;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [speedHistory]);

  return (
    <div className="window-frame">
      {/* Custom Integrated Titlebar */}
      <header className={`titlebar ${isMac ? 'mac' : ''}`}>
        <div className="titlebar-brand">
          <BrandShieldLogo size={18} />
          <span>3004 VPN</span>
        </div>

        {!isMac && (
          <div className="win-controls">
            <button
              type="button"
              className="win-btn"
              title="최소화"
              onClick={() => window.vpnDesktop?.minimizeWindow()}
            >
              <WinMinIcon />
            </button>
            <button
              type="button"
              className="win-btn"
              title="최대화"
              onClick={() => window.vpnDesktop?.toggleMaximizeWindow()}
            >
              <WinMaxIcon />
            </button>
            <button
              type="button"
              className="win-btn close"
              title="트레이로 최소화"
              onClick={() => window.vpnDesktop?.closeWindow()}
            >
              <WinCloseIcon />
            </button>
          </div>
        )}
      </header>

      {booting ? (
        <div className="auth-screen" style={{ color: 'var(--text-muted)' }}>
          초기화 중...
        </div>
      ) : !user ? (
        <div className="auth-screen">
          <form className="auth-panel" onSubmit={handleAuthSubmit}>
            <div className="auth-top-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <BrandShieldLogo size={32} />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>
                    3004 VPN
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Private WireGuard Network
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="endpoint-chip"
                onClick={() => setShowEndpointDrawer((v) => !v)}
              >
                <span className={`status-dot ${serverOnline ? 'online' : 'warn'}`} />
                <ServerGearIcon size={13} />
                <span>서버 설정</span>
              </button>
            </div>

            {showEndpointDrawer && (
              <div className="endpoint-drawer">
                <label className="field-label">컨트롤 서버 주소</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="input mono"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://..."
                  />
                  <button
                    type="button"
                    className="btn-subtle"
                    onClick={() => probeHealth(urlInput)}
                  >
                    연결 확인
                  </button>
                </div>
              </div>
            )}

            {bootstrapMode ? (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'var(--bg-canvas)',
                  border: '1px solid var(--border-hairline)',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  marginBottom: 14,
                }}
              >
                초기 실행 상태입니다. 사용할 관리자 계정을 생성합니다.
              </div>
            ) : (
              <div className="segmented">
                <button
                  type="button"
                  className={`seg-btn ${authTab === 'login' ? 'active' : ''}`}
                  onClick={() => setAuthTab('login')}
                >
                  로그인
                </button>
                <button
                  type="button"
                  className={`seg-btn ${authTab === 'register' ? 'active' : ''}`}
                  onClick={() => setAuthTab('register')}
                >
                  초대코드 가입
                </button>
              </div>
            )}

            <div className="field">
              <label className="field-label">아이디</label>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="field">
              <label className="field-label">비밀번호</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {!bootstrapMode && authTab === 'register' && (
              <div className="field">
                <label className="field-label">초대코드</label>
                <input
                  className="input mono"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="3004-XXXX-XXXX"
                  required
                />
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <button className="btn-solid" type="submit" disabled={authBusy}>
                {authBusy
                  ? '인증 중...'
                  : bootstrapMode
                  ? '관리자 계정 생성'
                  : authTab === 'register'
                  ? '가입 및 로그인'
                  : '계속하기'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="workspace">
          {/* Left Navigation Rail */}
          <aside className="nav-rail">
            <div>
              <button
                type="button"
                className={`nav-btn ${nav === 'connect' ? 'active' : ''}`}
                onClick={() => setNav('connect')}
              >
                <ShieldCheckIcon />
                <span>연결</span>
              </button>
              <button
                type="button"
                className={`nav-btn ${nav === 'servers' ? 'active' : ''}`}
                onClick={() => setNav('servers')}
              >
                <GlobeIcon />
                <span>서버 목록</span>
              </button>
              <button
                type="button"
                className={`nav-btn ${nav === 'settings' ? 'active' : ''}`}
                onClick={() => setNav('settings')}
              >
                <SlidersIcon />
                <span>환경설정</span>
              </button>
              {user.role === 'admin' && (
                <button
                  type="button"
                  className={`nav-btn ${nav === 'admin' ? 'active' : ''}`}
                  onClick={() => setNav('admin')}
                >
                  <ConsoleIcon />
                  <span>관리 콘솔</span>
                </button>
              )}
            </div>

            <div className="user-footer">
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{user.username}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {user.role === 'admin' ? 'Administrator' : 'Member'}
                </div>
              </div>
              <button
                type="button"
                className="btn-subtle"
                style={{ padding: '5px 9px', fontSize: 11.5 }}
                onClick={handleLogout}
              >
                로그아웃
              </button>
            </div>
          </aside>

          {/* Main Content Area */}
          <main className="content-pane">
            {nav === 'connect' && (
              <div className="connect-layout">
                <section className="hero-card">
                  <div className={`tunnel-badge ${vpnState.connected ? 'active' : ''}`}>
                    <span className={`status-dot ${vpnState.connected ? 'online' : ''}`} />
                    <span>
                      {vpnState.connecting
                        ? '터널 협상 중'
                        : vpnState.connected
                        ? 'WireGuard 암호화 활성'
                        : '연결 해제됨'}
                    </span>
                  </div>

                  <div className="power-button-outer">
                    <button
                      type="button"
                      disabled={vpnState.connecting}
                      className={`power-core ${
                        vpnState.connecting
                          ? 'connecting'
                          : vpnState.connected
                          ? 'connected'
                          : ''
                      }`}
                      onClick={() =>
                        vpnState.connected ? handleDisconnect() : handleConnect()
                      }
                    >
                      <PowerGlyph size={30} />
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          marginTop: 8,
                          letterSpacing: '0.03em',
                        }}
                      >
                        {vpnState.connecting
                          ? 'CONNECTING'
                          : vpnState.connected
                          ? 'CONNECTED'
                          : 'DISCONNECTED'}
                      </span>
                    </button>
                  </div>

                  <div
                    className="mono"
                    style={{
                      marginTop: 16,
                      fontSize: 18,
                      fontWeight: 500,
                      color: vpnState.connected ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {formatDuration(uptimeSec)}
                  </div>

                  <div
                    className="selected-server-strip"
                    onClick={() => setNav('servers')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <RegionCodeBadge region={selectedNode?.region || 'KR'} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {selectedNode?.name || '노드 선택'}
                        </div>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {vpnState.connected && vpnState.assignedIp
                            ? `내부 할당 ${vpnState.assignedIp}`
                            : selectedNode?.host || '—'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <SignalBars ms={selectedNode ? pings[selectedNode.id] : null} />
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {selectedNode && pings[selectedNode.id] != null
                          ? `${pings[selectedNode.id]} ms`
                          : '—'}
                      </span>
                      <ChevronRightIcon size={15} />
                    </div>
                  </div>
                </section>

                <section className="telemetry-grid">
                  <div className="metric-card">
                    <div className="metric-head">
                      <span>외부 공인 IPv4</span>
                      <button
                        type="button"
                        onClick={() => refreshPublicIp(settings.apiUrl)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                        title="IP 새로고침"
                      >
                        <RefreshIcon size={13} />
                      </button>
                    </div>
                    <div className="metric-val mono">{publicIp}</div>
                    <div className="metric-sub">
                      {settings.tunnelMode === 'full' ? '전체 트래픽 라우팅' : '내부망 분할 라우팅'}
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-head">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ArrowDownIcon size={12} /> 다운로드
                      </span>
                      <svg width="64" height="18" viewBox="0 0 120 28">
                        <path
                          d={sparklinePath}
                          fill="none"
                          stroke="#22c55e"
                          strokeWidth="2"
                        />
                      </svg>
                    </div>
                    <div className="metric-val mono">{formatSpeed(vpnState.rxSpeedBps)}</div>
                    <div className="metric-sub mono">누적 {formatBytes(vpnState.rxBytes)}</div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-head">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ArrowUpIcon size={12} /> 업로드
                      </span>
                    </div>
                    <div className="metric-val mono">{formatSpeed(vpnState.txSpeedBps)}</div>
                    <div className="metric-sub mono">누적 {formatBytes(vpnState.txBytes)}</div>
                  </div>
                </section>
              </div>
            )}

            {nav === 'servers' && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <div className="section-title">VPN 게이트웨이</div>
                    <div className="section-desc" style={{ marginBottom: 0 }}>
                      연결할 리전 노드를 선택하면 즉시 라우팅이 전환됩니다.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-subtle"
                    onClick={() =>
                      settings.token && loadNodesAndPings(settings.apiUrl, settings.token)
                    }
                  >
                    <RefreshIcon />
                    <span>지연시간 재측정</span>
                  </button>
                </div>

                {nodes.map((node) => {
                  const active = selectedNode?.id === node.id;
                  const ms = pings[node.id];
                  return (
                    <div
                      key={node.id}
                      className={`server-item ${active ? 'active' : ''}`}
                      onClick={async () => {
                        await patchSettings({ selectedNodeId: node.id });
                        setNav('connect');
                        if (vpnState.connected) {
                          await handleConnect(node);
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <RegionCodeBadge region={node.region} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{node.name}</div>
                          <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                            {node.endpoint}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <SignalBars ms={ms} />
                        <span
                          className="mono"
                          style={{ width: 52, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}
                        >
                          {ms != null ? `${ms} ms` : '—'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {nav === 'settings' && (
              <div>
                <div className="panel-card">
                  <div className="section-title">연결 및 시작 동작</div>
                  <div className="section-desc">시스템 부팅 및 라우팅 방식을 제어합니다.</div>

                  <div className="setting-row">
                    <div>
                      <div style={{ fontWeight: 500 }}>시스템 로그인 시 자동 실행</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        컴퓨터를 켜면 백그라운드 트레이 상태로 자동 시작합니다.
                      </div>
                    </div>
                    <SwitchToggle
                      checked={settings.launchAtStartup}
                      onChange={(next) => patchSettings({ launchAtStartup: next })}
                    />
                  </div>

                  <div className="setting-row">
                    <div>
                      <div style={{ fontWeight: 500 }}>앱 시작 시 자동 연결</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        마지막으로 선택한 게이트웨이로 즉시 터널을 연결합니다.
                      </div>
                    </div>
                    <SwitchToggle
                      checked={settings.autoConnect}
                      onChange={(next) => patchSettings({ autoConnect: next })}
                    />
                  </div>

                  <div className="setting-row">
                    <div>
                      <div style={{ fontWeight: 500 }}>전체 트래픽 우회 (Full-Tunnel)</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        모든 외부 웹사이트 접속 시 VPN 서버의 공인 IP를 사용합니다.
                      </div>
                    </div>
                    <SwitchToggle
                      checked={settings.tunnelMode === 'full'}
                      onChange={(next) =>
                        patchSettings({ tunnelMode: next ? 'full' : 'split' })
                      }
                    />
                  </div>

                  {session && (
                    <div className="setting-row">
                      <div>
                        <div style={{ fontWeight: 500 }}>수동 WireGuard 구성 내보내기</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          현재 기기의 표준 .conf 구성 파일을 로컬에 백업합니다.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-subtle"
                        onClick={() =>
                          window.vpnDesktop?.saveConfFile({
                            filename: `3004-VPN-${session.region}.conf`,
                            content: session.config,
                          })
                        }
                      >
                        <DownloadFileIcon />
                        <span>.conf 저장</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="panel-card">
                  <div className="section-title">계정 비밀번호 변경</div>
                  <div className="section-desc">현재 로그인된 계정의 비밀번호를 갱신합니다.</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                    <input
                      type="password"
                      className="input"
                      placeholder="현재 비밀번호"
                      value={curPw}
                      onChange={(e) => setCurPw(e.target.value)}
                    />
                    <input
                      type="password"
                      className="input"
                      placeholder="새 비밀번호 (6자 이상)"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-subtle"
                      onClick={async () => {
                        if (!settings.token || newPw.length < 6) {
                          showToast('새 비밀번호는 6자 이상이어야 합니다.');
                          return;
                        }
                        try {
                          await apiClient.changePassword(
                            settings.apiUrl,
                            settings.token,
                            curPw,
                            newPw
                          );
                          setCurPw('');
                          setNewPw('');
                          showToast('비밀번호가 변경되었습니다.');
                        } catch (err) {
                          showToast(err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      변경 저장
                    </button>
                  </div>
                </div>
              </div>
            )}

            {nav === 'admin' && (
              <div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 12,
                    marginBottom: 14,
                  }}
                >
                  <div className="metric-card">
                    <div className="metric-head">등록 계정</div>
                    <div className="metric-val mono">{overview?.users.length ?? 0}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-head">할당된 기기</div>
                    <div className="metric-val mono">{overview?.devices.length ?? 0}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-head">게이트웨이 노드</div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span className="metric-val mono">{overview?.nodes.length ?? 0}</span>
                      <button
                        type="button"
                        className="btn-subtle"
                        style={{ padding: '4px 9px', fontSize: 11.5 }}
                        onClick={() => setNodeModalOpen(true)}
                      >
                        + 노드 등록
                      </button>
                    </div>
                  </div>
                </div>

                <div className="panel-card">
                  <div className="section-title">초대코드 발행</div>
                  <div className="section-desc">신규 사용자 가입을 위한 1회용 인증 코드를 발급합니다.</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <input
                      className="input"
                      placeholder="용도 메모 (예: 거실 데스크톱)"
                      value={inviteMemo}
                      onChange={(e) => setInviteMemo(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-solid"
                      style={{ width: 130 }}
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
                        showToast(`코드 복사됨: ${created.code}`);
                        await loadAdminOverview();
                      }}
                    >
                      발급 및 복사
                    </button>
                  </div>

                  {overview && overview.invites.length > 0 && (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>코드</th>
                          <th>메모</th>
                          <th>사용</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {overview.invites.slice(0, 5).map((inv) => (
                          <tr key={inv.id}>
                            <td className="mono" style={{ color: 'var(--text-primary)' }}>
                              {inv.code}
                            </td>
                            <td>{inv.memo || '—'}</td>
                            <td className="mono">
                              {inv.used_count}/{inv.max_uses}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className="btn-subtle"
                                style={{ padding: '4px 8px' }}
                                onClick={() => {
                                  navigator.clipboard.writeText(inv.code);
                                  showToast('클립보드에 복사되었습니다.');
                                }}
                              >
                                <CopyIcon size={12} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="panel-card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 10,
                    }}
                  >
                    <div className="section-title" style={{ marginBottom: 0 }}>
                      클라이언트 세션 관리
                    </div>
                    <button type="button" className="btn-subtle" onClick={loadAdminOverview}>
                      <RefreshIcon />
                      <span>새로고침</span>
                    </button>
                  </div>

                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>계정 · 기기</th>
                        <th>할당 IP</th>
                        <th>상태</th>
                        <th>누적 전송량</th>
                        <th style={{ textAlign: 'right' }}>제어</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview?.devices.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                              {d.username}
                            </span>{' '}
                            · {d.device_name}
                          </td>
                          <td className="mono">{d.assigned_ip}</td>
                          <td>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                color: !d.enabled
                                  ? 'var(--accent-danger)'
                                  : d.online
                                  ? '#4ade80'
                                  : 'var(--text-muted)',
                              }}
                            >
                              <span
                                className={`status-dot ${d.enabled && d.online ? 'online' : ''}`}
                              />
                              {!d.enabled ? '차단됨' : d.online ? '활성' : '유휴'}
                            </span>
                          </td>
                          <td className="mono">
                            {formatBytes(d.rx_bytes)} / {formatBytes(d.tx_bytes)}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button
                                type="button"
                                className="btn-subtle"
                                style={{ padding: '4px 9px', fontSize: 11.5 }}
                                onClick={async () => {
                                  if (!settings.token) return;
                                  await apiClient.toggleDevice(settings.apiUrl, settings.token, d.id);
                                  await loadAdminOverview();
                                }}
                              >
                                {d.enabled ? '일시차단' : '해제'}
                              </button>
                              <button
                                type="button"
                                className="btn-subtle"
                                style={{
                                  padding: '4px 9px',
                                  fontSize: 11.5,
                                  color: 'var(--accent-danger)',
                                }}
                                onClick={async () => {
                                  if (!settings.token) return;
                                  await apiClient.deleteDevice(settings.apiUrl, settings.token, d.id);
                                  await loadAdminOverview();
                                }}
                              >
                                삭제
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {/* Add Remote Node Modal */}
      {nodeModalOpen && (
        <div className="modal-backdrop" onClick={() => setNodeModalOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="section-title">원격 클라우드 게이트웨이 추가</div>
            <div className="section-desc">Oracle Cloud 등 외부 WireGuard 에이전트 노드를 연결합니다.</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <label className="field-label">노드 ID</label>
                <input
                  className="input mono"
                  placeholder="jp-tokyo-1"
                  value={newNodeForm.id}
                  onChange={(e) => setNewNodeForm({ ...newNodeForm, id: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="field-label">국가 코드 (2자리)</label>
                <input
                  className="input mono"
                  placeholder="JP"
                  maxLength={2}
                  value={newNodeForm.region}
                  onChange={(e) =>
                    setNewNodeForm({
                      ...newNodeForm,
                      region: e.target.value.toUpperCase(),
                      country_flag: e.target.value.toUpperCase(),
                    })
                  }
                />
              </div>
            </div>

            <div className="field">
              <label className="field-label">표시 이름</label>
              <input
                className="input"
                placeholder="일본 · 도쿄 리전"
                value={newNodeForm.name}
                onChange={(e) => setNewNodeForm({ ...newNodeForm, name: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label">WireGuard Endpoint (IP:Port)</label>
              <input
                className="input mono"
                placeholder="152.xx.xx.xx:51820"
                value={newNodeForm.endpoint}
                onChange={(e) => setNewNodeForm({ ...newNodeForm, endpoint: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label">에이전트 API URL</label>
              <input
                className="input mono"
                placeholder="http://152.xx.xx.xx:8000"
                value={newNodeForm.agent_url}
                onChange={(e) => setNewNodeForm({ ...newNodeForm, agent_url: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label">에이전트 인증 시크릿</label>
              <input
                type="password"
                className="input mono"
                value={newNodeForm.agent_secret}
                onChange={(e) => setNewNodeForm({ ...newNodeForm, agent_secret: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => setNodeModalOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="btn-solid"
                style={{ width: 110 }}
                onClick={async () => {
                  if (!settings.token) return;
                  try {
                    await apiClient.addNode(settings.apiUrl, settings.token, newNodeForm);
                    setNodeModalOpen(false);
                    showToast('새 게이트웨이 노드가 추가되었습니다.');
                    await loadAdminOverview();
                    await loadNodesAndPings(settings.apiUrl, settings.token);
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                등록
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};
