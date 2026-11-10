'use strict';
// Encoder-Erkennung: wählt anhand der Grafikkarte den passenden Hardware-Encoder, sonst x264.
// Die Werte entsprechen den Kennungen des einfachen Ausgabemodus von OBS (basic.ini, SimpleOutput/StreamEncoder).
const { run } = require('./util');

const ENCODERS = {
  nvenc: { id: 'nvenc', obsValue: 'nvenc', label: 'NVIDIA NVENC (Hardware)' },
  amd: { id: 'amd', obsValue: 'amd', label: 'AMD AMF (Hardware)' },
  qsv: { id: 'qsv', obsValue: 'qsv', label: 'Intel Quick Sync (Hardware)' },
  apple: { id: 'apple', obsValue: 'apple_h264', label: 'Apple VideoToolbox (Hardware)' },
  x264: { id: 'x264', obsValue: 'x264', label: 'x264 (Software, läuft überall)' },
};

/** Namen der Grafikkarten lesen. */
async function detectGpus(platform, { exec = run } = {}) {
  if (platform === 'windows') {
    const r = await exec('powershell.exe', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }"]);
    return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  if (platform === 'macos') {
    const r = await exec('system_profiler', ['SPDisplaysDataType', '-json']);
    try {
      return (JSON.parse(r.stdout).SPDisplaysDataType || []).map((g) => g.sppci_model || g._name).filter(Boolean);
    } catch { return []; }
  }
  const r = await exec('sh', ['-c', "lspci 2>/dev/null | grep -Ei 'vga|3d|display' || true"]);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * Wählt den Encoder. NVIDIA vor AMD vor Intel (dedizierte Karte schlägt integrierte Grafik).
 * Auf dem Mac immer VideoToolbox. Ohne Treffer x264.
 */
function pickEncoder(platform, gpus) {
  if (platform === 'macos') return { ...ENCODERS.apple, gpus };
  const text = gpus.join('\n');
  if (/nvidia|geforce|quadro|rtx|gtx/i.test(text)) return { ...ENCODERS.nvenc, gpus };
  if (/\bamd\b|radeon|\bati\b/i.test(text)) return { ...ENCODERS.amd, gpus };
  if (/intel/i.test(text)) return { ...ENCODERS.qsv, gpus };
  return { ...ENCODERS.x264, gpus };
}

async function detectEncoder(platform, opts) { return pickEncoder(platform, await detectGpus(platform, opts)); }

const encoderById = (id) => ENCODERS[id] || ENCODERS.x264;

module.exports = { ENCODERS, detectGpus, pickEncoder, detectEncoder, encoderById };
