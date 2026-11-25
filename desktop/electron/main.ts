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
import { execFile, spawn } from 'child_process';
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
    mainWindow.webContents.send('vpn:state', { ...state, platform: process.platform });
  }
}

const MAC_HELPER_PATH = '/usr/local/libexec/vpn3004-helper';
const MAC_HELPER_VERSION = 'v2';
const MAC_WARP_CLI = '/Applications/Cloudflare WARP.app/Contents/Resources/warp-cli';
let tunnelOpInFlight = false;

function normalizeWireGuardConfig(configText: string): string {
  const lines = configText.replace(/\r\n/g, '\n').split('\n');
  const hasMtu = lines.some((l) => /^\s*MTU\s*=/i.test(l));
  const out: string[] = [];
  let inInterface = false;
  let insertedMtu = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[Interface\]$/i.test(trimmed)) {
      inInterface = true;
      out.push(line);
      continue;
    }
    if (/^\[Peer\]$/i.test(trimmed)) {
      if (inInterface && !hasMtu && !insertedMtu) {
        out.push('MTU = 1280');
        insertedMtu = true;
      }
      inInterface = false;
      out.push(line);
      continue;
    }
    if (/^\s*PersistentKeepalive\s*=/i.test(line)) {
      out.push('PersistentKeepalive = 20');
      continue;
    }
    out.push(line);
  }
  if (inInterface && !hasMtu && !insertedMtu) {
    out.push('MTU = 1280');
  }
  return out.join('\n') + '\n';
}

function isWarpStatusActive(stdout: string): boolean {
  if (/\bDisconnected\b/i.test(stdout)) return false;
  return /\b(Connected|Connecting)\b/i.test(stdout);
}

async function disconnectConflictingMacWarp(): Promise<boolean> {
  if (process.platform !== 'darwin' || !fs.existsSync(MAC_WARP_CLI)) return false;
  try {
    const { stdout } = await execFileAsync(MAC_WARP_CLI, ['status'], { timeout: 3000 });
    if (isWarpStatusActive(stdout)) {
      await execFileAsync(MAC_WARP_CLI, ['disconnect'], { timeout: 5000 }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 900));
      return true;
    }
  } catch {
    // ignore if WARP daemon is not running
  }
  return false;
}

async function isMacAssignedIpUp(assignedIp: string | null): Promise<boolean> {
  if (process.platform !== 'darwin' || !assignedIp) return true;
  try {
    const { stdout } = await execFileAsync('/sbin/ifconfig', [], { timeout: 2500 });
    return stdout.includes(`inet ${assignedIp} `);
  } catch {
    return true;
  }
}

async function detectConflictingVpns(): Promise<{ conflicts: string[]; hasWarp: boolean }> {
  const found = new Set<string>();
  let hasWarp = false;

  if (process.platform === 'darwin') {
    // 1. Cloudflare WARP CLI
    if (fs.existsSync(MAC_WARP_CLI)) {
      try {
        const { stdout } = await execFileAsync(MAC_WARP_CLI, ['status'], { timeout: 2500 });
        if (isWarpStatusActive(stdout)) {
          found.add('Cloudflare WARP');
          hasWarp = true;
        }
      } catch {
        // ignore
      }
    }

    // 2. macOS Network Extension / System VPN profiles (scutil --nc list)
    try {
      const { stdout } = await execFileAsync('/usr/sbin/scutil', ['--nc', 'list'], { timeout: 2500 });
      for (const line of stdout.split('\n')) {
        if (/\(Connected\)/i.test(line)) {
          const nameMatch = line.match(/"([^"]+)"/);
          const label = nameMatch ? nameMatch[1].trim() : '시스템 VPN';
          if (!/3004|wg3004/i.test(label)) {
            if (/warp|cloudflare/i.test(label)) {
              found.add('Cloudflare WARP');
              hasWarp = true;
            } else {
              found.add(label);
            }
          }
        }
      }
    } catch {
      // ignore
    }

    // 3. Active utun interfaces with IPv4 addresses (excluding our own assignedIp)
    try {
      const { stdout } = await execFileAsync('/sbin/ifconfig', [], { timeout: 2500 });
      const blocks = stdout.split(/\n(?=[a-zA-Z0-9]+: flags=)/);
      for (const block of blocks) {
        if (!/^utun\d+:/.test(block)) continue;
        const m = block.match(/\binet (\d+\.\d+\.\d+\.\d+)\b/);
        if (!m) continue;
        const ip = m[1];
        if (state.connected && state.assignedIp && ip === state.assignedIp) continue;
        if (ip === '172.16.0.2') {
          found.add('Cloudflare WARP');
          hasWarp = true;
        } else if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) {
          found.add('Tailscale');
        } else if (!/^10\.77\.0\./.test(ip)) {
          found.add(`외부 VPN 터널 (${ip})`);
        }
      }
    } catch {
      // ignore
    }
  } else if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('ipconfig.exe', [], {
        windowsHide: true,
        timeout: 3000,
      });
      const lower = stdout.toLowerCase();
      if (lower.includes('cloudflarewarp') && lower.includes('172.16.0.2')) {
        found.add('Cloudflare WARP');
        hasWarp = true;
      }
      if (lower.includes('tailscale')) {
        found.add('Tailscale');
      }
      if (lower.includes('tap-windows') || lower.includes('openvpn')) {
        found.add('OpenVPN');
      }
    } catch {
      // ignore
    }
  }

  return { conflicts: Array.from(found), hasWarp };
}

async function isMacHelperReady(): Promise<boolean> {
  if (!fs.existsSync(MAC_HELPER_PATH)) return false;
  try {
    const { stdout } = await execFileAsync('/usr/bin/sudo', ['-n', MAC_HELPER_PATH, 'version']);
    return stdout.trim() === MAC_HELPER_VERSION;
  } catch {
    return false;
  }
}

async function ensureMacPrivilegedHelper(): Promise<void> {
  if (await isMacHelperReady()) return;

  const currentUser = os.userInfo().username;
  if (!/^[a-zA-Z0-9._-]+$/.test(currentUser)) {
    throw new Error('유효하지 않은 macOS 사용자 계정명입니다.');
  }

  const helperScript = [
    '#!/bin/sh',
    'set -e',
    'export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"',
    'CONF="/usr/local/etc/wireguard/wg3004.conf"',
    'DNS_BAK="/usr/local/etc/wireguard/wifi-dns.bak"',
    'LOCKDIR="/var/run/vpn3004.lock"',
    'mkdir -p /usr/local/etc/wireguard',
    'chmod 700 /usr/local/etc/wireguard',
    '',
    'acquire_lock() {',
    '  i=0',
    '  while ! mkdir "$LOCKDIR" 2>/dev/null; do',
    '    i=$((i + 1))',
    '    if [ "$i" -gt 40 ]; then rm -rf "$LOCKDIR"; break; fi',
    '    sleep 0.15',
    '  done',
    '  trap \'rm -rf "$LOCKDIR"\' EXIT INT TERM',
    '}',
    '',
    'flush_dns() {',
    '  dscacheutil -flushcache >/dev/null 2>&1 || true',
    '  killall -HUP mDNSResponder >/dev/null 2>&1 || true',
    '}',
    '',
    'backup_wifi_dns() {',
    '  if [ -f "$DNS_BAK" ]; then return 0; fi',
    '  cur="$(networksetup -getdnsservers Wi-Fi 2>/dev/null || true)"',
    '  if echo "$cur" | grep -qi "aren\'t any"; then',
    '    echo "Empty" > "$DNS_BAK"',
    '  elif [ "$cur" = "$(printf "1.1.1.1\\n8.8.8.8")" ]; then',
    '    echo "Empty" > "$DNS_BAK"',
    '  elif [ -n "$cur" ]; then',
    '    echo "$cur" | tr "\\n" " " > "$DNS_BAK"',
    '  else',
    '    echo "Empty" > "$DNS_BAK"',
    '  fi',
    '}',
    '',
    'restore_wifi_dns() {',
    '  target="Empty"',
    '  if [ -f "$DNS_BAK" ]; then',
    '    saved="$(cat "$DNS_BAK" 2>/dev/null || true)"',
    '    if [ -n "$saved" ]; then target="$saved"; fi',
    '    rm -f "$DNS_BAK"',
    '  fi',
    '  # shellcheck disable=SC2086',
    '  networksetup -setdnsservers Wi-Fi $target >/dev/null 2>&1 || true',
    '  networksetup -setsearchdomains Wi-Fi Empty >/dev/null 2>&1 || true',
    '}',
    '',
    'cleanup_stale_routes() {',
    '  if [ -f "$CONF" ]; then',
    '    ep_host="$(awk -F= \'/^Endpoint/{gsub(/[[:space:]]/, "", $2); split($2, a, ":"); print a[1]}\' "$CONF" 2>/dev/null || true)"',
    '    if [ -n "$ep_host" ]; then',
    '      ep_ip="$(dscacheutil -q host -a name "$ep_host" 2>/dev/null | awk \'/ip_address:/{print $2; exit}\')"',
    '      if [ -n "$ep_ip" ]; then',
    '        route -q -n delete -inet "$ep_ip" >/dev/null 2>&1 || true',
    '      fi',
    '    fi',
    '  fi',
    '  if [ ! -e /var/run/wireguard/wg3004.name ]; then',
    '    route -q -n delete -inet 0.0.0.0/1 >/dev/null 2>&1 || true',
    '    route -q -n delete -inet 128.0.0.0/1 >/dev/null 2>&1 || true',
    '  fi',
    '}',
    '',
    'case "$1" in',
    '  version)',
    `    echo "${MAC_HELPER_VERSION}"`,
    '    exit 0',
    '    ;;',
    '  check)',
    '    exit 0',
    '    ;;',
    '  up)',
    '    acquire_lock',
    '    if [ -f "$CONF" ]; then',
    '      wg-quick down "$CONF" >/dev/null 2>&1 || true',
    '      sleep 0.6',
    '    fi',
    '    cleanup_stale_routes',
    '    backup_wifi_dns',
    '    cat > "$CONF"',
    '    chmod 600 "$CONF"',
    '    wg-quick up "$CONF"',
    '    flush_dns',
    '    ;;',
    '  down)',
    '    acquire_lock',
    '    if [ -f "$CONF" ]; then',
    '      wg-quick down "$CONF" >/dev/null 2>&1 || true',
    '      sleep 0.5',
    '    fi',
    '    cleanup_stale_routes',
    '    restore_wifi_dns',
    '    flush_dns',
    '    ;;',
    '  repair)',
    '    acquire_lock',
    '    if [ -f "$CONF" ]; then',
    '      wg-quick down "$CONF" >/dev/null 2>&1 || true',
    '      sleep 0.5',
    '    fi',
    '    rm -f "$DNS_BAK"',
    '    cleanup_stale_routes',
    '    networksetup -setdnsservers Wi-Fi Empty >/dev/null 2>&1 || true',
    '    networksetup -setsearchdomains Wi-Fi Empty >/dev/null 2>&1 || true',
    '    flush_dns',
    '    ;;',
    '  *)',
    '    exit 2',
    '    ;;',
    'esac',
    '',
  ].join('\n');

  const b64Helper = Buffer.from(helperScript, 'utf-8').toString('base64');
  const sudoRule = `${currentUser} ALL=(root) NOPASSWD: ${MAC_HELPER_PATH}\n`;
  const b64Sudo = Buffer.from(sudoRule, 'utf-8').toString('base64');

  const installCmd = [
    'mkdir -p /usr/local/libexec /etc/sudoers.d',
    `echo "${b64Helper}" | /usr/bin/base64 -D > "${MAC_HELPER_PATH}"`,
    `/usr/sbin/chown root:wheel "${MAC_HELPER_PATH}"`,
    `/bin/chmod 755 "${MAC_HELPER_PATH}"`,
    `echo "${b64Sudo}" | /usr/bin/base64 -D > /etc/sudoers.d/vpn3004`,
    '/usr/sbin/chown root:wheel /etc/sudoers.d/vpn3004',
    '/bin/chmod 440 /etc/sudoers.d/vpn3004',
    '/usr/sbin/visudo -cf /etc/sudoers.d/vpn3004 >/dev/null',
  ].join(' && ');

  const osa = `do shell script ${JSON.stringify(installCmd)} with administrator privileges`;
  await execFileAsync('/usr/bin/osascript', ['-e', osa]);
}

function invokeMacHelper(action: 'up' | 'down' | 'repair', configText?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('/usr/bin/sudo', ['-n', MAC_HELPER_PATH, action], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += String(d);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `WireGuard 헬퍼 실행 실패 (code ${code})`));
    });
    if (configText) {
      proc.stdin.write(configText, 'utf-8');
    }
    proc.stdin.end();
  });
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

async function windowsTunnelServiceExists(): Promise<boolean> {
  try {
    await execFileAsync('sc.exe', ['query', 'WireGuardTunnel$3004VPN'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function configureStartupLaunch(enabled: boolean): Promise<void> {
  if (!app.isPackaged) return;
  if (process.platform === 'win32') {
    const exePath = process.execPath;
    if (enabled) {
      await execFileAsync(
        'schtasks.exe',
        [
          '/Create',
          '/TN',
          '3004VPN_AutoStart',
          '/TR',
          `"${exePath}" --minimized`,
          '/SC',
          'ONLOGON',
          '/RL',
          'HIGHEST',
          '/F',
        ],
        { windowsHide: true }
      ).catch(() => undefined);
    } else {
      await execFileAsync('schtasks.exe', ['/Delete', '/TN', '3004VPN_AutoStart', '/F'], {
        windowsHide: true,
      }).catch(() => undefined);
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
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
    // Fallback UAC elevation only if launched without admin manifest
    const escapedArgs = args.map((a) => `\`"${a.replace(/"/g, '')}\`"`).join(',');
    const psCmd = `Start-Process -FilePath "${wgExe}" -ArgumentList ${escapedArgs} -Verb RunAs -Wait -WindowStyle Hidden`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true });
  }
}

async function startWireGuardTunnel(configText: string, assignedIp: string, nodeName: string): Promise<TunnelRuntimeState> {
  if (tunnelOpInFlight) {
    return { ...state };
  }
  tunnelOpInFlight = true;
  state.connecting = true;
  state.lastError = null;
  state.toolMissing = false;
  broadcastState();

  const tunnelDir = path.join(app.getPath('userData'), 'tunnels');
  fs.mkdirSync(tunnelDir, { recursive: true });

  const normalizedConfig = normalizeWireGuardConfig(configText);

  try {
    if (process.platform === 'win32') {
      const confPath = path.join(tunnelDir, '3004VPN.conf');
      fs.writeFileSync(confPath, normalizedConfig, { encoding: 'ascii', mode: 0o600 });
      activeConfPath = confPath;
      if (await windowsTunnelServiceExists()) {
        await runWindowsWireGuardElevated(['/uninstalltunnelservice', '3004VPN']).catch(() => undefined);
      }
      await runWindowsWireGuardElevated(['/installtunnelservice', confPath]);
    } else if (process.platform === 'darwin') {
      const wgQuick = findMacBinary('wg-quick');
      if (!wgQuick) {
        state.toolMissing = true;
        throw new Error(
          'macOS WireGuard CLI(wireguard-tools)가 아직 설치되지 않았습니다. 터미널에서 brew install wireguard-tools 를 설치해 주세요.'
        );
      }
      await disconnectConflictingMacWarp();
      await ensureMacPrivilegedHelper();
      await invokeMacHelper('up', normalizedConfig);
    } else {
      const confPath = path.join(tunnelDir, 'wg3004.conf');
      fs.writeFileSync(confPath, normalizedConfig, { encoding: 'utf-8', mode: 0o600 });
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
  } finally {
    tunnelOpInFlight = false;
  }
}

async function stopWireGuardTunnel(silent = false): Promise<TunnelRuntimeState> {
  if (tunnelOpInFlight && !silent) {
    return { ...state };
  }
  tunnelOpInFlight = true;
  if (!silent) {
    state.connecting = true;
    broadcastState();
  }
  stopStatsPolling();

  try {
    if (process.platform === 'win32') {
      await runWindowsWireGuardElevated(['/uninstalltunnelservice', '3004VPN']).catch(() => undefined);
    } else if (process.platform === 'darwin') {
      if (await isMacHelperReady()) {
        await invokeMacHelper('down').catch(() => undefined);
      } else if (fs.existsSync(MAC_HELPER_PATH)) {
        await invokeMacHelper('down').catch(() => undefined);
      }
    }
  } finally {
    tunnelOpInFlight = false;
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

async function repairNetworkState(): Promise<boolean> {
  stopStatsPolling();
  if (process.platform === 'darwin') {
    await ensureMacPrivilegedHelper();
    await invokeMacHelper('repair');
  } else if (process.platform === 'win32') {
    await runWindowsWireGuardElevated(['/uninstalltunnelservice', '3004VPN']).catch(() => undefined);
    await execFileAsync('ipconfig.exe', ['/flushdns'], { windowsHide: true }).catch(() => undefined);
  }
  state.connected = false;
  state.connecting = false;
  state.connectedAt = null;
  state.rxSpeedBps = 0;
  state.txSpeedBps = 0;
  broadcastState();
  return true;
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
  let missingCount = 0;
  pollTimer = setInterval(async () => {
    if (!state.connected) return;
    if (process.platform === 'darwin' && state.assignedIp) {
      const alive = await isMacAssignedIpUp(state.assignedIp);
      if (!alive) {
        missingCount += 1;
        if (missingCount >= 2) {
          stopStatsPolling();
          state.connected = false;
          state.connectedAt = null;
          state.rxSpeedBps = 0;
          state.txSpeedBps = 0;
          state.lastError = '터널 인터페이스가 외부 요인(다른 VPN 또는 네트워크 전환)으로 해제되었습니다.';
          broadcastState();
          return;
        }
      } else {
        missingCount = 0;
      }
    }
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

async function measureIcmpPingMs(targetHost: string): Promise<number | null> {
  if (!/^[a-zA-Z0-9.-]+$/.test(targetHost)) return null;
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('ping.exe', ['-n', '1', '-w', '1200', targetHost], {
        windowsHide: true,
      });
      const m = stdout.match(/[=<](\d+)\s*ms/i);
      return m ? Math.max(1, Number(m[1])) : null;
    } else {
      const { stdout } = await execFileAsync('/sbin/ping', ['-c', '1', '-W', '1200', targetHost]);
      const m = stdout.match(/time[=<]([\d.]+)\s*ms/i);
      return m ? Math.max(1, Math.round(Number(m[1]))) : null;
    }
  } catch {
    return null;
  }
}

function createWindow(): void {
  const startHidden = process.argv.includes('--minimized');
  const iconCandidate = path.join(__dirname, '../resources/icon.png');
  mainWindow = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 820,
    minHeight: 580,
    show: !startHidden,
    title: '3004 VPN',
    icon: fs.existsSync(iconCandidate) ? iconCandidate : undefined,
    backgroundColor: '#09090B',
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 12 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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
  void configureStartupLaunch(initialSettings.launchAtStartup);

  tray = new Tray(createCircleIcon(false));
  tray.on('click', () => showMainWindow());
  updateTrayMenu();
  createWindow();

  ipcMain.handle('settings:get', () => loadSettings());

  ipcMain.handle('settings:update', async (_evt, patch: Partial<PersistedSettings>) => {
    const next = { ...loadSettings(), ...patch };
    saveSettings(next);
    if (typeof patch.launchAtStartup === 'boolean') {
      await configureStartupLaunch(patch.launchAtStartup);
    }
    return next;
  });

  ipcMain.handle('vpn:get-state', () => ({ ...state, platform: process.platform }));

  ipcMain.handle('win:minimize', () => mainWindow?.minimize());
  ipcMain.handle('win:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('win:close', () => mainWindow?.hide());

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
    // 1. When VPN tunnel is active on the home node, ping the direct tunnel gateway (10.77.0.1)
    if (state.connected && payload.isLocal) {
      const tunnelMs = await measureIcmpPingMs('10.77.0.1');
      if (tunnelMs !== null) return tunnelMs;
      try {
        const t0 = performance.now();
        const res = await fetch('http://10.77.0.1:8000/api/v1/ping', {
          signal: AbortSignal.timeout(1800),
        });
        if (res.ok) return Math.max(1, Math.round(performance.now() - t0));
      } catch {
        // fall through
      }
    }

    // 2. Direct ICMP ping to actual WireGuard server host (bypasses Cloudflare edge relay latency)
    const directIcmp = await measureIcmpPingMs(payload.host);
    if (directIcmp !== null) return directIcmp;

    // 3. Direct TCP handshake RTT if reachable, otherwise warmed HTTP keep-alive RTT
    const tcpMs = await measureTcpLatencyMs(payload.host, 443);
    if (tcpMs !== null) return tcpMs;

    if (payload.isLocal) {
      try {
        const clean = payload.apiUrl.replace(/\/+$/, '');
        // Warm up TLS connection first so we measure pure round-trip latency, not TLS handshake
        await fetch(`${clean}/api/v1/ping`, { signal: AbortSignal.timeout(2500) });
        const t1 = performance.now();
        const res = await fetch(`${clean}/api/v1/ping`, { signal: AbortSignal.timeout(2500) });
        if (res.ok) return Math.max(1, Math.round(performance.now() - t1));
      } catch {
        // ignore
      }
    }
    return null;
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

  ipcMain.handle('net:check-vpn-conflicts', async () => detectConflictingVpns());

  ipcMain.handle('net:disconnect-warp', async () => disconnectConflictingMacWarp());

  ipcMain.handle('net:repair-network', async () => repairNetworkState());
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showMainWindow();
  }
});
