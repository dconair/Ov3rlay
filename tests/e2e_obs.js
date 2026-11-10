'use strict';
// Ende-zu-Ende-Test mit echtem OBS (Linux, Xvfb): Installer-Logik -> OBS starten -> Selbsttest inkl. aller Übergänge.
// Aufruf: node tests/e2e_obs.js [--shots DIR]   Benötigt: obs, xvfb-run, python3 (nur zum Erzeugen der Linux-Variante)
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const root = nodePath.join(__dirname, '..');
const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'dc-e2e-'));
Object.assign(process.env, {
  HOME: tmp, XDG_CONFIG_HOME: nodePath.join(tmp, '.config'), XDG_DATA_HOME: nodePath.join(tmp, '.local', 'share'),
  XDG_CACHE_HOME: nodePath.join(tmp, '.cache'), LIBGL_ALWAYS_SOFTWARE: '1', QT_QPA_PLATFORM: 'xcb',
});
const core = require('../core');
const shotsIdx = process.argv.indexOf('--shots');
const shotsDir = shotsIdx > 0 ? nodePath.resolve(process.argv[shotsIdx + 1]) : undefined;

(async () => {
  // Payload-Kopie mit Linux-Variante (die echten Dateien gibt es nur für macOS und Windows)
  const payload = nodePath.join(tmp, 'payload');
  fs.cpSync(nodePath.join(root, 'payload'), payload, { recursive: true });
  const linuxDoc = execFileSync('python3', ['-c',
    'import sys,json; sys.path.insert(0,"tools"); import build_collection as b; print(json.dumps(b.build("linux", False), ensure_ascii=False))'],
  { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(nodePath.join(payload, 'scenes', 'dc_onair.linux.json'), linuxDoc);

  const platform = 'linux';
  const paths = core.platformLib.defaultPaths(platform);
  const report = await core.installLib.install({ payloadDir: payload, platform, paths, encoder: core.encoder.encoderById('x264'), log: (t) => console.log('  ' + t) });
  const info = await core.obs.findObs(platform);
  if (!info) throw new Error('obs nicht gefunden');
  console.log(`OBS ${info.version} starten ...`);
  const ws = await core.connectObs({ platform, paths, collection: report.collection, obsInfo: info, wrapper: ['xvfb-run', '-a', '-s', '-screen 0 1920x1080x24'], timeoutMs: 120000 });
  let result;
  try {
    result = await core.selftest({ ws, paths, collection: report.collection, shotsDir, onProgress: (p) => { if (p.phase === 'tour' && p.done % 12 === 0) console.log(`  Übergang ${p.done}/${p.total}`); } });
  } finally { ws.close(); try { execFileSync('pkill', ['-x', 'obs']); } catch { /* beendet */ } }
  for (const c of result.checks) console.log(`${c.status.padEnd(5)} ${c.label}${c.detail ? ' | ' + c.detail.replace(/\n/g, ' / ') : ''}`);
  const bad = (result.tour || []).filter((s) => s.level !== 'ok');
  console.log(`Übergänge: ${(result.tour || []).length}, auffällig: ${bad.length}`);
  for (const s of bad.slice(0, 10)) console.log(`  ${s.from} -> ${s.to}: ${s.issues.join(', ')}`);
  const durations = {};
  for (const s of result.tour || []) (durations[s.expected] ||= []).push(s.durationMs);
  for (const [n, d] of Object.entries(durations)) console.log(`  ${n}: ${d.length}x, ${Math.min(...d)}-${Math.max(...d)} ms`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(result.passed ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
