import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vpnDesktop', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:update', patch),
  getVpnState: () => ipcRenderer.invoke('vpn:get-state'),
  minimizeWindow: () => ipcRenderer.invoke('win:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('win:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('win:close'),
  connectTunnel: (payload: { config: string; assignedIp: string; nodeName: string }) =>
    ipcRenderer.invoke('vpn:connect', payload),
  disconnectTunnel: () => ipcRenderer.invoke('vpn:disconnect'),
  saveConfFile: (payload: { filename: string; content: string }) =>
    ipcRenderer.invoke('vpn:save-conf', payload),
  measurePing: (payload: { host: string; apiUrl: string; isLocal: boolean }) =>
    ipcRenderer.invoke('net:ping', payload),
  fetchPublicIp: (apiUrl: string) => ipcRenderer.invoke('net:public-ip', apiUrl),
  checkVpnConflicts: () => ipcRenderer.invoke('net:check-vpn-conflicts'),
  disconnectWarp: () => ipcRenderer.invoke('net:disconnect-warp'),
  onStateChange: (cb: (state: unknown) => void) => {
    const handler = (_evt: Electron.IpcRendererEvent, s: unknown) => cb(s);
    ipcRenderer.on('vpn:state', handler);
    return () => ipcRenderer.removeListener('vpn:state', handler);
  },
  onTrayQuickConnect: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('tray:quick-connect', handler);
    return () => ipcRenderer.removeListener('tray:quick-connect', handler);
  },
});
