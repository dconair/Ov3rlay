#!/usr/bin/env node
'use strict';
// Kommandozeile für dieselbe Logik wie die App: install, uninstall, restore, backups, status, cameras, encoder, matrix, selftest.
const nodePath = require('node:path');
const { parseArgs } = require('node:util');
const core = require('../core');
const { readText } = require('../core/ini');

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    service: { type: 'string' }, quality: { type: 'string' }, encoder: { type: 'string', default: 'auto' },
    payload: { type: 'string', default: core.resolvePayloadDir() },
    platform: { type: 'string' }, shots: { type: 'string' }, 'no-launch': { type: 'boolean' }, 'skip-tour': { type: 'boolean' },
    json: { type: 'boolean' }, camera: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' },
  },
});

const HELP = `dc_onair Setup (Kommandozeile)

  status                    Zustand der Installation
  install                   OBS einrichten  [--service twitch|youtube|custom] [--quality 1080p60|1080p30|720p60]
                            [--encoder auto|nvenc|amd|qsv|apple|x264] [--camera iphone="Name" --camera sony="Name"]
  uninstall                 Szenen, Profil, Assets entfernen
  backups | restore <ID>    Sicherungen anzeigen / wiederherstellen
  cameras                   Kameras des Betriebssystems anzeigen
  encoder                   Grafikkarte erkennen und Encoder vorschlagen
  matrix [--json]           Übergangsmatrix aller Szenenpaare
  selftest [--shots DIR]    Selbsttest in laufendem OBS (startet OBS, außer mit --no-launch) [--skip-tour]
`;

const platform = v.platform || core.platformLib.detectPlatform();
const paths = core.platformLib.defaultPaths(platform);
const say = (t = '') => console.log(t);
const icon = { ok: 'ok   ', warn: 'Hinw.', fail: 'FEHLER' };

async function main() {
  const [cmd] = positionals;
  if (!cmd || v.help) return say(HELP);
  const brand = core.installLib.brandEnv(v.payload);

  if (cmd === 'status') {
    const s = core.installLib.status({ payloadDir: v.payload, paths });
    const o = await core.obs.findObs(platform);
    say(`Plattform: ${platform}\nOBS: ${o ? `${o.version} (${o.dir})` : 'nicht gefunden'}\nInstalliert: ${s.installed ? 'ja' : 'nein'}`);
    if (s.manifest) say(`Seit ${s.manifest.installedAt}: ${s.manifest.quality}, Encoder ${s.manifest.encoder}`);
  } else if (cmd === 'encoder') {
    const e = await core.encoder.detectEncoder(platform);
    say(`${e.label}\nGrafik: ${e.gpus.join(' | ') || 'unbekannt'}`);
  } else if (cmd === 'cameras') {
    for (const c of await core.cameras.listSystemCameras(platform)) say(`${c.name}\t${c.id}`);
  } else if (cmd === 'matrix') {
    const doc = JSON.parse(readText(nodePath.join(v.payload, 'scenes', `${brand.COLLECTION}.${platform === 'linux' ? 'windows' : platform}.json`)));
    const m = core.matrix.buildMatrix(doc);
    say(v.json ? JSON.stringify(m, null, 2) : core.matrix.matrixMarkdown(m));
    for (const f of core.matrix.lintMatrix(doc)) console.error(`${f.level}: ${f.text}`);
  } else if (cmd === 'install') {
    const enc = v.encoder === 'auto' ? await core.encoder.detectEncoder(platform) : core.encoder.encoderById(v.encoder);
    const cams = {};
    for (const spec of v.camera || []) { const [k, ...n] = spec.split('='); const name = n.join('='); cams[k] = { id: platform === 'windows' ? `${name}:` : name, name }; }
    const r = await core.installLib.install({ payloadDir: v.payload, platform, paths, service: v.service, quality: v.quality, encoder: enc, cameras: cams, log: (t) => say(`  ${t}`) });
    say(`Fertig. Sicherung: ${r.backupDir || 'keine nötig'}\nOBS-WebSocket: Port ${r.websocket.port}`);
  } else if (cmd === 'uninstall') {
    await core.installLib.uninstall({ payloadDir: v.payload, platform, paths, log: say });
  } else if (cmd === 'backups') {
    for (const b of core.backupLib.listBackups(paths.appDir)) say(`${b.stamp}\t${b.entries.length} gesichert, ${b.created.length} neu`);
  } else if (cmd === 'restore') {
    say(JSON.stringify(core.backupLib.restoreBackup(paths.appDir, positionals[1])));
  } else if (cmd === 'selftest') {
    const obsInfo = await core.obs.findObs(platform);
    const ws = await core.connectObs({ platform, paths, collection: brand.COLLECTION, obsInfo, launch: !v['no-launch'], onWait: () => process.stderr.write('.') });
    try {
      let last = '';
      const r = await core.selftest({ ws, paths, collection: brand.COLLECTION, shotsDir: v.shots, skipTour: v['skip-tour'],
        onProgress: (p) => { if (p.phase === 'tour') { last = p.text; if (p.done % 9 === 0 || p.done === p.total) say(`  Übergang ${p.done}/${p.total}: ${last}`); } } });
      for (const c of r.checks) say(`${icon[c.status]} ${c.label}${c.detail ? `\n         ${c.detail.replace(/\n/g, '\n         ')}` : ''}`);
      if (r.tour) {
        say('\nÜbergangsmatrix (gemessen, ms):');
        const bad = r.tour.filter((s) => s.level !== 'ok');
        say(`  ${r.tour.length} Übergänge, ${bad.length} mit Auffälligkeiten`);
        const by = {};
        for (const s of r.tour) (by[s.expected] ||= []).push(s.durationMs);
        for (const [name, ds] of Object.entries(by)) say(`  ${name}: ${ds.length}x, ${Math.min(...ds)} bis ${Math.max(...ds)} ms`);
      }
      say(r.passed ? '\nSelbsttest bestanden' : '\nSelbsttest FEHLGESCHLAGEN');
      process.exitCode = r.passed ? 0 : 1;
    } finally { ws.close(); }
  } else { say(HELP); process.exitCode = 2; }
}

main().catch((e) => { console.error(`Fehler: ${e.message}`); process.exit(1); });
