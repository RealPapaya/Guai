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
  // Accounts: status is {set,source} only — the raw token never reaches the renderer.
  getSecrets: () => invoke('guai:secrets:get'),
  saveSecret: (name, value) => invoke('guai:secrets:set', { name, value }),
  runSweep: () => invoke('guai:sweep'),
  brief: () => invoke('guai:brief'),
  actions: () => invoke('guai:actions'),
  decide: (id, status) => invoke('guai:decide', { id, status }),
  getSchedule: () => invoke('guai:schedule:get'),
  setSchedule: (schedule) => invoke('guai:schedule:set', schedule),
  openDashboard: () => invoke('guai:dashboard:open'),
  syncUsage: () => invoke('guai:usage:sync'),
  usageSummary: () => invoke('guai:usage:summary'),
  usageCharts: (opts) => invoke('guai:usage:charts', opts || {}),
  showUsageMini: () => invoke('guai:usage:mini:show'),
  hideUsageMini: () => invoke('guai:usage:mini:hide'),
  usageSessions: (filters) => invoke('guai:usage:sessions', filters),
  usageSession: (provider, id) => invoke('guai:usage:session', { provider, id }),
  // Chat console: run ONE whitelisted, read-only control command (no args/stdin). The
  // main process is the real gate (see CONSOLE_CMDS) — this is the LLM-ready send seam.
  runControl: (cmd) => invoke('guai:control', { cmd }),
  // Jobs: the autonomy units authored on the Jobs tab, persisted into config.jobs.
  getJobs: () => invoke('guai:jobs:get'),
  saveJobs: (jobs) => invoke('guai:jobs:save', jobs),
  // Fired by the main process after a scheduled/tray-triggered job completes.
  onRefreshed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('guai:refreshed', handler);
    return () => ipcRenderer.removeListener('guai:refreshed', handler);
  },
});
