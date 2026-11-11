'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { install, uninstall, status, QUALITIES, DEFAULTS } = require('../../core/install');
const { encoderById } = require('../../core/encoder');
const { listBackups, restoreBackup } = require('../../core/backup');
const { iniGet } = require('../../core/ini');
const { payloadDir, sandbox, readJson } = require('./helpers');

const noRegistry = async () => ({ code: 0, stdout: '', stderr: '' });

for (const platform of ['windows', 'macos']) {
  test(`Installation (${platform}): Dateien, Platzhalter, Profil, OBS-Auswahl, Rückbau`, async () => {
    const { paths } = sandbox(platform);
    fs.mkdirSync(paths.obsConfig, { recursive: true });
    fs.writeFileSync(nodePath.join(paths.obsConfig, 'global.ini'), '[General]\nFirstRun=true\n\n[Basic]\nProfile=Alt\nProfileDir=Alt\nSceneCollection=Alt\nSceneCollectionFile=Alt\n\n[Video]\nRenderer=OpenGL\n');
    const cams = { iphone: { id: platform === 'windows' ? 'iPhone von "Max":' : 'UID-1', name: 'iPhone von "Max"' }, sony: { id: 'UID-2', name: 'Sony ILCE-7M2' } };
    const common = { payloadDir, platform, paths, exec: noRegistry, move: false, env: { DC_FONT_DIR: 'x' } };

    const r = await install({ ...common, service: 'twitch', quality: '1080p60', encoder: encoderById('nvenc'), cameras: cams, stamp: '20260101-000001' });
    const scene = fs.readFileSync(r.sceneFile, 'utf8');
    assert.ok(!scene.includes('{{'), 'keine offenen Platzhalter');
    const doc = JSON.parse(scene);
    const sources = Object.fromEntries(doc.sources.map((s) => [s.name, s]));
    assert.ok(fs.existsSync(doc.transitions.find((t) => t.id === 'obs_stinger_transition').settings.path), 'Stinger-Datei existiert');
    assert.match(JSON.stringify(sources['CAM iPhone'].settings), /iPhone von \\"Max\\"/);
    assert.ok(!JSON.stringify(sources['CAM Sony A7 II'].settings).includes('{{'));

    const ini = nodePath.join(r.profileDir, 'basic.ini');
    assert.equal(iniGet(ini, 'SimpleOutput', 'StreamEncoder'), 'nvenc');
    assert.equal(iniGet(ini, 'SimpleOutput', 'VBitrate'), '6000');
    assert.equal(iniGet(ini, 'Video', 'FPSCommon'), '60');
    assert.ok(fs.readFileSync(nodePath.join(r.profileDir, 'service.json'), 'utf8').includes('Twitch'));
    for (const f of ['global.ini', 'user.ini']) assert.equal(iniGet(nodePath.join(paths.obsConfig, f), 'Basic', 'SceneCollection'), 'dc_onair');
    assert.equal(iniGet(nodePath.join(paths.obsConfig, 'global.ini'), 'Video', 'Renderer'), 'OpenGL', 'übrige Einstellungen bleiben');
    assert.equal(r.websocket.port, 4455);
    assert.ok(status({ payloadDir, paths }).installed);

    // Zweiter Lauf: andere Einstellungen, vorherige Werte der Erstinstallation bleiben im Manifest
    const r2 = await install({ ...common, service: 'youtube', quality: '720p60', encoder: encoderById('x264'), stamp: '20260101-000002' });
    assert.equal(iniGet(nodePath.join(r2.profileDir, 'basic.ini'), 'Video', 'OutputCY'), '720');
    assert.equal(iniGet(nodePath.join(r2.profileDir, 'basic.ini'), 'SimpleOutput', 'VBitrate'), '6000');
    assert.equal(listBackups(paths.appDir).length, 2);

    // Entfernen setzt OBS auf die ursprüngliche Auswahl zurück
    await uninstall({ payloadDir, platform, paths, exec: noRegistry, env: { DC_FONT_DIR: 'x' }, stamp: '20260101-000003' });
    assert.ok(!fs.existsSync(r.sceneFile) && !fs.existsSync(r.profileDir) && !fs.existsSync(r.assetsDir));
    assert.equal(iniGet(nodePath.join(paths.obsConfig, 'global.ini'), 'Basic', 'SceneCollection'), 'Alt');
    assert.equal(iniGet(nodePath.join(paths.obsConfig, 'global.ini'), 'Basic', 'Profile'), 'Alt');
    assert.ok(!status({ payloadDir, paths }).installed);

    // Sicherung der Erstinstallation stellt die Datei wieder her
    restoreBackup(paths.appDir, '20260101-000003');
    assert.ok(fs.existsSync(r.sceneFile), 'Wiederherstellung bringt die Szenen zurück');
  });
}

test('Move-Variante wird gewählt, wenn das Plugin vorhanden ist', async () => {
  const { paths } = sandbox('move');
  fs.mkdirSync(nodePath.join(paths.obsConfig, 'plugins', 'move-transition'), { recursive: true });
  const r = await install({ payloadDir, platform: 'windows', paths, exec: noRegistry, env: { DC_FONT_DIR: 'x' } });
  assert.equal(r.variant, 'windows.move');
  assert.ok(readJson(r.sceneFile).transitions.some((t) => t.id === 'move_transition'));
});

test('Schrift aus dem Payload wird installiert und beim Entfernen gelöscht', async () => {
  const { paths, root } = sandbox('font');
  const payload = nodePath.join(root, 'payload');
  fs.cpSync(payloadDir, payload, { recursive: true });
  fs.writeFileSync(nodePath.join(payload, 'assets', 'fonts', 'Marke.ttf'), 'font');
  fs.writeFileSync(nodePath.join(payload, 'brand.env'), fs.readFileSync(nodePath.join(payload, 'brand.env'), 'utf8').replace('FONT_FAMILY=', 'FONT_FAMILY=Marke Sans'));
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
  const env = {};
  await install({ payloadDir: payload, platform: 'windows', paths, exec, env, registerFonts: true });
  assert.ok(fs.existsSync(nodePath.join(paths.fontDir, 'Marke.ttf')));
  assert.ok(calls.some((c) => c[0] === 'reg' && c[1] === 'add' && c.includes('Marke (TrueType)')));
  assert.match(fs.readFileSync(nodePath.join(paths.obsConfig, 'basic', 'scenes', 'dc_onair.json'), 'utf8'), /Marke Sans/);
  await uninstall({ payloadDir: payload, platform: 'windows', paths, exec, env, registerFonts: true });
  assert.ok(!fs.existsSync(nodePath.join(paths.fontDir, 'Marke.ttf')));
  assert.ok(calls.some((c) => c[0] === 'reg' && c[1] === 'delete'));
});

test('Eigenes Partner-Logo (CoOp) übersteht eine Neuinstallation', async () => {
  const { paths } = sandbox('partner');
  const opts = { payloadDir, platform: 'windows', paths, exec: async () => '', move: false, env: { DC_FONT_DIR: 'x' }, cameras: {} };
  await install({ ...opts, stamp: '20260101-000010' });
  const file = nodePath.join(paths.appDir, 'assets', 'branding', 'partner_logo.png');
  assert.ok(fs.existsSync(file), 'Platzhalter wird mitgeliefert');
  fs.writeFileSync(file, 'MEIN-LOGO');
  await install({ ...opts, stamp: '20260101-000011' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'MEIN-LOGO');
});

test('Ungültige Eingaben werden abgelehnt', async () => {
  const { paths } = sandbox('bad');
  await assert.rejects(install({ payloadDir, platform: 'windows', paths, service: 'tiktok' }), /Unbekannter Dienst/);
  await assert.rejects(install({ payloadDir, platform: 'windows', paths, quality: '4k' }), /Unbekannte Qualität/);
  await assert.rejects(install({ payloadDir: '/gibt/es/nicht', platform: 'windows', paths }), /Payload/);
  assert.ok(QUALITIES['1080p30']);
  assert.equal(DEFAULTS.quality, '1080p60', 'Standard ist 60 fps');
  assert.equal(QUALITIES[DEFAULTS.quality].fps, 60);
});

test('Ohne Angabe gilt 1080p60, 1080p30 bleibt wählbar', async () => {
  const a = sandbox('fps-default');
  const r = await install({ payloadDir, platform: 'windows', paths: a.paths, exec: async () => '', move: false, env: { DC_FONT_DIR: 'x' }, cameras: {}, stamp: '20260101-000002' });
  assert.equal(r.quality, '1080p60');
  for (const f of ['global.ini', 'user.ini']) assert.equal(iniGet(nodePath.join(a.paths.obsConfig, f), 'General', 'FirstRun'), 'true', `${f}: kein Erststart-Assistent`);
  assert.equal(iniGet(nodePath.join(r.profileDir, 'basic.ini'), 'Video', 'FPSCommon'), '60');
  const b = sandbox('fps-30');
  const r30 = await install({ payloadDir, platform: 'windows', paths: b.paths, exec: async () => '', move: false, env: { DC_FONT_DIR: 'x' }, cameras: {}, quality: '1080p30', stamp: '20260101-000003' });
  assert.equal(iniGet(nodePath.join(r30.profileDir, 'basic.ini'), 'Video', 'FPSCommon'), '30');
});
