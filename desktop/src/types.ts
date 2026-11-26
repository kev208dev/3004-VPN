export interface UserProfile {
  id: number;
  username: string;
  role: 'admin' | 'member';
  enabled: boolean;
  created_at: string;
}

export interface VpnNode {
  id: string;
  name: string;
  region: string;
  country_flag: string;
  host: string;
  port: number;
  endpoint: string;
  subnet: string;
  is_local: boolean;
  enabled: boolean;
}

export interface ConnectSession {
  device_id: number;
  node_id: string;
  node_name: string;
  region: string;
  assigned_ip: string;
  dns: string;
  endpoint: string;
  server_public_key: string;
  allowed_ips: string;
  config: string;
}

export interface PersistedSettings {
  apiUrl: string;
  token: string | null;
  deviceUid: string;
  deviceName: string;
  selectedNodeId: string | null;
  launchAtStartup: boolean;
  autoConnect: boolean;
  tunnelMode: 'full' | 'split';
  cachedUser?: UserProfile | null;
  cachedNodes?: VpnNode[];
  cachedSessions?: Record<string, ConnectSession>;
}

export interface TunnelRuntimeState {
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
  platform?: string;
}

export interface MyDeviceItem {
  id: number;
  node_id: string;
  node_name?: string;
  node_region?: string;
  device_uid: string;
  device_name: string;
  platform: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'other' | string;
  assigned_ip: string;
  mode: string;
  enabled: boolean;
  online?: boolean;
  handshake_ago_sec?: number | null;
  rx_bytes?: number;
  tx_bytes?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AdminDeviceItem {
  id: number;
  username: string;
  node_id: string;
  node_name: string;
  device_name: string;
  platform: string;
  assigned_ip: string;
  mode: string;
  enabled: boolean;
  online: boolean;
  handshake_ago_sec: number | null;
  rx_bytes: number;
  tx_bytes: number;
}

export interface AdminInviteItem {
  id: number;
  code: string;
  memo: string;
  max_uses: number;
  used_count: number;
  created_at: string;
}

export interface AdminOverview {
  users: UserProfile[];
  invites: AdminInviteItem[];
  nodes: VpnNode[];
  devices: AdminDeviceItem[];
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface AppUpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  progress: number;
  message: string | null;
  manualDownloadUrl: string | null;
}

declare global {
  interface Window {
    vpnDesktop?: {
      platform?: string;
      getSettings: () => Promise<PersistedSettings>;
      updateSettings: (patch: Partial<PersistedSettings>) => Promise<PersistedSettings>;
      getVpnState: () => Promise<TunnelRuntimeState>;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      connectTunnel: (payload: {
        config: string;
        assignedIp: string;
        nodeName: string;
      }) => Promise<TunnelRuntimeState>;
      connectCachedTunnel: (payload: { nodeName: string }) => Promise<TunnelRuntimeState>;
      disconnectTunnel: () => Promise<TunnelRuntimeState>;
      saveConfFile: (payload: { filename: string; content: string }) => Promise<boolean>;
      measurePing: (payload: {
        host: string;
        apiUrl: string;
        isLocal: boolean;
      }) => Promise<number | null>;
      fetchPublicIp: (apiUrl: string) => Promise<string>;
      checkVpnConflicts: () => Promise<{ conflicts: string[]; hasWarp: boolean }>;
      disconnectWarp: () => Promise<boolean>;
      repairNetwork: () => Promise<boolean>;
      getUpdateState: () => Promise<AppUpdateState>;
      checkForUpdates: () => Promise<AppUpdateState>;
      installUpdate: () => Promise<void>;
      onStateChange: (cb: (state: TunnelRuntimeState) => void) => () => void;
      onUpdateStateChange: (cb: (state: AppUpdateState) => void) => () => void;
      onTrayQuickConnect: (cb: () => void) => () => void;
    };
  }
}
