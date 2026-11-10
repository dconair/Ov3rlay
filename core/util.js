'use strict';
// Kleine Helfer: Prozesse ausführen (nie werfen), Pfade prüfen, JSON-Escape.
const { execFile } = require('node:child_process');
const fs = require('node:fs');

/** Führt einen Befehl aus. Wirft nie; liefert { code, stdout, stderr }. */
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', ...opts },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '', stderr: stderr || '' }));
  });
}

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

/** Text für die Einbettung in einen JSON-String (ohne umschließende Anführungszeichen). */
const jsonEscape = (s) => JSON.stringify(String(s ?? '')).slice(1, -1);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { run, exists, jsonEscape, sleep };
