import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, normalizeServerUrl } from './api';
import AnimatedContent from './components/AnimatedContent';
import Aurora from './components/Aurora';
import CountUp from './components/CountUp';
import DecryptedText from './components/DecryptedText';
import ElectricLogo from './components/ElectricLogo';
import ShinyText from './components/ShinyText';
import SpotlightCard from './components/SpotlightCard';
import SpringNav from './components/SpringNav';
import StarBorder from './components/StarBorder';
import Stepper, { Step } from './components/Stepper';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrandShieldLogo,
  CheckIcon,
  ChevronRightIcon,
  ConsoleIcon,
  CopyIcon,
  DownloadFileIcon,
  GlobeIcon,
  RefreshIcon,
  RegionCodeBadge,
  ShieldCheckIcon,
  SignalBars,
  SlidersIcon,
  WinCloseIcon,
  WinMaxIcon,
  WinMinIcon,
} from './icons';

const POWER_ELECTRIC_SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M91 34 A38 38 0 1 1 37 34" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round"/><line x1="64" y1="18" x2="64" y2="58" stroke="#fff" stroke-width="11" stroke-linecap="round"/></svg>'
)}`;
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

function normalizedIsUnreachableHint(msg: string): boolean {
  return msg.includes('서버') || msg.includes('초과') || msg.includes('10.77.0.1');
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

  // Auth & Onboarding Stepper states
  const [onboardStep, setOnboardStep] = useState(1);
  const [pendingAuth, setPendingAuth] = useState<{
    apiUrl: string;
    token: string;
    user: UserProfile;
  } | null>(null);
  const [urlInput, setUrlInput] = useState('http://10.77.0.1:8000');
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [bootstrapMode, setBootstrapMode] = useState(false);
  const [serverOnline, setServerOnline] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeBanner, setProbeBanner] = useState<{
    kind: 'checking' | 'ok' | 'err';
    text: string;
  } | null>(null);

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

  // Password & button interaction states
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [ipRefreshing, setIpRefreshing] = useState(false);
  const [pingingNodes, setPingingNodes] = useState(false);
  const [adminRefreshing, setAdminRefreshing] = useState(false);
  const [issuingInvite, setIssuingInvite] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<number | null>(null);

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

  const isMac =
    (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)) ||
    (window.vpnDesktop?.platform || vpnState.platform) === 'darwin';

  const patchSettings = useCallback(async (patch: Partial<PersistedSettings>) => {
    if (window.vpnDesktop) {
      const updated = await window.vpnDesktop.updateSettings(patch);
      setSettings(updated);
      return updated;
    }
    setSettings((prev) => ({ ...prev, ...patch }));
    return null;
  }, []);

  const refreshPublicIp = useCallback(
    async (apiUrl: string, manual = false) => {
      setIpRefreshing(true);
      try {
        if (window.vpnDesktop) {
          const ip = await window.vpnDesktop.fetchPublicIp(apiUrl);
          setPublicIp(ip);
        } else {
          const res = await fetch('https://api.ipify.org?format=json');
          const data = await res.json();
          setPublicIp(data.ip);
        }
        if (manual) showToast('공인 IP 정보가 갱신되었습니다.');
      } catch {
        setPublicIp('조회 실패');
      } finally {
        setTimeout(() => setIpRefreshing(false), 350);
      }
    },
    [showToast]
  );

  const probeHealth = useCallback(
    async (targetUrl: string, quiet = false): Promise<boolean> => {
      setProbing(true);
      setAuthError(null);
      if (!quiet) {
        setProbeBanner({ kind: 'checking', text: '서버 응답을 확인하는 중입니다...' });
      }
      try {
        const h = await apiClient.checkHealth(targetUrl);
        setServerOnline(true);
        setBootstrapMode(Boolean(h.bootstrap_required));
        setUrlInput(h.normalizedUrl);
        await patchSettings({ apiUrl: h.normalizedUrl });
        setProbeBanner({
          kind: 'ok',
          text: `연결 확인됨 · 응답 시간 ${h.rttMs} ms`,
        });
        return true;
      } catch (err) {
        setServerOnline(false);
        const msg = err instanceof Error ? err.message : String(err);
        setProbeBanner({ kind: 'err', text: msg });
        return false;
      } finally {
        setProbing(false);
      }
    },
    [patchSettings]
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

  const [vpnConflicts, setVpnConflicts] = useState<string[]>([]);
  const [hasWarpConflict, setHasWarpConflict] = useState(false);
  const [clearingWarp, setClearingWarp] = useState(false);

  const checkConflicts = useCallback(async () => {
    if (!window.vpnDesktop?.checkVpnConflicts) return;
    try {
      const res = await window.vpnDesktop.checkVpnConflicts();
      setVpnConflicts(res.conflicts || []);
      setHasWarpConflict(Boolean(res.hasWarp));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void checkConflicts();
    const timer = window.setInterval(() => void checkConflicts(), 8000);
    const onFocus = () => void checkConflicts();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, vpnState.connected, checkConflicts]);

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
    async (apiUrl: string, token: string, manual = false) => {
      setPingingNodes(true);
      try {
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
        if (manual) showToast('전체 노드 지연시간 측정이 완료되었습니다.');
      } finally {
        setTimeout(() => setPingingNodes(false), 300);
      }
    },
    [patchSettings, settings.selectedNodeId, showToast]
  );

  const handleConnect = useCallback(
    async (overrideNode?: VpnNode) => {
      const target = overrideNode || selectedNode;
      if (!target || !settings.token) return;
      try {
        const osPlat = isMac ? 'macos' : vpnState.platform === 'win32' ? 'windows' : 'other';
        const issued = await apiClient.connect(settings.apiUrl, settings.token, {
          node_id: target.id,
          device_uid: settings.deviceUid,
          device_name: settings.deviceName,
          platform: osPlat,
          mode: settings.tunnelMode,
        });
        setSession(issued);
        if (window.vpnDesktop) {
          const preCheck = await window.vpnDesktop.checkVpnConflicts?.().catch(() => null);
          if (preCheck && preCheck.conflicts.length > 0) {
            if (preCheck.hasWarp) {
              showToast('Cloudflare WARP가 감지되어 자동 해제 후 3004 VPN에 연결합니다.');
            } else {
              showToast(`다른 VPN(${preCheck.conflicts.join(', ')})이 켜져 있어 충돌할 수 있습니다.`);
            }
          }
          await window.vpnDesktop.connectTunnel({
            config: issued.config,
            assignedIp: issued.assigned_ip,
            nodeName: issued.node_name,
          });
        }
        void checkConflicts();
        const tk = settings.token;
        setTimeout(() => {
          void refreshPublicIp(settings.apiUrl);
          if (tk) void loadNodesAndPings(settings.apiUrl, tk);
        }, 1200);
        setTimeout(() => {
          void refreshPublicIp(settings.apiUrl);
        }, 3000);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    },
    [
      checkConflicts,
      isMac,
      loadNodesAndPings,
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

  const runStep2Auth = async (): Promise<boolean> => {
    if (!username.trim() || !password) {
      setAuthError('아이디와 비밀번호를 모두 입력해 주세요.');
      return false;
    }
    if (!bootstrapMode && authTab === 'register' && !inviteCode.trim()) {
      setAuthError('관리자에게 받은 초대코드를 입력해 주세요.');
      return false;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const normalized = normalizeServerUrl(urlInput);
      setUrlInput(normalized);
      const resp = bootstrapMode
        ? await apiClient.bootstrap(normalized, username.trim(), password)
        : authTab === 'register'
        ? await apiClient.register(normalized, username.trim(), password, inviteCode.trim())
        : await apiClient.login(normalized, username.trim(), password);

      setServerOnline(true);
      setPendingAuth({ apiUrl: normalized, token: resp.access_token, user: resp.user });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(msg);
      if (normalizedIsUnreachableHint(msg)) {
        setOnboardStep(1);
      }
      return false;
    } finally {
      setAuthBusy(false);
    }
  };

  const handleOnboardingNext = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (onboardStep === 1) {
      const ok = serverOnline ? true : await probeHealth(urlInput, false);
      if (ok) setOnboardStep(2);
      return;
    }
    if (onboardStep === 2) {
      const ok = await runStep2Auth();
      if (ok) setOnboardStep(3);
      return;
    }
    if (onboardStep === 3 && pendingAuth) {
      await patchSettings({ apiUrl: pendingAuth.apiUrl, token: pendingAuth.token });
      setUser(pendingAuth.user);
      setPendingAuth(null);
      setOnboardStep(1);
    }
  };

  const handleLogout = async () => {
    if (vpnState.connected && window.vpnDesktop) {
      await window.vpnDesktop.disconnectTunnel().catch(() => undefined);
    }
    await patchSettings({ token: null });
    setUser(null);
    setPendingAuth(null);
    setOnboardStep(1);
    autoConnectDone.current = false;
  };

  const loadAdminOverview = useCallback(
    async (manual = false) => {
      if (!settings.token || user?.role !== 'admin') return;
      setAdminRefreshing(true);
      try {
        const data = await apiClient.getAdminOverview(settings.apiUrl, settings.token);
        setOverview(data);
        if (manual) showToast('세션 목록이 갱신되었습니다.');
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      } finally {
        setTimeout(() => setAdminRefreshing(false), 300);
      }
    },
    [settings.apiUrl, settings.token, showToast, user?.role]
  );

  useEffect(() => {
    if (nav === 'admin') void loadAdminOverview(false);
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

  const spotlightAccent = vpnState.connecting
    ? 'rgba(245, 158, 11, 0.18)'
    : vpnState.connected
    ? 'rgba(34, 197, 94, 0.16)'
    : 'rgba(173, 109, 255, 0.16)';

  const auroraStops: [string, string, string] = vpnState.connecting
    ? ['#92400e', '#f59e0b', '#78350f']
    : vpnState.connected
    ? ['#065f46', '#10b981', '#0369a1']
    : ['#3b1d8a', '#7c3aed', '#1e1b4b'];

  const navItems = useMemo(() => {
    const base: Array<{
      id: 'connect' | 'servers' | 'settings' | 'admin';
      label: string;
      icon: React.ReactNode;
    }> = [
      { id: 'connect', label: '연결', icon: <ShieldCheckIcon /> },
      { id: 'servers', label: '서버 목록', icon: <GlobeIcon /> },
      { id: 'settings', label: '환경설정', icon: <SlidersIcon /> },
    ];
    if (user?.role === 'admin') {
      base.push({ id: 'admin', label: '관리 콘솔', icon: <ConsoleIcon /> });
    }
    return base;
  }, [user?.role]);

  return (
    <div className="window-frame">
        {/* Custom Integrated Titlebar */}
        <header className={`titlebar ${isMac ? 'mac' : ''}`}>
          <div className="titlebar-brand">
            <BrandShieldLogo size={18} />
            <ShinyText text="3004 VPN" speed={5} />
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
            <Aurora colorStops={['#3b1d8a', '#7c3aed', '#1e1b4b']} amplitude={0.9} blend={0.6} speed={0.5} style={{ opacity: 0.35 }} />
            <ShinyText text="초기화 중..." speed={2.5} />
          </div>
        ) : !user ? (
          <div className="auth-screen">
            <Aurora
              colorStops={['#3b1d8a', '#ad6dff', '#1e1b4b']}
              amplitude={1.0}
              blend={0.6}
              speed={0.55}
              style={{ opacity: 0.42 }}
            />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <Stepper
            step={onboardStep}
            onStepChange={(next) => {
              if (next < onboardStep) setOnboardStep(next);
            }}
            linear
            theme="dark"
            radius={20}
            width={460}
            backButtonText="이전"
            nextButtonText={
              onboardStep === 1
                ? probing
                  ? '확인 중...'
                  : '다음'
                : authBusy
                ? '인증 중...'
                : bootstrapMode
                ? '관리자 생성'
                : authTab === 'register'
                ? '가입 및 다음'
                : '로그인'
            }
            completeButtonText="시작하기"
            nextButtonProps={{
              disabled: probing || authBusy,
              onClick: handleOnboardingNext,
            }}
          >
            <Step title="서버 연결">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                <BrandShieldLogo size={36} />
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>
                    3004 VPN 시작하기
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    먼저 컨트롤 서버 주소를 확인합니다.
                  </div>
                </div>
              </div>

              <div className="field">
                <label className="field-label">컨트롤 서버 주소</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="input mono"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      setServerOnline(false);
                      setProbeBanner(null);
                    }}
                    placeholder="https://xxxx.trycloudflare.com"
                  />
                  <button
                    type="button"
                    className="btn-subtle"
                    disabled={probing}
                    style={{ minWidth: 88 }}
                    onClick={() => probeHealth(urlInput, false)}
                  >
                    {probing ? (
                      <>
                        <span className="spinner" />
                        <span>확인 중</span>
                      </>
                    ) : (
                      <span>연결 확인</span>
                    )}
                  </button>
                </div>

                {probeBanner && (
                  <div className={`probe-banner ${probeBanner.kind}`}>{probeBanner.text}</div>
                )}
              </div>
            </Step>

            <Step title="계정 인증">
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {bootstrapMode ? '초기 관리자 계정 생성' : '계정 로그인'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {bootstrapMode
                    ? '첫 실행 상태입니다. 사용할 최고 관리자 계정을 등록하세요.'
                    : '기존 계정으로 로그인하거나 관리자의 초대코드로 가입합니다.'}
                </div>
              </div>

              {!bootstrapMode && (
                <div className="segmented">
                  <button
                    type="button"
                    className={`seg-btn ${authTab === 'login' ? 'active' : ''}`}
                    onClick={() => {
                      setAuthTab('login');
                      setAuthError(null);
                    }}
                  >
                    로그인
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${authTab === 'register' ? 'active' : ''}`}
                    onClick={() => {
                      setAuthTab('register');
                      setAuthError(null);
                    }}
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
                />
              </div>

              <div className="field">
                <label className="field-label">비밀번호</label>
                <input
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && !authBusy) {
                      const ok = await runStep2Auth();
                      if (ok) setOnboardStep(3);
                    }
                  }}
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
                  />
                </div>
              )}

              {authError && <div className="probe-banner err">{authError}</div>}
            </Step>

            <Step title="시작 설정">
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  환영합니다, {pendingAuth?.user.username ?? username}님
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  기본 연결 옵션을 선택하면 바로 시작할 수 있습니다.
                </div>
              </div>

              <div className="setting-row">
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>시스템 로그인 시 자동 실행</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    부팅 시 트레이에서 백그라운드로 자동 시작
                  </div>
                </div>
                <SwitchToggle
                  checked={settings.launchAtStartup}
                  onChange={(next) => patchSettings({ launchAtStartup: next })}
                />
              </div>

              <div className="setting-row">
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>앱 시작 시 자동 VPN 연결</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    실행 즉시 마지막 서버로 자동 연결
                  </div>
                </div>
                <SwitchToggle
                  checked={settings.autoConnect}
                  onChange={(next) => patchSettings({ autoConnect: next })}
                />
              </div>

              <div className="setting-row">
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>전체 트래픽 우회 (Full-Tunnel)</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    모든 웹사이트 접속 시 서버 공인 IP 사용
                  </div>
                </div>
                <SwitchToggle
                  checked={settings.tunnelMode === 'full'}
                  onChange={(next) => patchSettings({ tunnelMode: next ? 'full' : 'split' })}
                />
              </div>
            </Step>
              </Stepper>
            </div>
          </div>
        ) : (
        <div className="workspace">
          {/* Left Navigation Rail */}
          <aside className="nav-rail">
            <SpringNav
              items={navItems}
              activeId={nav}
              onSelect={setNav}
              connected={vpnState.connected}
            />

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
              <AnimatedContent key="tab-connect" className="connect-layout">
                {vpnConflicts.length > 0 && (
                  <div className="vpn-conflict-banner">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span className="conflict-dot" />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fde68a' }}>
                          다른 VPN 연결 감지됨: {vpnConflicts.join(', ')}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'rgba(254, 243, 199, 0.72)' }}>
                          동시 실행 시 라우팅·DNS 충돌로 연결이 불안정할 수 있습니다.
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {hasWarpConflict && (
                        <button
                          type="button"
                          className="btn-conflict-action"
                          disabled={clearingWarp}
                          onClick={async () => {
                            if (!window.vpnDesktop?.disconnectWarp) return;
                            setClearingWarp(true);
                            try {
                              await window.vpnDesktop.disconnectWarp();
                              await checkConflicts();
                              showToast('Cloudflare WARP 연결을 해제했습니다.');
                            } finally {
                              setClearingWarp(false);
                            }
                          }}
                        >
                          {clearingWarp ? '해제 중...' : 'WARP 끄기'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-action-btn"
                        title="다시 확인"
                        onClick={() => void checkConflicts()}
                      >
                        <RefreshIcon size={13} />
                      </button>
                    </div>
                  </div>
                )}

                <section className="hero-card">
                  <Aurora
                    colorStops={auroraStops}
                    amplitude={vpnState.connecting ? 1.25 : 0.85}
                    blend={0.6}
                    speed={vpnState.connecting ? 1.15 : 0.48}
                    style={{ opacity: vpnState.connected ? 0.34 : 0.24 }}
                  />
                  <div className={`tunnel-badge ${vpnState.connected ? 'active' : ''}`} style={{ position: 'relative', zIndex: 1 }}>
                    <span className={`status-dot ${vpnState.connected ? 'online' : ''}`} />
                    <ShinyText
                      text={
                        vpnState.connecting
                          ? '터널 협상 중'
                          : vpnState.connected
                          ? 'WireGuard 암호화 활성'
                          : '연결 해제됨'
                      }
                      tone={vpnState.connecting ? 'amber' : vpnState.connected ? 'green' : 'default'}
                      speed={vpnState.connecting ? 1.8 : 3.8}
                    />
                  </div>

                  <div className="power-button-outer">
                    <button
                      type="button"
                      aria-busy={vpnState.connecting}
                      aria-label={
                        vpnState.connecting
                          ? 'VPN 연결 협상 중'
                          : vpnState.connected
                          ? 'VPN 연결 해제'
                          : 'VPN 연결 시작'
                      }
                      className={`power-electric-btn ${
                        vpnState.connecting
                          ? 'connecting'
                          : vpnState.connected
                          ? 'connected'
                          : ''
                      }`}
                      onClick={() => {
                        if (vpnState.connecting) return;
                        if (vpnState.connected) {
                          void handleDisconnect();
                        } else {
                          void handleConnect();
                        }
                      }}
                    >
                      <ElectricLogo
                        src={POWER_ELECTRIC_SVG}
                        color={
                          vpnState.connecting
                            ? '#fef08a'
                            : vpnState.connected
                            ? '#bbf7d0'
                            : '#ecc7ff'
                        }
                        glowColor={
                          vpnState.connecting
                            ? '#f59e0b'
                            : vpnState.connected
                            ? '#22c55e'
                            : '#ad6dff'
                        }
                        scale={0.62}
                        intensity={vpnState.connecting ? 1.2 : vpnState.connected ? 1.15 : 0.92}
                        glow={vpnState.connecting ? 1.2 : vpnState.connected ? 1.15 : 0.85}
                        thickness={vpnState.connected ? 1.65 : 1.4}
                        strands={vpnState.connecting ? 5 : vpnState.connected ? 4 : 3}
                        bend={vpnState.connecting ? 0.85 : 0.55}
                        crackle={vpnState.connecting ? 2.0 : vpnState.connected ? 1.55 : 1.2}
                        arcs={vpnState.connecting ? 1.6 : vpnState.connected ? 1.1 : 0.55}
                        flicker={vpnState.connecting ? 0.75 : 0.5}
                        fill={vpnState.connected ? 0.25 : 0.08}
                        speed={vpnState.connecting ? 4.2 : vpnState.connected ? 2.6 : 1.7}
                        interactive={true}
                        cursorIntensity={0.85}
                        cursorRadius={90}
                        theme="dark"
                      />
                    </button>
                  </div>

                  <div
                    className={`power-status-caption ${
                      vpnState.connecting
                        ? 'connecting'
                        : vpnState.connected
                        ? 'connected'
                        : ''
                    }`}
                  >
                    {vpnState.connecting
                      ? 'CONNECTING...'
                      : vpnState.connected
                      ? 'CONNECTED · 클릭하여 해제'
                      : 'DISCONNECTED · 클릭하여 연결'}
                  </div>

                  <div
                    className="mono"
                    style={{
                      marginTop: 8,
                      fontSize: 18,
                      fontWeight: 500,
                      color: vpnState.connected ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {formatDuration(uptimeSec)}
                  </div>

                  <StarBorder
                    className="selected-server-star"
                    color={vpnState.connected ? '#22c55e' : '#ad6dff'}
                    speed={vpnState.connected ? '4s' : '6s'}
                    innerClassName="selected-server-strip-inner"
                    onClick={() => setNav('servers')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <RegionCodeBadge region={selectedNode?.region || 'KR'} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {selectedNode?.name || '노드 선택'}
                        </div>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {vpnState.connected && vpnState.assignedIp ? (
                            <>
                              내부 할당 <DecryptedText text={vpnState.assignedIp} speed={26} />
                            </>
                          ) : (
                            selectedNode?.host || '—'
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <SignalBars ms={selectedNode ? pings[selectedNode.id] : null} />
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {selectedNode && typeof pings[selectedNode.id] === 'number' ? (
                          <CountUp to={pings[selectedNode.id] as number} suffix=" ms" duration={360} />
                        ) : (
                          '—'
                        )}
                      </span>
                      <ChevronRightIcon size={15} />
                    </div>
                  </StarBorder>
                </section>

                <section className="telemetry-grid">
                  <SpotlightCard className="metric-card" spotlightColor={spotlightAccent}>
                    <div className="metric-head">
                      <span>외부 공인 IPv4</span>
                      <button
                        type="button"
                        className="icon-action-btn"
                        disabled={ipRefreshing}
                        onClick={() => refreshPublicIp(settings.apiUrl, true)}
                        title="공인 IP 다시 확인"
                      >
                        <RefreshIcon size={13} spinning={ipRefreshing} />
                      </button>
                    </div>
                    <div
                      className="metric-val mono"
                      style={{ opacity: ipRefreshing ? 0.5 : 1, transition: 'opacity 0.15s ease' }}
                    >
                      <DecryptedText text={publicIp} speed={28} />
                    </div>
                    <div className="metric-sub">
                      {settings.tunnelMode === 'full' ? '전체 트래픽 라우팅' : '내부망 분할 라우팅'}
                    </div>
                  </SpotlightCard>

                  <SpotlightCard className="metric-card" spotlightColor={spotlightAccent}>
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
                  </SpotlightCard>

                  <SpotlightCard className="metric-card" spotlightColor={spotlightAccent}>
                    <div className="metric-head">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ArrowUpIcon size={12} /> 업로드
                      </span>
                    </div>
                    <div className="metric-val mono">{formatSpeed(vpnState.txSpeedBps)}</div>
                    <div className="metric-sub mono">누적 {formatBytes(vpnState.txBytes)}</div>
                  </SpotlightCard>
                </section>
              </AnimatedContent>
            )}

            {nav === 'servers' && (
              <AnimatedContent key="tab-servers">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <div className="section-title">
                      <ShinyText text="VPN 게이트웨이" speed={5} />
                    </div>
                    <div className="section-desc" style={{ marginBottom: 0 }}>
                      연결할 리전 노드를 선택하면 즉시 라우팅이 전환됩니다.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-subtle"
                    disabled={pingingNodes}
                    onClick={() =>
                      settings.token && loadNodesAndPings(settings.apiUrl, settings.token, true)
                    }
                  >
                    <RefreshIcon spinning={pingingNodes} />
                    <span>{pingingNodes ? '측정 중...' : '지연시간 재측정'}</span>
                  </button>
                </div>

                {nodes.map((node, idx) => {
                  const active = selectedNode?.id === node.id;
                  const ms = pings[node.id];
                  return (
                    <AnimatedContent key={node.id} delay={idx * 45}>
                      <SpotlightCard
                        spotlightColor={active ? 'rgba(34, 197, 94, 0.18)' : spotlightAccent}
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
                            {pingingNodes ? '...' : ms != null ? `${ms} ms` : '—'}
                          </span>
                        </div>
                      </SpotlightCard>
                    </AnimatedContent>
                  );
                })}
              </AnimatedContent>
            )}

            {nav === 'settings' && (
              <AnimatedContent key="tab-settings">
                <SpotlightCard className="panel-card" spotlightColor={spotlightAccent}>
                  <div className="section-title">
                    <ShinyText text="연결 및 시작 동작" speed={5} />
                  </div>
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
                </SpotlightCard>

                <SpotlightCard className="panel-card" spotlightColor={spotlightAccent}>
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
                      disabled={savingPw}
                      onClick={async () => {
                        if (!settings.token || newPw.length < 6) {
                          showToast('새 비밀번호는 6자 이상이어야 합니다.');
                          return;
                        }
                        setSavingPw(true);
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
                        } finally {
                          setSavingPw(false);
                        }
                      }}
                    >
                      {savingPw ? '저장 중...' : '변경 저장'}
                    </button>
                  </div>
                </SpotlightCard>
              </AnimatedContent>
            )}

            {nav === 'admin' && (
              <AnimatedContent key="tab-admin">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 12,
                    marginBottom: 14,
                  }}
                >
                  <SpotlightCard className="metric-card" spotlightColor={spotlightAccent}>
                    <div className="metric-head">등록 계정</div>
                    <div className="metric-val mono">
                      <CountUp to={overview?.users.length ?? 0} />
                    </div>
                  </SpotlightCard>
                  <SpotlightCard className="metric-card" spotlightColor={spotlightAccent}>
                    <div className="metric-head">할당된 기기</div>
                    <div className="metric-val mono">
                      <CountUp to={overview?.devices.length ?? 0} />
                    </div>
                  </SpotlightCard>
                  <SpotlightCard className="metric-card" spotlightColor={spotlightAccent}>
                    <div className="metric-head">게이트웨이 노드</div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span className="metric-val mono">
                        <CountUp to={overview?.nodes.length ?? 0} />
                      </span>
                      <button
                        type="button"
                        className="btn-subtle"
                        style={{ padding: '4px 9px', fontSize: 11.5 }}
                        onClick={() => setNodeModalOpen(true)}
                      >
                        + 노드 등록
                      </button>
                    </div>
                  </SpotlightCard>
                </div>

                <SpotlightCard className="panel-card" spotlightColor={spotlightAccent}>
                  <div className="section-title">
                    <ShinyText text="초대코드 발행" speed={5} />
                  </div>
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
                      style={{ width: 136 }}
                      disabled={issuingInvite}
                      onClick={async () => {
                        if (!settings.token) return;
                        setIssuingInvite(true);
                        try {
                          const created = await apiClient.createInvite(
                            settings.apiUrl,
                            settings.token,
                            inviteMemo,
                            1
                          );
                          await navigator.clipboard.writeText(created.code).catch(() => undefined);
                          setInviteMemo('');
                          setCopiedCode(created.code);
                          setTimeout(() => setCopiedCode(null), 1600);
                          showToast(`코드 발급 및 복사됨: ${created.code}`);
                          await loadAdminOverview(false);
                        } finally {
                          setIssuingInvite(false);
                        }
                      }}
                    >
                      {issuingInvite ? '발급 중...' : '발급 및 복사'}
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
                                  setCopiedCode(inv.code);
                                  setTimeout(() => setCopiedCode(null), 1500);
                                  showToast('클립보드에 복사되었습니다.');
                                }}
                              >
                                {copiedCode === inv.code ? (
                                  <CheckIcon size={12} />
                                ) : (
                                  <CopyIcon size={12} />
                                )}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </SpotlightCard>

                <SpotlightCard className="panel-card" spotlightColor={spotlightAccent}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 10,
                    }}
                  >
                    <div className="section-title" style={{ marginBottom: 0 }}>
                      <ShinyText text="클라이언트 세션 관리" speed={5} />
                    </div>
                    <button
                      type="button"
                      className="btn-subtle"
                      disabled={adminRefreshing}
                      onClick={() => loadAdminOverview(true)}
                    >
                      <RefreshIcon spinning={adminRefreshing} />
                      <span>{adminRefreshing ? '갱신 중...' : '새로고침'}</span>
                    </button>
                  </div>

                  <div className="table-scroll">
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
                              <div className="device-cell" title={`${d.username} · ${d.device_name}`}>
                                <span className="device-cell__user">{d.username}</span>
                                <span className="device-cell__name">{d.device_name}</span>
                              </div>
                            </td>
                            <td className="mono cell-nowrap">{d.assigned_ip}</td>
                            <td className="cell-nowrap">
                              <span
                                className="status-pill-inline"
                                style={{
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
                            <td className="mono cell-nowrap">
                              <div className="traffic-cell">
                                <span style={{ color: 'var(--text-primary)' }}>↓ {formatBytes(d.rx_bytes)}</span>
                                <span style={{ color: 'var(--text-muted)' }}>↑ {formatBytes(d.tx_bytes)}</span>
                              </div>
                            </td>
                            <td className="cell-nowrap" style={{ textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'nowrap' }}>
                                <button
                                  type="button"
                                  className="btn-subtle"
                                  disabled={busyDeviceId === d.id}
                                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                                  onClick={async () => {
                                    if (!settings.token) return;
                                    setBusyDeviceId(d.id);
                                    try {
                                      await apiClient.toggleDevice(
                                        settings.apiUrl,
                                        settings.token,
                                        d.id
                                      );
                                      await loadAdminOverview(false);
                                      showToast(
                                        d.enabled ? '기기가 일시 차단되었습니다.' : '차단이 해제되었습니다.'
                                      );
                                    } finally {
                                      setBusyDeviceId(null);
                                    }
                                  }}
                                >
                                  {busyDeviceId === d.id ? '...' : d.enabled ? '일시차단' : '해제'}
                                </button>
                                <button
                                  type="button"
                                  className="btn-subtle"
                                  disabled={busyDeviceId === d.id}
                                  style={{
                                    padding: '4px 10px',
                                    fontSize: 11.5,
                                    color: 'var(--accent-danger)',
                                  }}
                                  onClick={async () => {
                                    if (!settings.token) return;
                                    setBusyDeviceId(d.id);
                                    try {
                                      await apiClient.deleteDevice(
                                        settings.apiUrl,
                                        settings.token,
                                        d.id
                                      );
                                      await loadAdminOverview(false);
                                      showToast('기기가 삭제되었습니다.');
                                    } finally {
                                      setBusyDeviceId(null);
                                    }
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
                </SpotlightCard>
              </AnimatedContent>
            )}
          </main>
        </div>
      )}

      {/* Add Remote Node Modal */}
      {nodeModalOpen && (
        <div className="modal-backdrop" onClick={() => setNodeModalOpen(false)}>
          <SpotlightCard
            className="modal-box"
            spotlightColor={spotlightAccent}
            onClick={(e) => e.stopPropagation()}
          >
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
          </SpotlightCard>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};
