'use strict';
// Schlanker obs-websocket-5-Client (kein npm-Paket nötig). Nutzt den in Node und Electron eingebauten WebSocket.
const crypto = require('node:crypto');
const { sleep } = require('./util');

const SUB = { General: 1, Config: 2, Scenes: 4, Inputs: 8, Transitions: 16, Filters: 32, Outputs: 64, SceneItems: 128, MediaInputs: 256, Ui: 1024 };

/** Antwort auf die Authentifizierungs-Challenge (obs-websocket-Protokoll 5.x). */
function authString(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

class ObsWs {
  constructor(socket) {
    this.socket = socket;
    this.counter = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
    socket.addEventListener('message', (ev) => this._onMessage(JSON.parse(ev.data)));
    socket.addEventListener('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error('Verbindung zu OBS getrennt'));
      this.pending.clear();
    });
  }

  /** Verbindet und authentifiziert. Wirft bei Fehler mit verständlicher Meldung. */
  static connect({ host = '127.0.0.1', port = 4455, password = '', timeoutMs = 8000, events = SUB.Scenes | SUB.Transitions } = {}) {
    return new Promise((resolve, reject) => {
      let socket;
      try { socket = new WebSocket(`ws://${host}:${port}`, 'obswebsocket.json'); } catch (e) { return reject(e); }
      const timer = setTimeout(() => { try { socket.close(); } catch { /* egal */ } reject(new Error('Zeitüberschreitung beim Verbinden mit OBS')); }, timeoutMs);
      const fail = (msg) => { clearTimeout(timer); reject(new Error(msg)); };
      socket.addEventListener('error', () => fail(`OBS-WebSocket auf Port ${port} nicht erreichbar`));
      socket.addEventListener('close', (ev) => { if (ev.code === 4009) fail('OBS-WebSocket: falsches Passwort'); });
      socket.addEventListener('message', function onHello(ev) {
        const msg = JSON.parse(ev.data);
        if (msg.op === 0) {
          const d = { rpcVersion: 1, eventSubscriptions: events };
          if (msg.d.authentication) d.authentication = authString(password, msg.d.authentication.salt, msg.d.authentication.challenge);
          socket.send(JSON.stringify({ op: 1, d }));
        } else if (msg.op === 2) {
          socket.removeEventListener('message', onHello);
          clearTimeout(timer);
          const ws = new ObsWs(socket);
          ws.hello = msg.d;
          resolve(ws);
        }
      });
    });
  }

  _onMessage(msg) {
    if (msg.op === 7) {
      const p = this.pending.get(msg.d.requestId);
      if (!p) return;
      this.pending.delete(msg.d.requestId);
      const st = msg.d.requestStatus;
      if (st.result) p.resolve(msg.d.responseData || {});
      else { const e = new Error(`${msg.d.requestType}: ${st.comment || 'Fehler'}`); e.code = st.code; p.reject(e); }
    } else if (msg.op === 5) {
      const ev = { type: msg.d.eventType, data: msg.d.eventData || {}, at: performance.now() };
      for (const l of this.listeners) l(ev);
    }
  }

  /** Request senden. Code 207 (OBS startet noch) wird bis zu 60 s lang wiederholt. */
  async call(type, data = {}, { retryMs = 60000 } = {}) {
    const deadline = Date.now() + retryMs;
    for (;;) {
      try {
        return await new Promise((resolve, reject) => {
          if (this.closed) return reject(new Error('Verbindung zu OBS getrennt'));
          const requestId = String(++this.counter);
          this.pending.set(requestId, { resolve, reject });
          this.socket.send(JSON.stringify({ op: 6, d: { requestType: type, requestId, requestData: data } }));
        });
      } catch (e) {
        if (e.code === 207 && Date.now() < deadline) { await sleep(500); continue; }
        throw e;
      }
    }
  }

  /** Ereignis-Abo; liefert eine Funktion zum Abmelden. */
  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Wartet auf ein Ereignis (optional mit Filter). */
  waitEvent(type, filter = () => true, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const off = this.onEvent((ev) => { if (ev.type === type && filter(ev)) { cleanup(); resolve(ev); } });
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Zeitüberschreitung: ${type}`)); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); off(); };
    });
  }

  close() { try { this.socket.close(); } catch { /* egal */ } }
}

/** Wartet, bis OBS per WebSocket antwortet (Start dauert je nach Rechner 5 bis 40 s). */
async function connectWithRetry(opts, { timeoutMs = 90000, onWait } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try { return await ObsWs.connect(opts); } catch (e) {
      last = e;
      if (/Passwort/.test(e.message)) throw e;
      if (Date.now() > deadline) throw last;
      onWait?.();
      await sleep(1000);
    }
  }
}

module.exports = { ObsWs, SUB, authString, connectWithRetry };
