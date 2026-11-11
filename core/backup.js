'use strict';
// Sicherung und Wiederherstellung: Vor jeder Änderung wird die betroffene Datei samt Originalpfad abgelegt.
const fs = require('node:fs');
const nodePath = require('node:path');

const stampOf = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

class Backup {
  constructor(appDir, stamp = stampOf()) {
    this.stamp = stamp;
    this.dir = nodePath.join(appDir, 'backups', stamp);
    this.entries = []; // { saved, original } gesicherte Dateien
    this.created = []; // Pfade, die es vorher nicht gab (bei Wiederherstellung löschen)
  }

  /** Sichert Datei oder Ordner (falls vorhanden), sonst merkt es sich, dass der Pfad neu entsteht. */
  add(original) {
    if (this.entries.some((e) => e.original === original) || this.created.includes(original)) return;
    if (!fs.existsSync(original)) { this.created.push(original); return; }
    const saved = `${String(this.entries.length).padStart(2, '0')}-${nodePath.basename(original)}`;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.cpSync(original, nodePath.join(this.dir, saved), { recursive: true });
    this.entries.push({ saved, original });
  }

  get used() { return this.entries.length > 0 || this.created.length > 0; }

  save() {
    if (!this.used) return;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(nodePath.join(this.dir, 'backup.json'),
      JSON.stringify({ stamp: this.stamp, entries: this.entries, created: this.created }, null, 2) + '\n', 'utf8');
  }
}

function listBackups(appDir) {
  const root = nodePath.join(appDir, 'backups');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((s) => fs.existsSync(nodePath.join(root, s, 'backup.json'))).sort().reverse()
    .map((stamp) => ({ stamp, ...JSON.parse(fs.readFileSync(nodePath.join(root, stamp, 'backup.json'), 'utf8')) }));
}

/** Stellt eine Sicherung wieder her: gesicherte Dateien zurückkopieren, neu entstandene entfernen. */
function restoreBackup(appDir, stamp) {
  const info = listBackups(appDir).find((b) => b.stamp === stamp);
  if (!info) throw new Error(`Sicherung ${stamp} nicht gefunden`);
  const dir = nodePath.join(appDir, 'backups', stamp);
  for (const p of info.created) fs.rmSync(p, { recursive: true, force: true });
  for (const { saved, original } of info.entries) {
    fs.rmSync(original, { recursive: true, force: true });
    fs.mkdirSync(nodePath.dirname(original), { recursive: true });
    fs.cpSync(nodePath.join(dir, saved), original, { recursive: true });
  }
  return { restored: info.entries.length, removed: info.created.length };
}

module.exports = { Backup, stampOf, listBackups, restoreBackup };
