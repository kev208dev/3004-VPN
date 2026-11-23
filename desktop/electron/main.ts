import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  dialog,
  shell,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface PersistedSettings {
  apiUrl: string;
  token: string | null;
  deviceUid: string;
  deviceName: string;
  selectedNodeId: string | null;
  launchAtStartup: boolean;
  autoConnect: boolean;
  tunnelMode: 'full' | 'split';
}

interface TunnelRuntimeState {
  connected: boolean;
  connecting: boolean;
  assignedIp: string | null;
  nodeName: string | null;
  connectedAt: number | null;
  rxBytes: number;
  txBytes: number;
  rxSpeedBps: number;
  txSpeedBps: number;
  toolMissing: boolean;
  lastError: string | null;
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let pollTimer: NodeJS.Timeout | null = null;
let prevRx = 0;
let prevTx = 0;
let prevSampleTs = Date.now();
let activeConfPath: string | null = null;

const state: TunnelRuntimeState = {
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
};

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings(): PersistedSettings {
  const file = getSettingsPath();
  const defaultUid = `desk-${crypto.randomBytes(6).toString('hex')}`;
  const defaults: PersistedSettings = {
    apiUrl: 'http://10.77.0.1:8000',
    token: null,
    deviceUid: defaultUid,
    deviceName: os.hostname().slice(0, 28) || '3004-Desktop',
    selectedNodeId: null,
    launchAtStartup: false,
    autoConnect: true,
    tunnelMode: 'full',
  };
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return { ...defaults, ...parsed };
    }
  } catch {
    // ignore corrupt settings
  }
  saveSettings(defaults);
  return defaults;
}

function saveSettings(next: PersistedSettings): void {
  const dir = path.dirname(getSettingsPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
}

function createCircleIcon(connected: boolean): Electron.NativeImage {
  const size = 18;
  const buf = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  // BGRA order on Windows/macOS bitmap in Electron
  const color = connected ? [129, 185, 16, 255] : [139, 116, 100, 220]; // [B, G, R, A]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      const idx = (y * size + x) * 4;
      if (dist <= 7.2) {
        buf[idx] = color[0];
        buf[idx + 1] = color[1];
        buf[idx + 2] = color[2];
        buf[idx + 3] = dist > 6.2 ? 150 : color[3];
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function updateTrayMenu(): void {
  if (!tray) return;
  tray.setImage(createCircleIcon(state.connected));
  tray.setToolTip(
    state.connected
      ? `삼천포(3004) VPN — 연결됨 (${state.assignedIp ?? ''})`
      : '삼천포(3004) VPN — 연결 대기 중'
  );

  const menu = Menu.buildFromTemplate([
    {
      label: state.connected
        ? `● 연결됨 (${state.nodeName ?? '3004 VPN'})`
        : '○ VPN 연결 끊김',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: state.connected ? 'VPN 연결 해제' : '창 열어서 빠른 연결',
      click: async () => {
        if (state.connected) {
          await stopWireGuardTunnel();
        } else {
          showMainWindow();
          mainWindow?.webContents.send('tray:quick-connect');
        }
      },
    },
    {
      label: '삼천포 VPN 창 열기',
      click: () => showMainWindow(),
    },
    { type: 'separator' },
    {
      label: '3004 VPN 완전 종료',
      click: async () => {
        isQuitting = true;
        await stopWireGuardTunnel().catch(() => undefined);
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function broadcastState(): void {
  updateTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vpn:state', { ...state });
  }
}

function findMacBinary(name: string): string | null {
  const candidates = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function runWindowsWireGuardElevated(args: string[]): Promise<void> {
  const wgExe = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'WireGuard', 'wireguard.exe');
  if (!fs.existsSync(wgExe)) {
    state.toolMissing = true;
    throw new Error('WireGuard Windows 드라이버가 설치되어 있지 않습니다. wireguard.com/install 에서 먼저 설치해 주세요.');
  }
  try {
    await execFileAsync(wgExe, args, { windowsHide: true });
  } catch {
    // Request UAC elevation cleanly via PowerShell Start-Process -Verb RunAs -Wait
    const escapedArgs = args.map((a) => `\`"${a.replace(/"/g, '')}\`"`).join(',');
    const psCmd = `Start-Process -FilePath "${wgExe}" -ArgumentList ${escapedArgs} -Verb RunAs -Wait -WindowStyle Hidden`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true });
  }
}

async function startWireGuardTunnel(configText: string, assignedIp: string, nodeName: string): Promise<TunnelRuntimeState> {
  state.connecting = true;
  state.lastError = null;
  state.toolMissing = false;
  broadcastState();

  const tunnelDir = path.join(app.getPath('userData'), 'tunnels');
  fs.mkdirSync(tunnelDir, { recursive: true });

  try {
    if (process.platform === 'win32') {
      const confPath = path.join(tunnelDir, '3004VPN.conf');
      fs.writeFileSync(confPath, configText, { encoding: 'ascii', mode: 0o600 });
      activeConfPath = confPath;
      await stopWireGuardTunnel(true).catch(() => undefined);
      await runWindowsWireGuardElevated(['/installtunnelservice', confPath]);
    } else if (process.platform === 'darwin') {
      const wgQuick = findMacBinary('wg-quick');
      const confPath = path.join(tunnelDir, 'wg3004.conf');
      fs.writeFileSync(confPath, configText, { encoding: 'utf-8', mode: 0o600 });
      activeConfPath = confPath;

      if (!wgQuick) {
        state.toolMissing = true;
        throw new Error(
          'macOS WireGuard CLI(wireguard-tools)가 아직 설치되지 않았습니다. 아래 [.conf 프로필 저장]으로 공식 앱에 넣거나 터미널에서 brew install wireguard-tools 를 설치하세요.'
        );
      }
      const envPrefix = 'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
      const downUpCmd = `${envPrefix} "${wgQuick}" down "${confPath}" >/dev/null 2>&1 || true; ${envPrefix} "${wgQuick}" up "${confPath}"`;
      const osa = `do shell script ${JSON.stringify(downUpCmd)} with administrator privileges`;
      await execFileAsync('osascript', ['-e', osa]);
    } else {
      const confPath = path.join(tunnelDir, 'wg3004.conf');
      fs.writeFileSync(confPath, configText, { encoding: 'utf-8', mode: 0o600 });
      activeConfPath = confPath;
      await execFileAsync('pkexec', ['wg-quick', 'up', confPath]);
    }

    prevRx = 0;
    prevTx = 0;
    prevSampleTs = Date.now();
    state.connected = true;
    state.connecting = false;
    state.assignedIp = assignedIp;
    state.nodeName = nodeName;
    state.connectedAt = Date.now();
    startStatsPolling();
    broadcastState();
    return { ...state };
  } catch (err) {
    state.connected = false;
    state.connecting = false;
    state.lastError = err instanceof Error ? err.message : String(err);
    broadcastState();
    throw err;
  }
}

async function stopWireGuardTunnel(silent = false): Promise<TunnelRuntimeState> {
  if (!silent) {
    state.connecting = true;
    broadcastState();
  }
  stopStatsPolling();

  try {
    if (process.platform === 'win32') {
      await runWindowsWireGuardElevated(['/uninstalltunnelservice', '3004VPN']).catch(() => undefined);
    } else if (process.platform === 'darwin' && activeConfPath && fs.existsSync(activeConfPath)) {
      const wgQuick = findMacBinary('wg-quick');
      if (wgQuick) {
        const envPrefix = 'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
        const downCmd = `${envPrefix} "${wgQuick}" down "${activeConfPath}" >/dev/null 2>&1 || true`;
        await execFileAsync('osascript', ['-e', `do shell script ${JSON.stringify(downCmd)} with administrator privileges`]).catch(
          () => undefined
        );
      }
    }
  } finally {
    if (!silent) {
      state.connected = false;
      state.connecting = false;
      state.connectedAt = null;
      state.rxSpeedBps = 0;
      state.txSpeedBps = 0;
      broadcastState();
    }
  }
  return { ...state };
}

async function sampleTransferBytes(): Promise<{ rx: number; tx: number } | null> {
  try {
    if (process.platform === 'win32') {
      const wgBin = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'WireGuard', 'wg.exe');
      const { stdout } = await execFileAsync(wgBin, ['show', '3004VPN', 'transfer'], { windowsHide: true });
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 3) {
        return { rx: Number(parts[1]) || 0, tx: Number(parts[2]) || 0 };
      }
    } else if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('/usr/sbin/netstat', ['-ib']);
      let bestRx = 0;
      let bestTx = 0;
      for (const line of stdout.split('\n')) {
        if (line.startsWith('utun') && state.assignedIp && line.includes(state.assignedIp)) {
          const cols = line.trim().split(/\s+/);
          if (cols.length >= 10) {
            bestRx = Number(cols[6]) || 0;
            bestTx = Number(cols[9]) || 0;
          }
        }
      }
      if (bestRx > 0 || bestTx > 0) {
        return { rx: bestRx, tx: bestTx };
      }
    }
  } catch {
    // ignore transient CLI read error
  }
  return null;
}

function startStatsPolling(): void {
  stopStatsPolling();
  pollTimer = setInterval(async () => {
    if (!state.connected) return;
    const sample = await sampleTransferBytes();
    if (!sample) return;
    const now = Date.now();
    const dtSec = Math.max(0.5, (now - prevSampleTs) / 1000);
    if (prevRx > 0 || prevTx > 0) {
      state.rxSpeedBps = Math.max(0, (sample.rx - prevRx) / dtSec);
      state.txSpeedBps = Math.max(0, (sample.tx - prevTx) / dtSec);
    }
    prevRx = sample.rx;
    prevTx = sample.tx;
    prevSampleTs = now;
    state.rxBytes = sample.rx;
    state.txBytes = sample.tx;
    broadcastState();
  }, 1500);
}

function stopStatsPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function measureTcpLatencyMs(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (val: number | null) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(val);
      }
    };
    socket.setTimeout(2200);
    socket.once('connect', () => finish(Date.now() - start));
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
    socket.connect(port, host);
  });
}

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 860,
    minHeight: 640,
    title: '삼천포(3004) VPN',
    backgroundColor: '#070B14',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(() => {
  const initialSettings = loadSettings();
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: initialSettings.launchAtStartup });
  }

  tray = new Tray(createCircleIcon(false));
  tray.on('click', () => showMainWindow());
  updateTrayMenu();
  createWindow();

  ipcMain.handle('settings:get', () => loadSettings());

  ipcMain.handle('settings:update', (_evt, patch: Partial<PersistedSettings>) => {
    const next = { ...loadSettings(), ...patch };
    saveSettings(next);
    if (typeof patch.launchAtStartup === 'boolean' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: patch.launchAtStartup });
    }
    return next;
  });

  ipcMain.handle('vpn:get-state', () => ({ ...state, platform: process.platform }));

  ipcMain.handle(
    'vpn:connect',
    async (_evt, payload: { config: string; assignedIp: string; nodeName: string }) => {
      return startWireGuardTunnel(payload.config, payload.assignedIp, payload.nodeName);
    }
  );

  ipcMain.handle('vpn:disconnect', async () => stopWireGuardTunnel(false));

  ipcMain.handle('vpn:save-conf', async (_evt, payload: { filename: string; content: string }) => {
    if (!mainWindow) return false;
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'WireGuard 설정 파일(.conf) 저장',
      defaultPath: payload.filename,
      filters: [{ name: 'WireGuard Config', extensions: ['conf'] }],
    });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, payload.content, { encoding: 'ascii', mode: 0o600 });
    shell.showItemInFolder(res.filePath);
    return true;
  });

  ipcMain.handle('net:ping', async (_evt, payload: { host: string; apiUrl: string; isLocal: boolean }) => {
    const t0 = Date.now();
    if (payload.isLocal) {
      try {
        const clean = payload.apiUrl.replace(/\/+$/, '');
        const res = await fetch(`${clean}/api/v1/ping`, { signal: AbortSignal.timeout(2500) });
        if (res.ok) return Date.now() - t0;
      } catch {
        // fall through
      }
    }
    return measureTcpLatencyMs(payload.host, 443);
  });

  ipcMain.handle('net:public-ip', async (_evt, apiUrl: string) => {
    try {
      const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const j = (await res.json()) as { ip: string };
        return j.ip;
      }
    } catch {
      // fallback
    }
    try {
      const clean = apiUrl.replace(/\/+$/, '');
      const res = await fetch(`${clean}/api/v1/my-ip`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const j = (await res.json()) as { ip: string };
        return j.ip;
      }
    } catch {
      // ignore
    }
    return '조회 실패';
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showMainWindow();
  }
});
