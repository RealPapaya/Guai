// @ts-check
// Guai desktop — Electron MAIN process (CommonJS, so there's no ESM-in-Electron
// friction; main never imports the ESM core). It owns the window + tray, brokers every
// privileged op by spawning `node scripts/control.mjs <cmd>` (the bridge), and runs the
// in-app daily scheduler while the app is open. The renderer stays fully sandboxed:
// contextIsolation on, nodeIntegration off — it only sees window.guai from preload.
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, shell, nativeImage } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { existsSync } = require('node:fs');

const ROOT = join(__dirname, '..');                 // the Guai repo root
const CONTROL = join('scripts', 'control.mjs');      // relative to ROOT (cwd of the spawn)
const ICON = join(__dirname, 'assets', 'icon.png');

/** Absolute path to a system Node ≥22.5 (needs node:sqlite). Electron's bundled Node
 *  isn't guaranteed to ship node:sqlite, so we shell out to the real one. */
const NODE = (() => {
  if (process.env.GUAI_NODE) return process.env.GUAI_NODE;
  try {
    const where = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(where, ['node'], { encoding: 'utf8' });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first) return first;
  } catch { /* fall through */ }
  return 'node'; // last resort: rely on PATH
})();

/** @type {BrowserWindow | null} */ let win = null;
/** @type {Tray | null} */ let tray = null;
/** @type {ReturnType<typeof setTimeout> | null} */ let dailyTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */ let sweepTimer = null;
let armed = false;
let quitting = false;

// --- the bridge ---------------------------------------------------------------

/**
 * Spawn `node scripts/control.mjs ...args`, optionally piping JSON to stdin, and
 * resolve its parsed stdout. Rejects with the bridge's {error} on non-zero exit.
 * @param {string[]} args
 * @param {string=} stdin
 * @returns {Promise<any>}
 */
function runControl(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [CONTROL, ...args], { cwd: ROOT, windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => reject(new Error(`Could not run Node ("${NODE}"): ${e.message}. Install Node ≥22.5 or set GUAI_NODE.`)));
    child.on('close', (code) => {
      if (code === 0) {
        try { resolve(out.trim() ? JSON.parse(out) : null); }
        catch (e) { reject(new Error(`Bad JSON from control.mjs ${args[0]}: ${/** @type {Error} */ (e).message}`)); }
      } else {
        let msg = err.trim();
        try { msg = JSON.parse(err).error ?? msg; } catch { /* keep raw */ }
        reject(new Error(msg || `control.mjs ${args[0]} exited ${code}`));
      }
    });
    if (stdin != null) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/** Register an IPC handler that always answers {ok,data} | {ok:false,error}. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, payload) => {
    try { return { ok: true, data: await fn(payload) }; }
    catch (e) { return { ok: false, error: String(/** @type {Error} */ (e).message || e) }; }
  });
}

handle('guai:status', () => runControl(['status']));
handle('guai:config:get', () => runControl(['config-get']));
handle('guai:config:save', (cfg) => runControl(['config-set'], JSON.stringify(cfg)));
handle('guai:monitors:set', ({ domain, enabled }) => runControl(['monitors-set', `--domain=${domain}`, `--enabled=${enabled}`]));
handle('guai:sweep', () => runControl(['sweep']));
handle('guai:brief', () => runControl(['brief', '--save']));
handle('guai:actions', () => runControl(['actions']));
handle('guai:decide', ({ id, status }) => runControl(['decide', `--id=${id}`, `--status=${status}`]));
handle('guai:schedule:get', () => runControl(['schedule-get']));
handle('guai:schedule:set', async (sched) => {
  const res = await runControl(['schedule-set'], JSON.stringify(sched));
  await applySchedule();        // re-arm the in-app timers to match the new intent
  return res;
});
handle('guai:dashboard:open', async () => {
  const { path } = await runControl(['dashboard']);
  await shell.openPath(path);
  return { path };
});

// --- the in-app scheduler (fires while the app/tray is open) -------------------

/** ms until the next HH:MM, skipping weekends when weekdaysOnly. */
function msUntil(hour, minute, weekdaysOnly) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  if (weekdaysOnly) while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function clearTimers() {
  if (dailyTimer) clearTimeout(dailyTimer);
  if (sweepTimer) clearInterval(sweepTimer);
  dailyTimer = sweepTimer = null;
}

/** Run a deterministic job and notify on the top hot item. */
async function runJob(kind) {
  try {
    const res = await runControl([kind]); // 'daily' or 'sweep'
    const hot = (res?.hot ?? res?.sweep?.hot ?? []);
    if (hot.length && Notification.isSupported()) {
      new Notification({ title: 'Guai', body: String(hot[0].title).slice(0, 200) }).show();
    }
    if (win && !win.isDestroyed()) win.webContents.send('guai:refreshed');
  } catch (e) {
    console.error(`scheduled ${kind} failed:`, /** @type {Error} */ (e).message);
  }
}

function scheduleDaily(s) {
  const ms = msUntil(s.dailyBriefHour ?? 7, s.dailyBriefMinute ?? 57, s.weekdaysOnly !== false);
  dailyTimer = setTimeout(async () => { await runJob('daily'); scheduleDaily(s); }, ms);
}

/** Read the persisted schedule and (re)arm in-app timers to match. */
async function applySchedule() {
  clearTimers();
  try {
    const { schedule } = await runControl(['schedule-get']);
    armed = !!schedule?.enabled;
    if (armed) {
      scheduleDaily(schedule);
      const everyMs = (schedule.sweepEveryMinutes ?? 180) * 60_000;
      sweepTimer = setInterval(() => runJob('sweep'), everyMs);
    }
  } catch (e) {
    armed = false;
    console.error('applySchedule failed:', /** @type {Error} */ (e).message);
  }
  refreshTray();
}

// --- tray + window ------------------------------------------------------------

function trayIcon() {
  if (existsSync(ICON)) {
    const img = nativeImage.createFromPath(ICON);
    return process.platform === 'win32' ? img : img.resize({ width: 18, height: 18 });
  }
  return nativeImage.createEmpty();
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`Guai — ${armed ? 'armed' : 'idle'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: armed ? '● Armed (daily report on)' : '○ Idle', enabled: false },
    { type: 'separator' },
    { label: 'Open Guai', click: showWindow },
    { label: 'Run sweep now', click: () => runJob('sweep') },
    {
      label: armed ? 'Deactivate daily report' : 'Activate daily report',
      click: async () => {
        const { schedule } = await runControl(['schedule-get']);
        await runControl(['schedule-set'], JSON.stringify({ ...schedule, enabled: !armed }));
        await applySchedule();
        if (win && !win.isDestroyed()) win.webContents.send('guai:refreshed');
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function showWindow() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  createWindow();
}

function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 760, minWidth: 720, minHeight: 560,
    title: 'Guai — Chief of Staff',
    backgroundColor: '#0f1115',
    icon: existsSync(ICON) ? ICON : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(join(__dirname, 'renderer', 'index.html'));
  // Closing the window hides to tray (a chief-of-staff lives in the background).
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win?.hide(); } });

  // Headless smoke test (GUAI_SMOKE=1): surface renderer errors, then self-quit.
  if (process.env.GUAI_SMOKE) {
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.error('SMOKE renderer error:', message);
    });
    win.webContents.on('did-finish-load', () => console.log('SMOKE: renderer loaded ok'));
  }
}

if (process.env.GUAI_SMOKE) app.disableHardwareAcceleration(); // avoid GPU needs when headless

app.whenReady().then(async () => {
  createWindow();
  try { tray = new Tray(trayIcon()); refreshTray(); } catch (e) { console.error('tray init failed:', e); }
  await applySchedule();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

  if (process.env.GUAI_SMOKE) {
    console.log(`SMOKE: app ready · node=${NODE} · armed=${armed}`);
    setTimeout(() => { console.log('SMOKE: ok, quitting'); quitting = true; app.quit(); }, 3500);
  }
});

// Keep running in the tray when all windows are closed (don't quit on Windows/Linux).
app.on('window-all-closed', () => { /* stay alive in tray */ });
app.on('before-quit', () => { quitting = true; clearTimers(); });
