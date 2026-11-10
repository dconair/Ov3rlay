'use strict';
// Installation, Deinstallation und Statusabfrage. Reine Dateioperationen, ohne OBS-Verbindung.
const fs = require('node:fs');
const nodePath = require('node:path');
const { run, exists } = require('./util');
const { iniSet, iniGet, readText, writeText } = require('./ini');
const { renderJson, render, tokensIn } = require('./template');
const { systemFont } = require('./platform');
const { Backup } = require('./backup');
const { ensureWebsocketConfig } = require('./obs');
const { ROLES } = require('./cameras');

/** Auflösung, Bildrate und Bitrate (kbit/s) nach den Empfehlungen von Twitch bzw. YouTube. */
const QUALITIES = {
  '1080p30': { label: '1080p30', w: 1920, h: 1080, fps: 30, bitrate: { twitch: 6000, other: 6000 } },
  '1080p60': { label: '1080p60', w: 1920, h: 1080, fps: 60, bitrate: { twitch: 6000, other: 9000 } },
  '720p60': { label: '720p60', w: 1280, h: 720, fps: 60, bitrate: { twitch: 4500, other: 6000 } },
};
const SERVICES = { twitch: 'Twitch', youtube: 'YouTube', custom: 'Anderer Dienst (Server und Schlüssel später in OBS)' };
const DEFAULTS = { service: 'twitch', quality: '1080p30' };

function brandEnv(payloadDir) {
  const out = {};
  for (const line of readText(nodePath.join(payloadDir, 'brand.env')).split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

/** Plugin "Move Transition" vorhanden? Dann wird die .move-Variante der Collection genutzt. */
function moveInstalled(platform, { obsConfig, env = process.env }) {
  const dirs = [nodePath.join(obsConfig, 'plugins')];
  if (platform === 'windows') dirs.push(nodePath.win32.join(env.ProgramFiles || 'C:\\Program Files', 'obs-studio', 'obs-plugins', '64bit'), nodePath.win32.join(env.ProgramData || 'C:\\ProgramData', 'obs-studio', 'plugins'));
  if (platform === 'macos') dirs.push('/Library/Application Support/obs-studio/plugins');
  return dirs.some((d) => exists(d) && fs.readdirSync(d).some((f) => /move.*transition|move_transition|move-transition/i.test(f)));
}

const FONT_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';

function listFonts(dir) {
  const out = [];
  const walk = (d) => { if (!exists(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = nodePath.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ttf|otf)$/i.test(e.name)) out.push(p); } };
  walk(dir);
  return out;
}

/**
 * Richtet OBS ein. Alle Parameter siehe unten; `cameras` = { iphone: { id, name }, sony: { ... } } (optional).
 * Gibt einen Bericht zurück, der auch als appDir/install.json gespeichert wird.
 */
async function install(opts) {
  const { payloadDir, platform, paths, encoder, cameras = {}, log = () => {}, env = process.env, exec = run, registerFonts = platform === 'windows' && !env.DC_FONT_DIR } = opts;
  const service = opts.service || DEFAULTS.service;
  const quality = QUALITIES[opts.quality || DEFAULTS.quality];
  if (!SERVICES[service]) throw new Error(`Unbekannter Dienst: ${service}`);
  if (!quality) throw new Error(`Unbekannte Qualität: ${opts.quality}`);
  if (!exists(nodePath.join(payloadDir, 'brand.env'))) throw new Error(`Payload nicht gefunden: ${payloadDir}`);

  const brand = brandEnv(payloadDir);
  const collection = brand.COLLECTION;
  const backup = new Backup(paths.appDir, opts.stamp);
  const move = opts.move ?? moveInstalled(platform, { obsConfig: paths.obsConfig, env });
  const variant = `${platform}${move ? '.move' : ''}`;
  const sceneTemplate = nodePath.join(payloadDir, 'scenes', `${collection}.${variant}.json`);
  if (!exists(sceneTemplate)) throw new Error(`Szenen-Vorlage fehlt: ${nodePath.basename(sceneTemplate)}`);

  const sceneFile = nodePath.join(paths.obsConfig, 'basic', 'scenes', `${collection}.json`);
  const profileDir = nodePath.join(paths.obsConfig, 'basic', 'profiles', collection);
  const assetsDir = nodePath.join(paths.appDir, 'assets');
  const iniFiles = ['global.ini', 'user.ini'].map((f) => nodePath.join(paths.obsConfig, f));

  // 1. Sicherung, bevor irgendetwas geändert wird
  for (const p of [sceneFile, profileDir, assetsDir, ...iniFiles]) backup.add(p);
  const manifestFile = nodePath.join(paths.appDir, 'install.json');
  // Beim erneuten Installieren die Werte der ersten Installation behalten (nicht unsere eigenen)
  const earlier = exists(manifestFile) ? JSON.parse(readText(manifestFile)).previous : null;
  const previous = earlier || Object.fromEntries(iniFiles.map((f) => [nodePath.basename(f), Object.fromEntries(
    ['Profile', 'ProfileDir', 'SceneCollection', 'SceneCollectionFile'].map((k) => [k, iniGet(f, 'Basic', k)]))]));

  // 2. Assets
  fs.rmSync(assetsDir, { recursive: true, force: true });
  fs.mkdirSync(paths.appDir, { recursive: true });
  fs.cpSync(nodePath.join(payloadDir, 'assets'), assetsDir, { recursive: true });
  fs.rmSync(nodePath.join(assetsDir, 'fonts', 'HIER_SCHRIFTEN_ABLEGEN.txt'), { force: true });
  log(`Grafiken und Videos nach ${assetsDir} kopiert`);

  // 3. Schriften
  let fontFace = systemFont(platform);
  const fonts = listFonts(nodePath.join(assetsDir, 'fonts'));
  const installedFonts = [];
  if (fonts.length) {
    fs.mkdirSync(paths.fontDir, { recursive: true });
    for (const f of fonts) {
      const target = nodePath.join(paths.fontDir, nodePath.basename(f));
      backup.add(target);
      fs.copyFileSync(f, target);
      installedFonts.push(target);
      if (registerFonts) {
        const type = /\.otf$/i.test(f) ? 'OpenType' : 'TrueType';
        await exec('reg', ['add', FONT_REG_KEY, '/v', `${nodePath.basename(f, nodePath.extname(f))} (${type})`, '/t', 'REG_SZ', '/d', target, '/f']);
      }
    }
    if (brand.FONT_FAMILY) fontFace = brand.FONT_FAMILY;
    log(`Markenschrift installiert: ${fontFace}`);
  }

  // 4. Szenen-Collection mit ausgefüllten Platzhaltern
  const template = readText(sceneTemplate);
  const values = { ASSETS: assetsDir.replace(/\\/g, '/'), FONT_FACE: fontFace };
  for (const role of ROLES) {
    const cam = cameras[role.key] || {};
    values[`CAM_${role.key.toUpperCase()}_ID`] = cam.id || '';
    values[`CAM_${role.key.toUpperCase()}_NAME`] = cam.name || '';
  }
  const unknown = tokensIn(template).filter((t) => !(t in values));
  if (unknown.length) log(`Hinweis: unbekannte Platzhalter leer gelassen: ${unknown.join(', ')}`);
  fs.mkdirSync(nodePath.dirname(sceneFile), { recursive: true });
  const doc = renderJson(template, values);
  JSON.parse(doc); // früh scheitern, falls ein Wert das JSON zerstört
  writeText(sceneFile, doc);
  // Referenz für den Selbsttest: OBS schreibt die Collection beim Speichern um und verwirft dabei ggf. Einträge
  writeText(nodePath.join(paths.appDir, 'collection.expected.json'), doc);
  log(`Szenen-Collection '${collection}' (${variant}) installiert`);

  // 5. Profil: Auflösung, Bildrate, Bitrate, Encoder
  const bitrate = quality.bitrate[service === 'twitch' ? 'twitch' : 'other'];
  fs.mkdirSync(profileDir, { recursive: true });
  const basicIni = nodePath.join(profileDir, 'basic.ini');
  writeText(basicIni, render(readText(nodePath.join(payloadDir, 'profile', 'basic.ini.tmpl')), {
    NAME: collection, OUT_W: quality.w, OUT_H: quality.h, FPS: quality.fps, BITRATE: bitrate, REC_PATH: paths.recDir.replace(/\\/g, '/') }));
  const enc = encoder || { id: 'x264', obsValue: 'x264' };
  iniSet(basicIni, 'SimpleOutput', 'StreamEncoder', enc.obsValue);
  iniSet(basicIni, 'SimpleOutput', 'RecEncoder', enc.id === 'x264' ? 'x264' : enc.obsValue);
  fs.copyFileSync(nodePath.join(payloadDir, 'profile', `service.${service}.json`), nodePath.join(profileDir, 'service.json'));
  log(`Profil '${collection}': ${quality.label}, ${bitrate} kbit/s, Encoder ${enc.obsValue}`);

  // 6. OBS startet künftig mit diesem Profil und dieser Collection
  for (const f of iniFiles) {
    if (!exists(f) && nodePath.basename(f) === 'global.ini') iniSet(f, 'General', 'FirstRun', 'true');
    iniSet(f, 'Basic', 'Profile', collection);
    iniSet(f, 'Basic', 'ProfileDir', collection);
    iniSet(f, 'Basic', 'SceneCollection', collection);
    iniSet(f, 'Basic', 'SceneCollectionFile', collection);
  }

  // 7. obs-websocket für Kamerazuweisung und Selbsttest
  const websocket = ensureWebsocketConfig(paths.obsConfig, { backup });

  backup.save();
  const report = {
    version: 1, installedAt: new Date().toISOString(), platform, variant, collection, service, quality: quality.label,
    bitrate, encoder: enc.obsValue, fonts: installedFonts, previous, backup: backup.used ? backup.stamp : null,
    websocket: { port: websocket.port },
  };
  writeText(manifestFile, JSON.stringify(report, null, 2) + '\n');
  return { ...report, sceneFile, profileDir, assetsDir, websocket, backupDir: backup.used ? backup.dir : null };
}

/** Entfernt Szenen, Profil, Assets und Schriften; OBS-Auswahl wird auf die vorherigen Werte zurückgesetzt. */
async function uninstall({ payloadDir, platform, paths, log = () => {}, env = process.env, exec = run, registerFonts = platform === 'windows' && !env.DC_FONT_DIR, stamp }) {
  const collection = brandEnv(payloadDir).COLLECTION;
  const manifestFile = nodePath.join(paths.appDir, 'install.json');
  const manifest = exists(manifestFile) ? JSON.parse(readText(manifestFile)) : { previous: {}, fonts: [] };
  const sceneFile = nodePath.join(paths.obsConfig, 'basic', 'scenes', `${collection}.json`);
  const profileDir = nodePath.join(paths.obsConfig, 'basic', 'profiles', collection);
  const assetsDir = nodePath.join(paths.appDir, 'assets');
  const iniFiles = ['global.ini', 'user.ini'].map((f) => nodePath.join(paths.obsConfig, f));
  const backup = new Backup(paths.appDir, stamp);
  for (const p of [sceneFile, profileDir, assetsDir, ...iniFiles, ...manifest.fonts]) backup.add(p);
  backup.save();

  for (const p of [sceneFile, profileDir, assetsDir, ...manifest.fonts, manifestFile, nodePath.join(paths.appDir, 'collection.expected.json')]) fs.rmSync(p, { recursive: true, force: true });
  if (registerFonts) {
    for (const f of manifest.fonts) {
      const type = /\.otf$/i.test(f) ? 'OpenType' : 'TrueType';
      await exec('reg', ['delete', FONT_REG_KEY, '/v', `${nodePath.basename(f, nodePath.extname(f))} (${type})`, '/f']);
    }
  }
  for (const f of iniFiles) {
    if (!exists(f)) continue;
    const prev = manifest.previous[nodePath.basename(f)] || {};
    // Nur zurücksetzen, wenn OBS noch auf unserer Collection steht
    if (iniGet(f, 'Basic', 'SceneCollectionFile') !== collection && iniGet(f, 'Basic', 'ProfileDir') !== collection) continue;
    for (const k of ['Profile', 'ProfileDir', 'SceneCollection', 'SceneCollectionFile']) iniSet(f, 'Basic', k, prev[k] ?? 'Untitled');
  }
  log(`dc_onair wurde aus OBS entfernt. Sicherung: ${backup.dir}`);
  return { backupDir: backup.used ? backup.dir : null };
}

/** Zustand der Installation (für die Oberfläche und die Wartung). */
function status({ payloadDir, paths }) {
  const collection = brandEnv(payloadDir).COLLECTION;
  const manifestFile = nodePath.join(paths.appDir, 'install.json');
  return {
    collection,
    installed: exists(nodePath.join(paths.obsConfig, 'basic', 'scenes', `${collection}.json`)),
    manifest: exists(manifestFile) ? JSON.parse(readText(manifestFile)) : null,
  };
}

module.exports = { QUALITIES, SERVICES, DEFAULTS, brandEnv, moveInstalled, install, uninstall, status };
