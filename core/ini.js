'use strict';
// Minimaler INI-Zugriff im Stil der OBS-Dateien (global.ini, user.ini, basic.ini): Abschnitte [X], Zeilen key=value.
const fs = require('node:fs');
const nodePath = require('node:path');

const readText = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const writeText = (file, text) => { fs.mkdirSync(nodePath.dirname(file), { recursive: true }); fs.writeFileSync(file, text, 'utf8'); };

/** Setzt key in [section]; legt Abschnitt/Schlüssel an, übrige Zeilen bleiben unverändert. */
function iniSetText(text, section, key, value) {
  const lines = text ? text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n') : [];
  const out = [];
  let inSection = false, done = false, seen = false;
  for (const line of lines) {
    if (line.startsWith('[')) {
      if (inSection && !done) { out.push(`${key}=${value}`); done = true; }
      inSection = line.trim() === `[${section}]`;
      if (inSection) seen = true;
    } else if (inSection && line.startsWith(`${key}=`)) {
      out.push(`${key}=${value}`); done = true; continue;
    }
    out.push(line);
  }
  if (!seen) { if (out.length) out.push(''); out.push(`[${section}]`, `${key}=${value}`); }
  else if (inSection && !done) out.push(`${key}=${value}`);
  return out.join('\n') + '\n';
}

function iniGetText(text, section, key) {
  let inSection = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('[')) inSection = line.trim() === `[${section}]`;
    else if (inSection && line.startsWith(`${key}=`)) return line.slice(key.length + 1);
  }
  return undefined;
}

function iniSet(file, section, key, value) {
  writeText(file, iniSetText(fs.existsSync(file) ? readText(file) : '', section, key, value));
}
const iniGet = (file, section, key) => (fs.existsSync(file) ? iniGetText(readText(file), section, key) : undefined);

module.exports = { readText, writeText, iniSetText, iniGetText, iniSet, iniGet };
