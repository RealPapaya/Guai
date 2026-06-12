// @ts-check
// The ONLY thing the renderer can see. contextIsolation + sandbox are on, so this runs
// in an isolated world and exposes a frozen, explicit API over IPC — the renderer never
// touches Node, fs, sqlite, or child_process. Every method returns {ok,data}|{ok,error}.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('guai', {
  status: () => invoke('guai:status'),
  getConfig: () => invoke('guai:config:get'),
  saveConfig: (cfg) => invoke('guai:config:save', cfg),
  setMonitor: (domain, enabled) => invoke('guai:monitors:set', { domain, enabled }),
  runSweep: () => invoke('guai:sweep'),
  brief: () => invoke('guai:brief'),
  actions: () => invoke('guai:actions'),
  decide: (id, status) => invoke('guai:decide', { id, status }),
  getSchedule: () => invoke('guai:schedule:get'),
  setSchedule: (schedule) => invoke('guai:schedule:set', schedule),
  openDashboard: () => invoke('guai:dashboard:open'),
  // Fired by the main process after a scheduled/tray-triggered job completes.
  onRefreshed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('guai:refreshed', handler);
    return () => ipcRenderer.removeListener('guai:refreshed', handler);
  },
});
