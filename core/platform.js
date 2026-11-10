'use strict';
// Plattform und Standardpfade. Alle Pfade sind per DC_*-Umgebungsvariablen überschreibbar (Tests, Sonderfälle).
const os = require('node:os');
const nodePath = require('node:path');

function detectPlatform(p = process.platform) {
  return p === 'win32' ? 'windows' : p === 'darwin' ? 'macos' : 'linux';
}

/** Standardpfade je Betriebssystem. `platform` darf von der echten abweichen (Tests). */
function defaultPaths(platform = detectPlatform(), env = process.env, home = os.homedir()) {
  const w = platform === 'windows';
  const j = w ? nodePath.win32.join : nodePath.posix.join;
  let paths;
  if (w) {
    const roaming = env.APPDATA || j(home, 'AppData', 'Roaming');
    const local = env.LOCALAPPDATA || j(home, 'AppData', 'Local');
    paths = {
      obsConfig: j(roaming, 'obs-studio'),
      appDir: j(roaming, 'dc_onair'),
      fontDir: j(local, 'Microsoft', 'Windows', 'Fonts'),
      recDir: j(home, 'Videos'),
    };
  } else if (platform === 'macos') {
    const support = j(home, 'Library', 'Application Support');
    paths = {
      obsConfig: j(support, 'obs-studio'),
      appDir: j(support, 'dc_onair'),
      fontDir: j(home, 'Library', 'Fonts'),
      recDir: j(home, 'Movies'),
    };
  } else {
    const config = env.XDG_CONFIG_HOME || j(home, '.config');
    const data = env.XDG_DATA_HOME || j(home, '.local', 'share');
    paths = {
      obsConfig: j(config, 'obs-studio'),
      appDir: j(config, 'dc_onair'),
      fontDir: j(data, 'fonts'),
      recDir: j(home, 'Videos'),
    };
  }
  const overrides = { obsConfig: 'DC_OBS_CONFIG', appDir: 'DC_APP_DIR', fontDir: 'DC_FONT_DIR', recDir: 'DC_REC_DIR' };
  for (const [key, name] of Object.entries(overrides)) if (env[name]) paths[key] = env[name];
  return paths;
}

/** Standardschrift der Plattform, falls die Marke keine eigene mitbringt. */
const systemFont = (platform) => (platform === 'windows' ? 'Segoe UI' : platform === 'macos' ? 'Helvetica Neue' : 'DejaVu Sans');

module.exports = { detectPlatform, defaultPaths, systemFont };
