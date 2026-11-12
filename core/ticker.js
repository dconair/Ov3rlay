'use strict';
// Laufband automatisch füllen: liest den laufenden Titel aus einer Textdatei (die ein Zusatztool schreibt) oder
// per WebSocket (Unbox) und schreibt daraus ticker.txt, inklusive Liste der zuletzt gespielten Titel.
const fs = require('node:fs');
const nodePath = require('node:path');

const MAX_LEN = 300; // Text in OBS wird sonst breiter als die Textur erlaubt (ca. 4000 Pixel bei 22 px Space Mono)
const MIN_LEN = 170; // mindestens so lang, damit das Band durchgehend gefüllt bleibt

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Titel aus Text ("Artist - Titel"), Objekt ({artist, track|title}) oder JSON-String. Leer = nichts spielt. */
function parseTrack(input) {
  let v = input;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('{')) { try { v = JSON.parse(t); } catch { /* bleibt Text */ } }
  }
  if (v && typeof v === 'object') {
    const artist = clean(v.artist), title = clean(v.track ?? v.title);
    return clean([artist, title].filter(Boolean).join(' - '));
  }
  return clean(String(v ?? '').split(/\r?\n/)[0]);
}

/** Bandtext: Grundzeile, laufender Titel, zuletzt gespielte Titel. Wird wiederholt, bis das Band gefüllt ist. */
function composeTicker({ base = 'LIVE  ///  IRL OUTDOOR', current = '', history = [], maxHistory = 4 } = {}) {
  const parts = [base];
  if (current) parts.push(`NOW PLAYING: ${clip(current, 60)}`);
  const past = history.filter((t) => t && t !== current).slice(-maxHistory).reverse().map((t) => clip(t, 40));
  if (past.length) parts.push(`ZULETZT: ${past.join(', ')}`);
  const unit = `${parts.join('  ///  ')}  ///  `;
  let out = unit;
  while (out.length < MIN_LEN && out.length + unit.length <= MAX_LEN) out += unit;
  return out.length > MAX_LEN ? unit : out;
}

/** Hält den Zustand (aktueller Titel, Verlauf) und schreibt die Datei bei Änderungen. */
class TickerBridge {
  constructor({ file, base, maxHistory = 4, log = () => {} }) {
    Object.assign(this, { file, base, maxHistory, log, current: '', history: [] });
  }

  setCurrent(track) {
    const t = parseTrack(track);
    if (t === this.current) return false;
    if (this.current) this.history.push(this.current);
    this.history = this.history.slice(-(this.maxHistory + 1));
    this.current = t;
    this.write();
    this.log(t ? `Läuft: ${t}` : 'Kein Titel');
    return true;
  }

  write() {
    const text = composeTicker({ base: this.base, current: this.current, history: this.history, maxHistory: this.maxHistory });
    fs.mkdirSync(nodePath.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${text}\n`, 'utf8');
  }
}

/** Quelle 1: Textdatei, die ein Zusatztool bei jedem Titelwechsel überschreibt (zum Beispiel now-playing.txt). */
function watchFile(bridge, sourceFile, { intervalMs = 1000 } = {}) {
  const read = () => { try { bridge.setCurrent(fs.readFileSync(sourceFile, 'utf8')); } catch { /* Datei noch nicht da */ } };
  read();
  fs.watchFile(sourceFile, { interval: intervalMs }, read);
  return () => fs.unwatchFile(sourceFile, read);
}

/** Quelle 2: WebSocket von Unbox (ws://localhost:8080/ws), Nachrichten als JSON mit artist und track. Verbindet bei Abbruch neu. */
function watchWebSocket(bridge, url = 'ws://localhost:8080/ws', { retryMs = 4000, WebSocketImpl = globalThis.WebSocket } = {}) {
  let stopped = false, ws;
  const open = () => {
    if (stopped) return;
    ws = new WebSocketImpl(url);
    ws.addEventListener('message', (ev) => { try { bridge.setCurrent(JSON.parse(String(ev.data))); } catch { /* ignorieren */ } });
    ws.addEventListener('close', () => { if (!stopped) setTimeout(open, retryMs); });
    ws.addEventListener('error', () => {});
  };
  open();
  return () => { stopped = true; try { ws.close(); } catch { /* schon zu */ } };
}

module.exports = { parseTrack, composeTicker, TickerBridge, watchFile, watchWebSocket, MAX_LEN, MIN_LEN };
