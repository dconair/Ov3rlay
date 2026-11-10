'use strict';
// Startet die App kurz unter Xvfb und legt Screenshots der Oberfläche ab (Entwicklungs- und CI-Hilfe).
// Aufruf: xvfb-run -a npx electron tests/electron_shots.js OUTDIR --no-sandbox
const { app, BrowserWindow } = require('electron');
const nodePath = require('node:path');
const fs = require('node:fs');
const out = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'shots';
process.env.DC_NO_SINGLE_INSTANCE = '1';
app.commandLine.appendSwitch('no-sandbox');
require('../electron/main.js');
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise((r) => setTimeout(r, 2500));
  const win = BrowserWindow.getAllWindows()[0];
  const grab = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(nodePath.join(out, name), img.toPNG()); };
  const click = (label) => win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(label)}))?.click()`);
  await grab('1-pruefen.png');
  await click('Weiter'); await new Promise((r) => setTimeout(r, 400));
  await grab('2-einstellungen.png');
  app.exit(0);
});
