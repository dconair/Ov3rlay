'use strict';
// Prüft mit ffmpeg: Der Schnittpunkt des Stingers liegt im Bereich der vollen Deckung (Alpha), sonst blitzt beim Szenenwechsel etwas auf.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const nodePath = require('node:path');
const { payloadDir, readJson } = require('./helpers');

const FPS = 60;
function coverage(file) {
  const w = 64, h = 36;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', file, '-vf', `alphaextract,scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout?.length) return null;
  const frames = r.stdout.length / (w * h);
  return Array.from({ length: frames }, (_, i) => r.stdout.subarray(i * w * h, (i + 1) * w * h).reduce((a, b) => a + b, 0) / (w * h * 255));
}

test('Stinger: Schnittpunkt liegt in der vollen Deckung', (t) => {
  const file = nodePath.join(payloadDir, 'assets', 'video', 'stinger.webm');
  const cov = coverage(file);
  if (!cov) return t.skip('ffmpeg mit libvpx-vp9 nicht verfügbar');
  const doc = readJson(nodePath.join(payloadDir, 'scenes', 'dc_onair.windows.json'));
  const cut = doc.transitions.find((x) => x.id === 'obs_stinger_transition').settings.transition_point;
  const full = cov.map((c, i) => (c > 0.98 ? i : -1)).filter((i) => i >= 0);
  assert.ok(full.length, 'Stinger deckt das Bild nie vollständig ab');
  const from = full[0] / FPS * 1000, to = (full[full.length - 1] + 1) / FPS * 1000;
  assert.ok(cut >= from + 50 && cut <= to - 50, `Schnittpunkt ${cut} ms liegt nicht in der vollen Deckung (${from.toFixed(0)} bis ${to.toFixed(0)} ms)`);
  assert.ok(cov[0] < 0.02 && cov[cov.length - 1] < 0.02, 'Stinger beginnt und endet nicht transparent');
});
