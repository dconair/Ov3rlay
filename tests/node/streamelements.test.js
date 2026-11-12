'use strict';
const test = require('node:test');
const assert = require('node:assert');
const se = require('../../payload/assets/web/streamelements.js');

const act = (type, data) => ({ type: 'message', topic: 'channel.activities', data: { type, provider: 'twitch', channel: 'c1', data } });

test('Aktivitäten werden auf Alert-Typen abgebildet', () => {
  assert.deepStrictEqual(se.fromActivity(act('follow', { username: 'mara', displayName: 'Mara' })), { name: 'Mara', message: '', type: 'follow' });
  const sub = se.fromActivity(act('subscriber', { username: 'nico', amount: 3, message: 'Bass!' }));
  assert.strictEqual(sub.type, 'sub'); assert.strictEqual(sub.amount, 3); assert.strictEqual(sub.message, 'Bass!');
  assert.strictEqual(se.fromActivity(act('cheer', { username: 'a', amount: 100 })).type, 'cheer');
  assert.strictEqual(se.fromActivity(act('raid', { username: 'lea', amount: 42 })).amount, 42);
  assert.strictEqual(se.fromActivity(act('tip', { username: 'x' })), null, 'Tips kommen nur über channel.tips');
  assert.strictEqual(se.fromActivity(act('hypetrainStart', {})), null);
});

test('Tips werden formatiert, abgelehnte ignoriert', () => {
  const tip = (approved) => ({ type: 'message', topic: 'channel.tips', data: { approved, donation: { user: { username: 'tom' }, amount: 5, currency: 'EUR', message: 'Hi' } } });
  const out = se.fromTip(tip('allowed'));
  assert.strictEqual(out.type, 'tip'); assert.strictEqual(out.name, 'tom'); assert.match(out.amount, /5,00/);
  assert.strictEqual(se.fromTip(tip('rejected')), null);
});

test('connect: ohne Token keine Verbindung; mit Token Abo auf beide Themen und Weitergabe', async () => {
  const sockets = [];
  class FakeWS { constructor(u) { this.url = u; this.sent = []; sockets.push(this); setTimeout(() => this.onopen && this.onopen(), 0); }
    send(s) { this.sent.push(JSON.parse(s)); } close() {} }
  assert.strictEqual(se.connect({}, () => {}, FakeWS), null);
  const got = [];
  const c = se.connect({ seToken: 'TOKEN', seChannelId: 'room1' }, (a) => got.push(a), FakeWS);
  await new Promise((r) => setTimeout(r, 400));
  const ws = sockets[0];
  assert.strictEqual(ws.url, 'wss://astro.streamelements.com/');
  assert.deepStrictEqual(ws.sent.map((m) => m.data.topic).sort(), ['channel.activities', 'channel.tips']);
  assert.ok(ws.sent.every((m) => m.type === 'subscribe' && m.data.token === 'TOKEN' && m.data.token_type === 'apikey' && m.data.room === 'room1'));
  ws.onmessage({ data: JSON.stringify({ type: 'welcome', data: {} }) });
  ws.onmessage({ data: JSON.stringify({ ...act('follow', { username: 'mara' }) }) });
  ws.onmessage({ data: 'kein json' });
  assert.deepStrictEqual(got.map((a) => a.type), ['follow']);
  c.stop();
});
