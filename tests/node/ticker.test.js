'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { parseTrack, composeTicker, TickerBridge, watchWebSocket, MAX_LEN, MIN_LEN } = require('../../core/ticker');

test('Titel aus Text, JSON und Objekt', () => {
  assert.equal(parseTrack('Lane 8 - Sunday Songs\n'), 'Lane 8 - Sunday Songs');
  assert.equal(parseTrack({ artist: 'Lane 8', track: 'Sunday Songs' }), 'Lane 8 - Sunday Songs');
  assert.equal(parseTrack('{"artist":"A","title":"B"}'), 'A - B');
  assert.equal(parseTrack({ artist: '', track: '' }), '');
  assert.equal(parseTrack(null), '');
});

test('Bandtext ist lang genug, aber nicht länger als OBS darstellen kann', () => {
  const short = composeTicker({ current: 'A - B' });
  assert.ok(short.length >= MIN_LEN && short.length <= MAX_LEN, `Länge ${short.length}`);
  assert.match(short, /NOW PLAYING: A - B/);
  const longName = 'X'.repeat(200);
  const big = composeTicker({ current: longName, history: Array(9).fill(longName + 'y') });
  assert.ok(big.length <= MAX_LEN + 120, `Länge ${big.length}`);
});

test('Verlauf: zuletzt gespielte Titel, neuester zuerst, ohne den laufenden', () => {
  const file = nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'tick-')), 'ticker.txt');
  const b = new TickerBridge({ file, base: 'LIVE' });
  for (const t of ['T1', 'T2', 'T3']) b.setCurrent(t);
  assert.equal(b.setCurrent('T3'), false, 'gleicher Titel schreibt nicht neu');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /NOW PLAYING: T3/);
  assert.match(text, /ZULETZT: T2, T1/);
});

test('WebSocket-Nachricht von Unbox aktualisiert das Band', () => {
  const file = nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'tick-')), 'ticker.txt');
  const b = new TickerBridge({ file, base: 'LIVE' });
  const handlers = {};
  class Fake { constructor() { this.addEventListener = (n, f) => { handlers[n] = f; }; this.close = () => {}; } }
  const stop = watchWebSocket(b, 'ws://x', { WebSocketImpl: Fake });
  handlers.message({ data: JSON.stringify({ artist: 'Lane 8', track: 'Sunday Songs', bpm: '120' }) });
  stop();
  assert.match(fs.readFileSync(file, 'utf8'), /NOW PLAYING: Lane 8 - Sunday Songs/);
});
