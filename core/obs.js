'use strict';
// OBS finden, Version lesen, Start/Lauf prüfen, obs-websocket-Konfiguration vorbereiten.
const fs = require('node:fs');
const nodePath = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { run, exists } = require('./util');
const { iniGet, iniSet } = require('./ini');

const MIN_OBS_MAJOR = 30;

const majorOf = (version) => parseInt(String(version || '').split('.')[0], 10) || 0;

/**
 * Sucht OBS. Rückgabe: { dir, exe, cwd, version, major } oder null.
 * `env` ist überschreibbar (DC_OBS_DIR für Windows, DC_OBS_APP für macOS), `exec` für Tests.
 */
async function findObs(platform, { env = process.env, exec = run } = {}) {
  if (platform === 'windows') {
    const candidates = [];
    if (env.DC_OBS_DIR) candidates.push(env.DC_OBS_DIR);
    const reg = await exec('reg', ['query', 'HKLM\\SOFTWARE\\OBS Studio', '/ve']);
    const m = reg.stdout.match(/REG_SZ\s+(.+)\s*$/m);
    if (m) candidates.push(m[1].trim());
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files']) {
      if (base) candidates.push(nodePath.win32.join(base, 'obs-studio'));
    }
    for (const dir of candidates) {
      const cwd = nodePath.win32.join(dir, 'bin', '64bit');
      const exe = nodePath.win32.join(cwd, 'obs64.exe');
      if (!exists(exe)) continue;
      const v = await exec('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`]);
      const version = v.stdout.trim().match(/\d+(\.\d+)*/)?.[0] || '';
      return { dir, exe, cwd, version, major: majorOf(version) };
    }
    return null;
  }
  if (platform === 'macos') {
    const home = env.HOME || '';
    for (const app of [env.DC_OBS_APP, '/Applications/OBS.app', nodePath.join(home, 'Applications', 'OBS.app')].filter(Boolean)) {
      const plist = nodePath.join(app, 'Contents', 'Info.plist');
      if (!exists(plist)) continue;
      const v = await exec('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]);
      const version = v.stdout.trim();
      return { dir: app, exe: nodePath.join(app, 'Contents', 'MacOS', 'OBS'), cwd: nodePath.join(app, 'Contents', 'MacOS'), version, major: majorOf(version) };
    }
    return null;
  }
  const which = await exec('which', ['obs']);
  const exe = which.stdout.trim();
  if (!exe) return null;
  const v = await exec(exe, ['--version']);
  const version = v.stdout.match(/(\d+\.\d+(\.\d+)?)/)?.[1] || '';
  return { dir: nodePath.dirname(exe), exe, cwd: nodePath.dirname(exe), version, major: majorOf(version) };
}

async function isObsRunning(platform, { exec = run } = {}) {
  if (platform === 'windows') {
    const r = await exec('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH']);
    return /obs64\.exe/i.test(r.stdout);
  }
  const r = await exec('pgrep', ['-x', platform === 'macos' ? 'OBS' : 'obs']);
  return r.code === 0;
}

/** Startet OBS losgelöst mit unserer Collection und unserem Profil. */
function launchObs(info, { collection, profile = collection, extraArgs = [], env = process.env, wrapper = [] } = {}) {
  const args = ['--collection', collection, '--profile', profile, '--disable-shutdown-check', ...extraArgs];
  const [cmd, ...pre] = wrapper.length ? [...wrapper, info.exe] : [info.exe];
  const child = spawn(cmd, [...pre, ...args], { cwd: info.cwd, env, detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return child;
}

/**
 * Stellt sicher, dass obs-websocket (in OBS ab 28 eingebaut) auf localhost lauscht und ein Passwort bekannt ist.
 * Bestehende Einstellungen des Nutzers (Port, Passwort) bleiben erhalten. Rückgabe: { port, password, changed }.
 * Je nach OBS-Version liegt die Konfiguration in plugin_config/obs-websocket/config.json (neuere obs-websocket-Versionen)
 * oder in global.ini, Abschnitt [OBSWebSocket] (OBS 30 mit obs-websocket 5.3). Wir pflegen beide, damit jede Version sie findet.
 */
function ensureWebsocketConfig(obsConfigDir, { backup } = {}) {
  const jsonFile = nodePath.join(obsConfigDir, 'plugin_config', 'obs-websocket', 'config.json');
  const iniFile = nodePath.join(obsConfigDir, 'global.ini');
  const SEC = 'OBSWebSocket';

  let cfg = null;
  if (exists(jsonFile)) { try { cfg = JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } catch { cfg = null; } }
  const legacy = {
    server_port: iniGet(iniFile, SEC, 'ServerPort'),
    server_password: iniGet(iniFile, SEC, 'ServerPassword'),
    auth_required: iniGet(iniFile, SEC, 'AuthRequired'),
  };
  const before = JSON.stringify([cfg, legacy]);
  cfg = cfg || {};
  cfg.server_port = Number(cfg.server_port || legacy.server_port) || 4455;
  if (cfg.server_password === undefined && legacy.server_password) cfg.server_password = legacy.server_password;
  if (cfg.auth_required === undefined && legacy.auth_required !== undefined) cfg.auth_required = legacy.auth_required === 'true';
  cfg.server_enabled = true;
  cfg.first_load = false;
  cfg.alerts_enabled = false;
  if (cfg.auth_required !== false && !cfg.server_password) cfg.server_password = crypto.randomBytes(12).toString('base64url');
  if (cfg.auth_required === undefined) cfg.auth_required = true;

  const wanted = {
    FirstLoad: 'false', ServerEnabled: 'true', ServerPort: String(cfg.server_port), AlertsEnabled: 'false',
    AuthRequired: String(cfg.auth_required), ServerPassword: cfg.auth_required ? cfg.server_password : '',
  };
  const iniNow = Object.fromEntries(Object.keys(wanted).map((k) => [k, iniGet(iniFile, SEC, k)]));
  const iniChanged = Object.keys(wanted).some((k) => iniNow[k] !== wanted[k]);
  const jsonChanged = JSON.stringify(cfg) !== JSON.stringify(exists(jsonFile) ? safeJson(jsonFile) : null);

  if (jsonChanged) {
    backup?.add(jsonFile);
    fs.mkdirSync(nodePath.dirname(jsonFile), { recursive: true });
    fs.writeFileSync(jsonFile, JSON.stringify(cfg, null, 4) + '\n', 'utf8');
  }
  if (iniChanged) {
    backup?.add(iniFile);
    for (const [k, val] of Object.entries(wanted)) iniSet(iniFile, SEC, k, val);
  }
  return { port: cfg.server_port, password: cfg.auth_required ? cfg.server_password : '', changed: before !== JSON.stringify([safeJson(jsonFile), {
    server_port: iniGet(iniFile, SEC, 'ServerPort'), server_password: iniGet(iniFile, SEC, 'ServerPassword'), auth_required: iniGet(iniFile, SEC, 'AuthRequired') }]) };
}

function safeJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

module.exports = { MIN_OBS_MAJOR, majorOf, findObs, isObsRunning, launchObs, ensureWebsocketConfig };
