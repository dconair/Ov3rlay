'use strict';
// Selbsttest über obs-websocket: Collection geladen, Quellen und Dateien vorhanden, Kameras zugewiesen,
// jede Szene und jeder Übergang (alle geordneten Szenenpaare) wird einmal wirklich geschaltet.
const fs = require('node:fs');
const nodePath = require('node:path');
const { MIN_OBS_MAJOR, majorOf } = require('./obs');
const { CAMERA_KINDS } = require('./cameras');
const { buildMatrix, eulerTour, lintMatrix, transitionInto, isStinger } = require('./matrix');
const { sleep } = require('./util');
const { readText } = require('./ini');

/** OBS schreibt die Collection nur bei bestimmten Ereignissen; eine Hilfsszene erzwingt das Speichern. */
async function forceSave(ws, waitMs = 2500) {
  await ws.call('CreateScene', { sceneName: '_save' }).catch(() => {});
  await ws.call('RemoveScene', { sceneName: '_save' }).catch(() => {});
  await sleep(waitMs);
}

const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

function* walkStrings(value) {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* walkStrings(v);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* walkStrings(v);
}

/**
 * @param {object} o
 * @param {ObsWs} o.ws          verbundener Client
 * @param {object} o.doc        erwartete Szenen-Collection (JSON), wie installiert
 * @param {string} [o.collectionFile] Collection-Datei, die OBS speichert (für die Rundlauf-Prüfung)
 * @param {string} o.assetsDir  Ordner mit den installierten Assets
 * @param {string} [o.shotsDir] Ordner für Screenshots und Bericht
 * @param {Function} [o.onProgress] ({ phase, done, total, text })
 * @param {boolean} [o.skipTour]
 */
async function runSelftest({ ws, doc, collectionFile, assetsDir, shotsDir, onProgress = () => {}, skipTour = false, fetchImpl = fetch }) {
  const checks = [];
  const add = (id, status, label, detail = '') => { checks.push({ id, status, label, detail }); onProgress({ phase: id, status, text: label }); };
  let tour = null;

  // 1. OBS-Version
  const v = await ws.call('GetVersion');
  const major = majorOf(v.obsVersion);
  add('obs-version', major >= MIN_OBS_MAJOR ? 'ok' : 'fail', `OBS ${v.obsVersion} über WebSocket erreichbar`, major >= MIN_OBS_MAJOR ? `obs-websocket ${v.obsWebSocketVersion}` : `mindestens OBS ${MIN_OBS_MAJOR} nötig`);

  // 2. Sicherheitsnetz: nicht während Stream oder Aufnahme umschalten
  const stream = await ws.call('GetStreamStatus');
  const record = await ws.call('GetRecordStatus');
  if (stream.outputActive || record.outputActive) {
    add('idle', 'fail', 'OBS streamt oder nimmt gerade auf', 'Der Selbsttest schaltet Szenen durch und wurde deshalb nicht gestartet.');
    return finish();
  }
  add('idle', 'ok', 'OBS streamt nicht und nimmt nicht auf');

  // 3. Szenen
  const matrix = buildMatrix(doc);
  const sceneList = (await ws.call('GetSceneList')).scenes.map((s) => s.sceneName);
  const missingScenes = matrix.scenes.filter((s) => !sceneList.includes(s));
  add('scenes', missingScenes.length ? 'fail' : 'ok', `${matrix.scenes.length} Szenen vorhanden`, missingScenes.length ? `fehlt: ${missingScenes.join(', ')}` : '');

  // 4. Quellen
  const inputs = Object.fromEntries((await ws.call('GetInputList')).inputs.map((i) => [i.inputName, i.inputKind]));
  const wanted = doc.sources.filter((s) => s.id !== 'scene');
  const missingInputs = wanted.filter((s) => !(s.name in inputs)).map((s) => s.name);
  add('inputs', missingInputs.length ? 'fail' : 'ok', `${wanted.length} Quellen vorhanden`, missingInputs.length ? `fehlt: ${missingInputs.join(', ')}` : '');

  // 5. Dateien der Collection (Videos, Bilder, Stinger)
  const prefix = assetsDir.replace(/\\/g, '/');
  const files = [...new Set([...walkStrings(doc)].filter((s) => s.replace(/\\/g, '/').startsWith(prefix + '/')))];
  const missingFiles = files.filter((f) => !fs.existsSync(f));
  add('files', missingFiles.length ? 'fail' : 'ok', `${files.length} Dateien der Collection vorhanden`, missingFiles.join(', '));

  // 6. Kameras zugewiesen?
  for (const src of doc.sources.filter((s) => CAMERA_KINDS[s.id])) {
    const live = (await ws.call('GetInputSettings', { inputName: src.name })).inputSettings;
    const prop = CAMERA_KINDS[src.id].property;
    const assigned = Boolean(live[prop]) && live[prop] !== ':';
    add(`camera:${src.name}`, assigned ? 'ok' : 'warn', assigned ? `${src.name}: Gerät zugewiesen` : `${src.name}: noch kein Gerät zugewiesen`,
      assigned ? '' : 'In OBS: Quelle > Eigenschaften > Gerät wählen. Bis dahin zeigt die Szene die Karte "Kamera nicht verbunden".');
  }

  // 7. Browserquellen (HTTP 200)
  const browsers = doc.sources.filter((s) => s.id === 'browser_source');
  for (const b of browsers) {
    const url = b.settings?.url || '';
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      add(`browser:${b.name}`, res.ok ? 'ok' : 'fail', `${b.name}: HTTP ${res.status}`, url);
    } catch (e) { add(`browser:${b.name}`, 'fail', `${b.name}: nicht erreichbar`, `${url} (${e.message})`); }
  }
  if (!browsers.length) add('browser', 'ok', 'Keine Browserquellen in dieser Collection');

  // 8. Übergänge laut Collection und Szenen-Overrides in OBS geladen
  const list = await ws.call('GetSceneTransitionList');
  const names = list.transitions.map((t) => t.transitionName);
  const missingTr = (doc.transitions || []).map((t) => t.name).filter((n) => !names.includes(n));
  add('transitions', missingTr.length ? 'fail' : 'ok', `${(doc.transitions || []).length} Übergänge geladen`, missingTr.join(', '));
  const badOverrides = [];
  for (const scene of matrix.scenes) {
    const want = matrix.into[scene];
    if (want.source !== 'override') continue;
    const got = await ws.call('GetSceneSceneTransitionOverride', { sceneName: scene });
    if (got.transitionName !== want.name) badOverrides.push(`${scene}: ${got.transitionName || 'keiner'} statt ${want.name}`);
  }
  add('overrides', badOverrides.length ? 'fail' : 'ok', 'Szenen-Übergänge (Overrides) korrekt', badOverrides.join('; '));
  for (const f of lintMatrix(doc, { stingerPathExists: (p) => fs.existsSync(p) })) add('lint', f.level === 'fehler' ? 'fail' : 'warn', f.text);

  // 8b. Rundlauf: Speichert OBS die Collection vollständig? (verworfene Übergänge würden erst später auffallen)
  if (collectionFile && !skipTour) {
    await forceSave(ws);
    const saved = JSON.parse(readText(collectionFile));
    const lost = (doc.transitions || []).map((t) => t.name).filter((n) => !(saved.transitions || []).some((t) => t.name === n));
    const ovr = (d) => Object.fromEntries(d.sources.filter((s) => s.id === 'scene').map((s) => [s.name, s.private_settings?.transition || '']));
    const want = ovr(doc), got = ovr(saved);
    const lostOvr = Object.keys(want).filter((n) => want[n] !== got[n]);
    const detail = [lost.length ? `Übergänge verworfen: ${lost.join(', ')}` : '', lostOvr.length ? `Szenen-Zuordnung verloren: ${lostOvr.join(', ')}` : ''].filter(Boolean).join('; ');
    add('roundtrip', detail ? 'fail' : 'ok', 'OBS speichert Übergänge und Szenen-Zuordnung vollständig', detail);
  }

  // 9. Alle Szenen und alle Übergänge einmal schalten
  if (!skipTour && !missingScenes.length) tour = await runTour();
  return finish();

  async function runTour() {
    if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
    const original = (await ws.call('GetCurrentProgramScene')).currentProgramSceneName;
    const originalTransition = (await ws.call('GetCurrentSceneTransition')).transitionName;
    const seq = eulerTour(matrix.scenes);
    const steps = [];
    const shot = new Set();

    const arrive = async (to) => {
      const ended = ws.waitEvent('SceneTransitionEnded', () => true, 12000).catch(() => null);
      const started = ws.waitEvent('SceneTransitionStarted', () => true, 3000).catch(() => null);
      const t0 = performance.now();
      await ws.call('SetCurrentProgramScene', { sceneName: to });
      const [s, e] = await Promise.all([started, ended]);
      const now = (await ws.call('GetCurrentProgramScene')).currentProgramSceneName;
      return { observed: s?.data.transitionName ?? null, startMs: s ? s.at - t0 : null, durationMs: s && e ? Math.round(e.at - s.at) : null, ended: Boolean(e), landed: now === to };
    };

    // Startpunkt herstellen
    if (original !== seq[0]) await arrive(seq[0]);
    const total = seq.length - 1;
    for (let i = 0; i < total; i++) {
      const from = seq[i], to = seq[i + 1];
      const want = transitionInto(doc, to);
      const r = await arrive(to);
      const issues = [];
      if (!r.landed) issues.push('Zielszene wurde nicht erreicht');
      if (!r.ended) issues.push('Übergang meldet kein Ende');
      if (r.observed !== want.name) issues.push(`Übergang "${r.observed}" statt "${want.name}"`);
      let level = issues.length ? 'fail' : 'ok';
      if (!issues.length && r.durationMs != null) {
        if (isStinger(want.kind)) {
          if (r.durationMs < (want.cutPointMs || 0)) { issues.push(`Dauer ${r.durationMs} ms kürzer als Schnittpunkt ${want.cutPointMs} ms`); level = 'fail'; }
        } else if (want.durationMs != null && (r.durationMs < want.durationMs * 0.6 || r.durationMs > want.durationMs * 1.6 + 200)) {
          issues.push(`Dauer ${r.durationMs} ms weicht von ${want.durationMs} ms ab`); level = 'warn';
        }
      }
      steps.push({ from, to, expected: want.name, ...r, level, issues });
      onProgress({ phase: 'tour', done: i + 1, total, text: `${from} → ${to}: ${want.name}` });
      if (shotsDir && !shot.has(to)) {
        shot.add(to);
        await sleep(250);
        try {
          const img = (await ws.call('GetSourceScreenshot', { sourceName: to, imageFormat: 'png', imageWidth: 960, imageHeight: 540 })).imageData;
          fs.writeFileSync(nodePath.join(shotsDir, `${slug(to)}.png`), Buffer.from(img.split(',')[1], 'base64'));
        } catch { /* Screenshot ist nur Zugabe */ }
      }
    }
    // Zustand wie vorgefunden
    if (seq[seq.length - 1] !== original) await arrive(original);
    try { await ws.call('SetCurrentSceneTransition', { transitionName: originalTransition }); } catch { /* egal */ }

    const failed = steps.filter((s) => s.level === 'fail'), warned = steps.filter((s) => s.level === 'warn');
    add('tour', failed.length ? 'fail' : warned.length ? 'warn' : 'ok',
      `${matrix.scenes.length} Szenen und ${steps.length} Übergänge geschaltet`,
      [...failed, ...warned].map((s) => `${s.from} → ${s.to}: ${s.issues.join(', ')}`).join('\n'));
    return steps;
  }

  function finish() {
    const counts = { ok: 0, warn: 0, fail: 0 };
    for (const c of checks) counts[c.status] = (counts[c.status] || 0) + 1;
    const result = { passed: counts.fail === 0, counts, checks, matrix: { scenes: matrix.scenes, into: matrix.into }, tour };
    if (shotsDir) {
      fs.mkdirSync(shotsDir, { recursive: true });
      fs.writeFileSync(nodePath.join(shotsDir, 'selftest.json'), JSON.stringify(result, null, 2) + '\n');
    }
    return result;
  }
}

module.exports = { runSelftest, forceSave };
