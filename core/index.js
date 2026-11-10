'use strict';
// Gemeinsame Einstiegspunkte für CLI und Electron: gleiche Logik, keine Doppelungen.
const fs = require('node:fs');
const nodePath = require('node:path');
const platformLib = require('./platform');
const obs = require('./obs');
const encoder = require('./encoder');
const cameras = require('./cameras');
const installLib = require('./install');
const backupLib = require('./backup');
const matrix = require('./matrix');
const { runSelftest, forceSave } = require('./selftest');
const { ObsWs, connectWithRetry } = require('./ws');
const { readText } = require('./ini');
const { sleep, exists } = require('./util');

/** Payload-Ordner: DC_PAYLOAD_DIR (Tests), sonst der mitgelieferte in der gepackten App, sonst der im Repository. */
function resolvePayloadDir(env = process.env) {
  if (env.DC_PAYLOAD_DIR) return env.DC_PAYLOAD_DIR;
  const packaged = process.resourcesPath && nodePath.join(process.resourcesPath, 'payload');
  if (packaged && exists(nodePath.join(packaged, 'brand.env'))) return packaged;
  return nodePath.join(__dirname, '..', 'payload');
}

/** Verbindet mit OBS; startet es bei Bedarf mit unserer Collection. */
async function connectObs({ platform, paths, collection, obsInfo, launch = true, onWait, wrapper, timeoutMs }) {
  const cfg = obs.ensureWebsocketConfig(paths.obsConfig);
  const opts = { port: cfg.port, password: cfg.password };
  const running = await obs.isObsRunning(platform);
  if (!running && launch) {
    if (!obsInfo) throw new Error('OBS wurde nicht gefunden');
    obs.launchObs(obsInfo, { collection, wrapper });
  }
  if (running && cfg.changed) throw new Error('OBS läuft bereits, kennt die neuen WebSocket-Einstellungen aber noch nicht. Bitte OBS beenden und erneut versuchen.');
  return connectWithRetry(opts, { onWait, timeoutMs });
}

/** Selbsttest gegen die installierte Collection. */
async function selftest({ ws, paths, collection, shotsDir, onProgress, skipTour }) {
  const collectionFile = nodePath.join(paths.obsConfig, 'basic', 'scenes', `${collection}.json`);
  // Erwartung = so wie installiert; die von OBS umgeschriebene Datei könnte schon Verluste enthalten
  const expected = nodePath.join(paths.appDir, 'collection.expected.json');
  const doc = JSON.parse(readText(fs.existsSync(expected) ? expected : collectionFile));
  return runSelftest({ ws, doc, collectionFile, assetsDir: nodePath.join(paths.appDir, 'assets'), shotsDir, onProgress, skipTour });
}

module.exports = { forceSave, resolvePayloadDir, platformLib, obs, encoder, cameras, installLib, backupLib, matrix, runSelftest, selftest, ObsWs, connectObs, sleep, fs };
