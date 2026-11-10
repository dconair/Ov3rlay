'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set(['state:get', 'obs:running', 'install:run', 'cameras:discover', 'cameras:assign', 'selftest:run', 'maintenance:uninstall', 'maintenance:restore', 'shell:open']);

contextBridge.exposeInMainWorld('dc', {
  async call(channel, payload) {
    if (!CHANNELS.has(channel)) throw new Error('Unbekannter Kanal');
    const r = await ipcRenderer.invoke(channel, payload);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  onProgress(cb) { ipcRenderer.on('progress', (_e, msg) => cb(msg)); },
});
