'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { buildMatrix, eulerTour, lintMatrix, transitionInto, publicScenes } = require('../../core/matrix');
const { payloadDir, readJson } = require('./helpers');

const variants = fs.readdirSync(nodePath.join(payloadDir, 'scenes')).filter((f) => f.endsWith('.json'));

test('Euler-Tour deckt jedes geordnete Szenenpaar genau einmal ab', () => {
  for (const n of [2, 3, 6, 9]) {
    const nodes = Array.from({ length: n }, (_, i) => `S${i}`);
    const tour = eulerTour(nodes);
    assert.equal(tour.length, n * (n - 1) + 1);
    const pairs = new Set();
    for (let i = 0; i < tour.length - 1; i++) { assert.notEqual(tour[i], tour[i + 1]); pairs.add(`${tour[i]}>${tour[i + 1]}`); }
    assert.equal(pairs.size, n * (n - 1));
    assert.equal(tour[0], tour[tour.length - 1]);
  }
});

for (const file of variants) {
  test(`Übergangsmatrix ${file}: vollständig, konsistent, ohne Fehler`, () => {
    const doc = readJson(nodePath.join(payloadDir, 'scenes', file));
    const m = buildMatrix(doc);
    const n = publicScenes(doc).length;
    assert.ok(n >= 8);
    assert.equal(m.pairs.length, n * (n - 1));
    for (const p of m.pairs) assert.ok(p.defined, `${p.from} -> ${p.to}: Übergang ${p.name} fehlt`);
    // Regel: Der Übergang hängt nur von der Zielszene ab (so arbeitet OBS)
    for (const scene of m.scenes) assert.equal(new Set(m.pairs.filter((p) => p.to === scene).map((p) => p.name)).size, 1);
    const errors = lintMatrix(doc).filter((f) => f.level === 'fehler');
    assert.deepEqual(errors, []);
  });
}

test('Stinger ist Standard, Kameraszenen bekommen Slide oder Move, Verbindungsabbruch bekommt Fade', () => {
  const doc = readJson(nodePath.join(payloadDir, 'scenes', 'dc_onair.windows.json'));
  assert.equal(transitionInto(doc, '01 Starting Soon').kind, 'obs_stinger_transition');
  assert.equal(transitionInto(doc, '02 Kamera iPhone').kind, 'slide_transition');
  const lost = publicScenes(doc).find((s) => /Connection Lost/.test(s));
  if (lost) assert.equal(transitionInto(doc, lost).kind, 'fade_transition');
});
