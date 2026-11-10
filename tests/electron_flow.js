'use strict';
// GUI-Durchlauf unter Xvfb mit echtem OBS: Prüfen -> Einstellungen -> Installieren -> Kameras -> Selbsttest -> Fertig.
// Aufruf: node tests/electron_flow.js OUTDIR     (startet selbst xvfb-run + electron)
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

if (process.argv[2] === '--inner') {
  const { app, BrowserWindow } = require('electron');
  const out = process.argv[3];
  app.commandLine.appendSwitch('no-sandbox');
  require('../electron/main.js');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true });
    await wait(2500);
    const win = BrowserWindow.getAllWindows()[0];
    const js = (code) => win.webContents.executeJavaScript(code);
    const grab = async (name) => { for (let i = 0; ; i++) { try { return fs.writeFileSync(nodePath.join(out, name), (await win.webContents.capturePage()).toPNG()); } catch (e) { if (i >= 4) throw e; await wait(1000); } } };
    const click = (label) => js(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(label)})&&!b.disabled); if(b) b.click(); return !!b; })()`);
    const until = async (cond, ms = 240000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(cond)) return true; await wait(500); } return false; };
    let code = 1;
    try {
      await grab('1-pruefen.png');
      if (!await click('Weiter')) throw new Error('Weiter (Prüfen) nicht klickbar');
      await wait(300); await grab('2-einstellungen.png');
      await click('Installieren');
      if (!await until(`document.body.innerText.includes('Weiter zu den Kameras')`, 60000)) throw new Error('Installation hängt');
      await grab('3-installiert.png');
      await click('Weiter zu den Kameras');
      if (!await until(`document.body.innerText.includes('Zuweisen') || document.body.innerText.includes('Erneut versuchen')`)) throw new Error('Kameras hängt');
      await grab('4-kameras.png');
      if (!await click('Zuweisen')) await click('Überspringen');
      if (!await until(`document.body.innerText.includes('Test starten')`, 30000)) throw new Error('Selbsttest-Seite nicht erreicht');
      await click('Test starten');
      if (!await until(`document.body.innerText.includes('Selbsttest bestanden') || document.body.innerText.includes('nicht bestanden')`)) throw new Error('Selbsttest hängt');
      await grab('5-selftest.png');
      const passed = await js(`document.body.innerText.includes('Selbsttest bestanden')`);
      await click('Weiter'); await wait(300); await grab('6-fertig.png');
      code = passed ? 0 : 1;
    } catch (e) { console.error('FEHLER:', e.message); await grab('fehler.png').catch(() => {}); }
    try { execFileSync('pkill', ['-x', 'obs']); } catch { /* beendet */ }
    app.exit(code);
  });
} else {
  const out = nodePath.resolve(process.argv[2] || 'eshots');
  const root = nodePath.join(__dirname, '..');
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'dc-flow-'));
  const payload = nodePath.join(tmp, 'payload');
  fs.cpSync(nodePath.join(root, 'payload'), payload, { recursive: true });
  fs.writeFileSync(nodePath.join(payload, 'scenes', 'dc_onair.linux.json'), execFileSync('python3', ['-c',
    'import sys,json; sys.path.insert(0,"tools"); import build_collection as b; print(json.dumps(b.build("linux", False), ensure_ascii=False))'], { cwd: root, encoding: 'utf8' }));
  const env = { ...process.env, HOME: tmp, XDG_CONFIG_HOME: nodePath.join(tmp, '.config'), XDG_DATA_HOME: nodePath.join(tmp, '.local', 'share'),
    LIBGL_ALWAYS_SOFTWARE: '1', DC_PAYLOAD_DIR: payload, DC_NO_SINGLE_INSTANCE: '1' };
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1280x900x24', nodePath.join(root, 'node_modules', '.bin', 'electron'), __filename, '--inner', out, '--no-sandbox'],
    { env, stdio: 'inherit', timeout: 600000 });
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}
