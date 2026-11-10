'use strict';
// Übergangsmatrix: Welche Überblendung läuft beim Wechsel von Szene A nach Szene B?
// OBS wählt den Übergang anhand der ZIEL-Szene (Szenen-Override), sonst den Standard-Übergang der Collection.

const BUILTIN = { cut_transition: 'Cut', fade_transition: 'Fade' };
const isStinger = (kind) => kind === 'obs_stinger_transition';
// OBS speichert nur konfigurierbare Übergänge in der Collection. Cut und Fade sind fest eingebaut: ein eigener Eintrag
// mit diesen Typen geht beim ersten Speichern durch OBS verloren (und mit ihm jede Szenen-Zuordnung darauf).
const NON_CONFIGURABLE = new Set(['cut_transition', 'fade_transition']);

/** Öffentliche Szenen (ohne Hilfsszenen mit "_") in der Reihenfolge der Collection. */
function publicScenes(doc) {
  const names = (doc.scene_order || []).map((s) => s.name);
  const all = names.length ? names : doc.sources.filter((s) => s.id === 'scene').map((s) => s.name);
  return all.filter((n) => !n.startsWith('_'));
}

function transitionsByName(doc) {
  const map = { Cut: { name: 'Cut', id: 'cut_transition', settings: {} }, Fade: { name: 'Fade', id: 'fade_transition', settings: {} } };
  for (const t of doc.transitions || []) map[t.name] = t;
  return map;
}

/** Übergang, der beim Wechsel IN die Szene `to` verwendet wird. */
function transitionInto(doc, to) {
  const scene = doc.sources.find((s) => s.id === 'scene' && s.name === to);
  const priv = scene?.private_settings || {};
  const byName = transitionsByName(doc);
  const name = priv.transition || doc.current_transition;
  const def = byName[name];
  const kind = def?.id;
  return {
    name,
    kind,
    defined: Boolean(def),
    source: priv.transition ? 'override' : 'standard',
    // Stinger-Länge steckt im Video, sie wird erst beim Durchlauf gemessen
    durationMs: isStinger(kind) ? null : (priv.transition ? priv.transition_duration : doc.transition_duration) ?? null,
    cutPointMs: isStinger(kind) ? def?.settings?.transition_point ?? null : null,
  };
}

function buildMatrix(doc) {
  const scenes = publicScenes(doc);
  const into = Object.fromEntries(scenes.map((s) => [s, transitionInto(doc, s)]));
  return { scenes, into, pairs: scenes.flatMap((from) => scenes.filter((to) => to !== from).map((to) => ({ from, to, ...into[to] }))) };
}

/** Geschlossener Weg, der jedes geordnete Szenenpaar genau einmal durchläuft (Euler-Kreis im vollständigen Digraphen). */
function eulerTour(nodes) {
  const next = Object.fromEntries(nodes.map((n) => [n, nodes.filter((m) => m !== n)]));
  const stack = [nodes[0]];
  const path = [];
  while (stack.length) {
    const v = stack[stack.length - 1];
    if (next[v].length) stack.push(next[v].shift());
    else path.push(stack.pop());
  }
  return path.reverse();
}

/** Prüft die Matrix auf Unstimmigkeiten. Rückgabe: [{ level: 'fehler'|'hinweis', text }] */
function lintMatrix(doc, { stingerPathExists } = {}) {
  const findings = [];
  const add = (level, text) => findings.push({ level, text });
  const m = buildMatrix(doc);
  for (const [scene, t] of Object.entries(m.into)) {
    if (!t.defined) add('fehler', `Szene "${scene}": Übergang "${t.name}" ist nicht definiert`);
    else if (t.durationMs != null && (t.durationMs < 150 || t.durationMs > 1500)) add('hinweis', `Szene "${scene}": ${t.name} mit ${t.durationMs} ms wirkt zu kurz oder zu lang (sinnvoll: 150 bis 1500 ms)`);
  }
  for (const t of doc.transitions || []) {
    if (isStinger(t.id)) {
      if (!t.settings?.path) add('fehler', `Stinger "${t.name}" hat keinen Videopfad`);
      else if (stingerPathExists && !stingerPathExists(t.settings.path)) add('fehler', `Stinger-Video fehlt: ${t.settings.path}`);
      if (!(t.settings?.transition_point > 0)) add('fehler', `Stinger "${t.name}": Schnittpunkt (transition_point) fehlt`);
    }
  }
  for (const t of doc.transitions || []) {
    if (NON_CONFIGURABLE.has(t.id)) add('fehler', `Übergang "${t.name}" (${t.id}) wird von OBS beim Speichern verworfen; stattdessen den eingebauten Übergang "${BUILTIN[t.id]}" mit Szenen-Dauer verwenden`);
  }
  const used = new Set(Object.values(m.into).map((t) => t.name));
  for (const t of doc.transitions || []) if (!used.has(t.name)) add('hinweis', `Übergang "${t.name}" wird von keiner Szene automatisch genutzt (nur manuell oder per Hotkey)`);
  return findings;
}

/** Tabelle: Zeile = von, Spalte = nach. */
function matrixMarkdown(m) {
  const short = (t) => (t.kind && isStinger(t.kind) ? `${t.name} (${t.cutPointMs} ms Schnitt)` : `${t.name}${t.durationMs != null ? ` ${t.durationMs} ms` : ''}`);
  const head = `| von \\ nach | ${m.scenes.join(' | ')} |`;
  const sep = `|---|${m.scenes.map(() => '---').join('|')}|`;
  const rows = m.scenes.map((from) => `| **${from}** | ${m.scenes.map((to) => (to === from ? '·' : short(m.into[to]))).join(' | ')} |`);
  return [head, sep, ...rows].join('\n');
}

module.exports = { NON_CONFIGURABLE, BUILTIN, isStinger, publicScenes, transitionInto, buildMatrix, eulerTour, lintMatrix, matrixMarkdown };
