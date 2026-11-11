'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { defaultPaths, detectPlatform } = require('../../core/platform');
const { iniSetText, iniGetText } = require('../../core/ini');
const { render, renderJson, tokensIn } = require('../../core/template');
const { pickEncoder } = require('../../core/encoder');
const { authString } = require('../../core/ws');
const { ensureWebsocketConfig } = require('../../core/obs');
const { Backup, listBackups, restoreBackup } = require('../../core/backup');
const { guessCamera, ROLES } = require('../../core/cameras');
const { sandbox } = require('./helpers');

test('Plattform und Standardpfade', () => {
  assert.equal(detectPlatform('win32'), 'windows');
  assert.equal(detectPlatform('darwin'), 'macos');
  const win = defaultPaths('windows', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'C:\\Users\\a');
  assert.equal(win.obsConfig, 'C:\\Users\\a\\AppData\\Roaming\\obs-studio');
  assert.equal(win.fontDir, 'C:\\Users\\a\\AppData\\Local\\Microsoft\\Windows\\Fonts');
  const mac = defaultPaths('macos', {}, '/Users/a');
  assert.equal(mac.obsConfig, '/Users/a/Library/Application Support/obs-studio');
  assert.equal(mac.recDir, '/Users/a/Movies');
  assert.equal(defaultPaths('macos', { DC_APP_DIR: '/x' }, '/Users/a').appDir, '/x');
});

test('INI: Schlüssel setzen, anlegen, übrige Zeilen bleiben', () => {
  let t = '[General]\nFirstRun=true\n\n[Basic]\nProfile=Alt\n\n[Video]\nRenderer=OpenGL\n';
  t = iniSetText(t, 'Basic', 'Profile', 'dc_onair');
  t = iniSetText(t, 'Basic', 'ProfileDir', 'dc_onair');
  t = iniSetText(t, 'Neu', 'a', '1');
  assert.equal(iniGetText(t, 'Basic', 'Profile'), 'dc_onair');
  assert.equal(iniGetText(t, 'Basic', 'ProfileDir'), 'dc_onair');
  assert.equal(iniGetText(t, 'Video', 'Renderer'), 'OpenGL');
  assert.equal(iniGetText(t, 'Neu', 'a'), '1');
  assert.equal((t.match(/\[Basic\]/g) || []).length, 1);
  assert.equal(iniSetText('', 'A', 'k', 'v'), '[A]\nk=v\n');
});

test('Vorlagen: JSON-sicheres Ersetzen, unbekannte Platzhalter werden leer', () => {
  const tpl = '{"p":"{{ASSETS}}/x","n":"{{NAME}}","u":"{{UNBEKANNT}}"}';
  assert.deepEqual(tokensIn(tpl).sort(), ['ASSETS', 'NAME', 'UNBEKANNT']);
  const doc = JSON.parse(renderJson(tpl, { ASSETS: 'C:\\Users\\a "b"', NAME: 'iPhone von "Max"' }));
  assert.equal(doc.p, 'C:\\Users\\a "b"/x');
  assert.equal(doc.n, 'iPhone von "Max"');
  assert.equal(doc.u, '');
  assert.equal(render('a={{X}}', { X: 5 }), 'a=5');
});

test('Encoder-Wahl nach Grafikkarte', () => {
  assert.equal(pickEncoder('windows', ['NVIDIA GeForce RTX 3060', 'Intel(R) UHD Graphics']).id, 'nvenc');
  assert.equal(pickEncoder('windows', ['AMD Radeon RX 6600']).id, 'amd');
  assert.equal(pickEncoder('windows', ['Intel(R) Iris(R) Xe Graphics']).id, 'qsv');
  assert.equal(pickEncoder('windows', ['Microsoft Basic Display Adapter']).id, 'x264');
  assert.equal(pickEncoder('windows', []).id, 'x264');
  const mac = pickEncoder('macos', ['Apple M2']);
  assert.equal(mac.obsValue, 'apple_h264');
});

test('obs-websocket: Authentifizierung nach Protokolldokumentation', () => {
  assert.equal(authString('supersecretpassword', 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=', '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY='),
    '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=');
});

test('obs-websocket-Konfiguration: Nutzerwerte bleiben, beide Formate werden geschrieben', () => {
  const { paths } = sandbox('ws');
  fs.mkdirSync(paths.obsConfig, { recursive: true });
  fs.writeFileSync(nodePath.join(paths.obsConfig, 'global.ini'), '[OBSWebSocket]\nServerPort=4466\nServerPassword=geheim\nAuthRequired=true\n');
  const r = ensureWebsocketConfig(paths.obsConfig);
  assert.equal(r.port, 4466);
  assert.equal(r.password, 'geheim');
  const json = JSON.parse(fs.readFileSync(nodePath.join(paths.obsConfig, 'plugin_config', 'obs-websocket', 'config.json'), 'utf8'));
  assert.equal(json.server_enabled, true);
  assert.equal(json.server_password, 'geheim');
  const ini = fs.readFileSync(nodePath.join(paths.obsConfig, 'global.ini'), 'utf8');
  assert.match(ini, /ServerEnabled=true/);
  assert.match(ini, /FirstLoad=false/);
  // zweiter Aufruf ändert nichts mehr
  assert.equal(ensureWebsocketConfig(paths.obsConfig).changed, false);
  // frische Installation: Passwort wird erzeugt
  const fresh = sandbox('ws2').paths;
  const f = ensureWebsocketConfig(fresh.obsConfig);
  assert.equal(f.port, 4455);
  assert.ok(f.password.length >= 12);
});

test('Sicherung und Wiederherstellung', () => {
  const { paths } = sandbox('bk');
  fs.mkdirSync(paths.obsConfig, { recursive: true });
  const kept = nodePath.join(paths.obsConfig, 'kept.txt');
  const made = nodePath.join(paths.obsConfig, 'neu.txt');
  fs.writeFileSync(kept, 'alt');
  const b = new Backup(paths.appDir, '20260101-000000');
  b.add(kept); b.add(made);
  b.save();
  fs.writeFileSync(kept, 'neu'); fs.writeFileSync(made, 'x');
  assert.equal(listBackups(paths.appDir).length, 1);
  assert.deepEqual(restoreBackup(paths.appDir, '20260101-000000'), { restored: 1, removed: 1 });
  assert.equal(fs.readFileSync(kept, 'utf8'), 'alt');
  assert.equal(fs.existsSync(made), false);
  assert.throws(() => restoreBackup(paths.appDir, 'gibt-es-nicht'));
});

test('Kamera-Vorschläge: iPhone und Sony nur einmal vergeben', () => {
  const cams = [{ id: 'a', name: 'FaceTime HD Kamera' }, { id: 'b', name: 'Sony ILCE-7M2' }, { id: 'c', name: "Davids iPhone Kamera" }];
  const [iphone, sony] = ROLES;
  assert.equal(guessCamera(iphone, cams).id, 'c');
  assert.equal(guessCamera(sony, cams).id, 'b');
  assert.equal(guessCamera(sony, cams, ['b']), undefined);
});
