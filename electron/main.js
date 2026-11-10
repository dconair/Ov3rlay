'use strict';
// Hauptprozess: Fenster, IPC. Die eigentliche Arbeit liegt in core/ (identisch mit der Kommandozeile).
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const nodePath = require('node:path');
const fs = require('node:fs');
const core = require('../core');
const { readText } = require('../core/ini');

const payloadDir = core.resolvePayloadDir();
const platform = core.platformLib.detectPlatform();
const paths = core.platformLib.defaultPaths(platform);
const brand = core.installLib.brandEnv(payloadDir);

let win;
let session = null; // { ws }  laufende Verbindung zu OBS

const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };
const sceneFile = () => nodePath.join(paths.obsConfig, 'basic', 'scenes', `${brand.COLLECTION}.json`);
const readDoc = () => JSON.parse(readText(sceneFile()));

async function obsSession() {
  if (session && !session.ws.closed) return session.ws;
  const obsInfo = await core.obs.findObs(platform);
  const ws = await core.connectObs({ platform, paths, collection: brand.COLLECTION, obsInfo, onWait: () => send('progress', { phase: 'obs-wait' }), timeoutMs: 120000 });
  session = { ws };
  return ws;
}

const handlers = {
  async 'state:get'() {
    const obsInfo = await core.obs.findObs(platform);
    const enc = await core.encoder.detectEncoder(platform);
    return {
      platform, appVersion: app.getVersion(), collection: brand.COLLECTION, name: brand.NAME,
      obs: obsInfo ? { ...obsInfo, ok: obsInfo.major >= core.obs.MIN_OBS_MAJOR, running: await core.obs.isObsRunning(platform) } : null,
      minObs: core.obs.MIN_OBS_MAJOR,
      status: core.installLib.status({ payloadDir, paths }),
      encoder: { suggested: enc.id, gpus: enc.gpus, options: Object.values(core.encoder.ENCODERS).filter((e) => platform === 'macos' ? e.id === 'apple' || e.id === 'x264' : e.id !== 'apple') },
      qualities: Object.values(core.installLib.QUALITIES).map((q) => q.label),
      services: core.installLib.SERVICES, defaults: core.installLib.DEFAULTS,
      backups: core.backupLib.listBackups(paths.appDir).map((b) => ({ stamp: b.stamp, files: b.entries.length })),
      paths,
    };
  },

  async 'obs:running'() { return core.obs.isObsRunning(platform); },

  async 'install:run'({ service, quality, encoder }) {
    const cams = await core.cameras.listSystemCameras(platform);
    const taken = [];
    const cameras = {};
    for (const role of core.cameras.ROLES) {
      const c = core.cameras.guessCamera(role, cams, taken);
      if (c) { cameras[role.key] = c; taken.push(c.id); }
    }
    const r = await core.installLib.install({ payloadDir, platform, paths, service, quality, encoder: core.encoder.encoderById(encoder), cameras, log: (t) => send('progress', { phase: 'install', text: t }) });
    return { variant: r.variant, backupDir: r.backupDir, quality: r.quality, encoder: r.encoder };
  },

  async 'cameras:discover'() {
    const ws = await obsSession();
    const inputs = core.cameras.cameraInputs(readDoc());
    const taken = [];
    const roles = [];
    for (const role of core.cameras.ROLES) {
      const input = core.cameras.inputForRole(role, inputs);
      const devices = input ? await core.cameras.listObsDevices(ws, input) : [];
      const guess = core.cameras.guessCamera(role, devices, taken);
      if (guess) taken.push(guess.id);
      roles.push({ key: role.key, label: role.label, hint: role.hint, input: input?.name || null, devices, guess: guess?.id || '' });
    }
    return roles;
  },

  async 'cameras:assign'({ assignments }) {
    const ws = await obsSession();
    const inputs = core.cameras.cameraInputs(readDoc());
    for (const role of core.cameras.ROLES) {
      const id = assignments[role.key];
      const input = core.cameras.inputForRole(role, inputs);
      if (!id || !input) continue;
      const device = (await core.cameras.listObsDevices(ws, input)).find((d) => d.id === id);
      if (device) await core.cameras.assignCamera(ws, input, device);
    }
    await core.forceSave(ws);
    return true;
  },

  async 'selftest:run'() {
    const ws = await obsSession();
    const shotsDir = nodePath.join(paths.appDir, 'selftest', new Date().toISOString().replace(/[:.]/g, '-'));
    const result = await core.selftest({ ws, paths, collection: brand.COLLECTION, shotsDir, onProgress: (p) => send('progress', { phase: 'selftest', ...p }) });
    return { ...result, shotsDir };
  },

  async 'maintenance:uninstall'() {
    const r = await core.installLib.uninstall({ payloadDir, platform, paths });
    return r;
  },
  async 'maintenance:restore'({ stamp }) { return core.backupLib.restoreBackup(paths.appDir, stamp); },

  async 'shell:open'({ target }) {
    if (/^https:\/\//.test(target)) return shell.openExternal(target);
    if (target.startsWith(paths.appDir)) return shell.openPath(target);
    throw new Error('Nicht erlaubt');
  },
};

function createWindow() {
  win = new BrowserWindow({
    width: 940, height: 700, minWidth: 780, minHeight: 600, backgroundColor: '#0a0a10', title: 'dc_onair Setup',
    webPreferences: { preload: nodePath.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu?.();
  win.loadFile(nodePath.join(__dirname, 'renderer', 'index.html'));
  // Externe Links im Standardbrowser, nie im App-Fenster
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (_e, payload) => {
    try { return { ok: true, data: await fn(payload || {}) }; } catch (e) { return { ok: false, error: e.message }; }
  });
}

// Zum Testen: Seite ohne Mensch durchlaufen (Screenshots in CI)
if (!process.env.DC_NO_SINGLE_INSTANCE && !app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(() => { Menu.setApplicationMenu(null); createWindow(); });
app.on('window-all-closed', () => { session?.ws.close(); app.quit(); });
