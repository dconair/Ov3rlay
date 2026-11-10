'use strict';
// Erststart-Assistent. Reine Oberfläche; alle Aktionen laufen über window.dc.call() im Hauptprozess.
const $ = (sel) => document.querySelector(sel);
const page = $('#page');
const STEPS = ['Prüfen', 'Einstellungen', 'Installieren', 'Kameras', 'Selbsttest', 'Fertig'];
const state = { info: null, choice: {}, step: 0 };
let progressHandler = null;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const badge = (kind, text) => h('span', { class: `badge ${kind}` }, text);
const row = (title, sub, right) => h('div', { class: 'row' }, h('div', { class: 'grow' }, title, sub ? h('small', {}, sub) : null), right);
const nav = (...buttons) => h('div', { class: 'actions' }, ...buttons);
const btn = (text, onclick, cls = '') => h('button', { class: cls, onclick, type: 'button' }, text);
const call = (c, p) => window.dc.call(c, p);
window.dc.onProgress((m) => progressHandler?.(m));

function draw(step, ...nodes) {
  state.step = step;
  $('#steps').replaceChildren(...STEPS.map((s, i) => h('li', { class: i < step ? 'done' : i === step ? 'now' : '', title: s })));
  $('#sub').textContent = STEPS[step];
  page.replaceChildren(...nodes.flat().filter(Boolean));
  page.scrollTop = 0;
}

async function refresh() { state.info = await call('state:get'); }

// ---------- 0: Prüfen ----------
async function stepCheck() {
  await refresh();
  const i = state.info;
  const obsOk = i.obs?.ok && !i.obs.running;
  $('#meta').textContent = `v${i.appVersion} · ${i.platform === 'windows' ? 'Windows' : i.platform === 'macos' ? 'macOS' : 'Linux'}`;
  const obsRow = !i.obs
    ? row('OBS Studio', 'Nicht gefunden. Bitte zuerst von obsproject.com installieren.', badge('fail', 'fehlt'))
    : !i.obs.ok ? row('OBS Studio', `Version ${i.obs.version} ist zu alt, nötig ist ${i.minObs} oder neuer.`, badge('fail', 'zu alt'))
    : row('OBS Studio', `Version ${i.obs.version}`, badge('ok', 'gefunden'));
  const next = btn(i.status.installed ? 'Neu einrichten' : 'Weiter', stepSettings, 'primary');
  next.disabled = !obsOk;
  const runRow = i.obs?.running ? row('OBS läuft noch', 'Bitte OBS beenden, sonst überschreibt es die neuen Einstellungen.', badge('warn', 'beenden')) : null;
  draw(0,
    h('h2', {}, 'Willkommen'),
    h('p', { class: 'lead' }, 'Dieser Assistent richtet Szenen, Übergänge, Kameras und ein passendes Streaming-Profil in OBS ein. Vorhandene Dateien werden vorher gesichert.'),
    h('div', { class: 'card' }, obsRow, runRow,
      row('Grafikkarte', i.encoder.gpus.join(', ') || 'nicht erkannt', badge('ok', i.encoder.options.find((e) => e.id === i.encoder.suggested).label.split(' (')[0]))),
    i.status.installed ? h('div', { class: 'card' }, row('Bereits eingerichtet', i.status.manifest ? `${i.status.manifest.quality}, Encoder ${i.status.manifest.encoder}` : 'Szenen-Collection vorhanden',
      h('span', {}, btn('Entfernen', stepMaintenance)))) : null,
    nav(next, btn('Erneut prüfen', stepCheck)));
}

// ---------- 1: Einstellungen ----------
function stepSettings() {
  const i = state.info;
  const c = state.choice;
  c.service ||= i.defaults.service; c.quality ||= i.defaults.quality; c.encoder ||= i.encoder.suggested;
  const radio = (name, value, label, sub) => h('label', { class: 'opt' }, h('input', { type: 'radio', name, value, checked: c[name] === value, onchange: () => { c[name] = value; } }), h('span', {}, label, sub ? h('small', { class: 'detail' }, ' ' + sub) : null));
  draw(1,
    h('h2', {}, 'Streaming-Einstellungen'),
    h('p', { class: 'lead' }, 'Der Stream-Schlüssel wird nicht abgefragt und nicht gespeichert. Den trägst du später in OBS ein.'),
    h('div', { class: 'card' }, h('strong', {}, 'Plattform'), ...Object.entries(i.services).map(([k, v]) => radio('service', k, v))),
    h('div', { class: 'card' }, h('strong', {}, 'Qualität'), ...i.qualities.map((q) => radio('quality', q, q, q === '1080p30' ? 'empfohlen für unterwegs (IRL)' : ''))),
    h('div', { class: 'card' }, h('strong', {}, 'Encoder'), h('div', { class: 'row' },
      h('select', { 'aria-label': 'Encoder', onchange: (e) => { c.encoder = e.target.value; } },
        ...i.encoder.options.map((e) => h('option', { value: e.id, selected: c.encoder === e.id }, e.label + (e.id === i.encoder.suggested ? ' (erkannt)' : '')))))),
    nav(btn('Zurück', stepCheck), btn('Installieren', stepInstall, 'primary')));
}

// ---------- 2: Installieren ----------
async function stepInstall() {
  const log = h('div', { class: 'log' });
  draw(2, h('h2', {}, 'Installiere ...'), h('p', { class: 'lead' }, 'Sicherung, Szenen, Profil, Grafiken und Videos.'), h('div', { class: 'card' }, log));
  progressHandler = (m) => { if (m.phase === 'install') log.append(m.text + '\n'); };
  try {
    const r = await call('install:run', state.choice);
    progressHandler = null;
    page.append(h('div', { class: 'card' }, row('Fertig', `${r.quality}, Encoder ${r.encoder}${r.backupDir ? ', Sicherung angelegt' : ''}`, badge('ok', 'ok'))),
      nav(btn('Weiter zu den Kameras', stepCameras, 'primary')));
  } catch (e) {
    progressHandler = null;
    page.append(h('p', { class: 'err' }, e.message), nav(btn('Zurück', stepSettings)));
  }
}

// ---------- 3: Kameras ----------
async function stepCameras() {
  draw(3, h('h2', {}, 'Kameras zuweisen'), h('p', { class: 'lead' }, 'OBS wird gestartet, damit wir die Geräte so sehen, wie OBS sie sieht. Das kann bis zu einer Minute dauern.'),
    h('div', { class: 'card' }, h('div', { class: 'bar' }, h('i', { style: 'width:30%' })), h('span', { class: 'detail' }, 'Warte auf OBS ...')));
  let roles;
  try { roles = await call('cameras:discover'); } catch (e) {
    return page.append(h('p', { class: 'err' }, e.message),
      nav(btn('Erneut versuchen', stepCameras, 'primary'), btn('Überspringen (später in OBS wählen)', stepSelftest)));
  }
  const pick = {};
  const selects = roles.map((r) => {
    pick[r.key] = r.guess;
    const sel = h('select', { 'aria-label': r.label, onchange: (e) => { pick[r.key] = e.target.value; } },
      h('option', { value: '' }, 'Später in OBS auswählen'),
      ...r.devices.map((d) => h('option', { value: d.id, selected: d.id === r.guess }, d.name)));
    return row(r.label, r.devices.length ? r.hint : `Kein Gerät gefunden. ${r.hint}`, sel);
  });
  page.replaceChildren(h('h2', {}, 'Kameras zuweisen'), h('p', { class: 'lead' }, 'Wähle für jede Rolle das passende Gerät. Fehlt eines, zeigt die Szene eine Karte "Kamera nicht verbunden".'),
    h('div', { class: 'card' }, ...selects),
    nav(btn('Zuweisen', async (ev) => {
      ev.target.disabled = true;
      try { await call('cameras:assign', { assignments: pick }); stepSelftest(); } catch (e) { page.append(h('p', { class: 'err' }, e.message)); ev.target.disabled = false; }
    }, 'primary'), btn('Geräte neu lesen', stepCameras), btn('Überspringen', stepSelftest)));
}

// ---------- 4: Selbsttest ----------
function stepSelftest() {
  draw(4, h('h2', {}, 'Selbsttest'),
    h('p', { class: 'lead' }, 'Prüft, ob alles geladen ist, und schaltet dabei jede Szene und jeden Übergang einmal durch (ca. eine Minute). Währenddessen nicht streamen.'),
    h('div', { class: 'card', id: 'results' }),
    nav(btn('Test starten', runSelftest, 'primary'), btn('Überspringen', stepDone)));
}
async function runSelftest(ev) {
  ev.target.disabled = true;
  const box = $('#results');
  const bar = h('div', { class: 'bar' }, h('i')); const line = h('div', { class: 'detail' }, 'Starte ...');
  box.replaceChildren(bar, line);
  progressHandler = (m) => {
    if (m.phase === 'selftest' && m.total) { bar.firstChild.style.width = `${Math.round(100 * m.done / m.total)}%`; line.textContent = m.text; }
    else if (m.phase === 'obs-wait') line.textContent = 'Warte auf OBS ...';
  };
  try {
    const r = await call('selftest:run');
    progressHandler = null;
    const kind = { ok: 'ok', warn: 'warn', fail: 'fail' };
    const text = { ok: 'ok', warn: 'Hinweis', fail: 'Fehler' };
    box.replaceChildren(...r.checks.map((c) => row(c.label, c.detail, badge(kind[c.status], text[c.status]))));
    if (r.tour) {
      const bad = r.tour.filter((s) => s.level !== 'ok').length;
      box.append(row(`Übergangsmatrix: ${r.matrix.scenes.length} Szenen, ${r.tour.length} Wechsel`, bad ? `${bad} mit Auffälligkeiten (siehe oben)` : 'Alle Wechsel liefen mit dem erwarteten Übergang', badge(bad ? 'warn' : 'ok', bad ? 'prüfen' : 'ok')));
    }
    page.append(h('p', { class: r.passed ? '' : 'err' }, r.passed ? 'Selbsttest bestanden.' : 'Selbsttest nicht bestanden. Details oben; Screenshots und Bericht liegen im Ordner unten.'),
      nav(btn('Weiter', stepDone, 'primary'), btn('Ergebnisordner öffnen', () => call('shell:open', { target: r.shotsDir })), btn('Nochmal', stepSelftest)));
  } catch (e) {
    progressHandler = null;
    box.replaceChildren(h('p', { class: 'err' }, e.message));
    ev.target.disabled = false;
  }
}

// ---------- 5: Fertig ----------
function stepDone() {
  draw(5, h('h2', {}, 'Fertig'),
    h('p', { class: 'lead' }, 'dc_onair ist in OBS eingerichtet.'),
    h('div', { class: 'card' },
      row('1. Stream-Schlüssel eintragen', 'OBS > Einstellungen > Stream: Konto verbinden oder Schlüssel einfügen.'),
      row('2. Kameras prüfen', 'Quellen "CAM iPhone" und "CAM Sony A7 II": Eigenschaften > Gerät. Das System fragt ggf. nach Kamera- und Mikrofonzugriff.'),
      row('3. Eigenes Branding', 'Logo, Schrift und Hintergründe lassen sich unter gleichem Namen ersetzen (siehe README).'),
      row('Hotkeys', 'Szenen 1 bis 9: Strg+Alt+1 bis 9 (macOS: Control+Option). Lower Third: L / H, Mikrofon stumm: M.')),
    nav(btn('Schließen', () => window.close(), 'primary'), btn('Einstellungen ändern', stepCheck)));
}

// ---------- Wartung ----------
async function stepMaintenance() {
  await refresh();
  draw(0, h('h2', {}, 'Wartung'),
    h('p', { class: 'lead' }, 'Entfernt dc_onair aus OBS oder stellt einen früheren Stand wieder her. Eigene OBS-Einstellungen bleiben unberührt.'),
    h('div', { class: 'card' }, ...(state.info.backups.length ? state.info.backups.map((b) => row(`Sicherung vom ${b.stamp}`, `${b.files} Dateien`, btn('Wiederherstellen', async () => {
      try { await call('maintenance:restore', { stamp: b.stamp }); await stepCheck(); } catch (e) { page.append(h('p', { class: 'err' }, e.message)); }
    }))) : [row('Keine Sicherungen vorhanden')])),
    nav(btn('dc_onair aus OBS entfernen', async () => {
      try { await call('maintenance:uninstall'); await stepCheck(); } catch (e) { page.append(h('p', { class: 'err' }, e.message)); }
    }), btn('Zurück', stepCheck)));
}

stepCheck().catch((e) => page.replaceChildren(h('p', { class: 'err' }, `Fehler: ${e.message}`)));
