'use strict';
// Kameras: Rollen der Szenen-Collection, Geräteliste des Betriebssystems und exakte Zuordnung über OBS selbst.
const fs = require('node:fs');
const { run } = require('./util');

/** Kamera-Rollen. `key` entspricht den Platzhaltern CAM_<KEY>_ID / CAM_<KEY>_NAME in der Collection. */
const ROLES = [
  { key: 'iphone', label: 'iPhone', input: 'CAM iPhone', hint: 'Continuity Camera, Camo, Iriun oder EpocCam', pattern: /iphone|camo|iriun|epoccam|continuity/i },
  { key: 'sony', label: 'Sony A7 II', input: 'CAM Sony A7 II', hint: 'USB-Webcam-Modus oder Capture-Karte (z. B. Cam Link)', pattern: /sony|ilce|a7|imaging edge|cam link|elgato|capture/i },
];

/** OBS-Quellentyp und Eigenschaftsname, über die OBS die Geräteliste liefert. */
const CAMERA_KINDS = {
  dshow_input: { property: 'video_device_id', settings: (id) => ({ video_device_id: id, last_video_device_id: id, res_type: 0 }) },
  av_capture_input: { property: 'device', settings: (id, name) => ({ device: id, device_name: name }) },
  v4l2_input: { property: 'device_id', settings: (id) => ({ device_id: id }) },
};

/** Geräte laut Betriebssystem als [{ id, name }]. Auf Windows ist die id vorläufig "Name:" (OBS ergänzt den Pfad beim Zuweisen). */
async function listSystemCameras(platform, { exec = run, env = process.env } = {}) {
  if (env.DC_FAKE_CAMERAS) {
    return env.DC_FAKE_CAMERAS.split('|').map((n) => ({ id: platform === 'windows' ? `${n}:` : n, name: n }));
  }
  if (platform === 'macos') {
    const r = await exec('system_profiler', ['SPCameraDataType', '-json']);
    try {
      return (JSON.parse(r.stdout).SPCameraDataType || []).map((c) => ({ id: c['spcamera_unique-id'], name: c._name }));
    } catch { return []; }
  }
  if (platform === 'windows') {
    // PnP-Kameras plus DirectShow-Filter (virtuelle Kameras wie Camo oder Iriun erscheinen nur dort)
    const script = [
      "$n = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Class -in 'Camera','Image' -and $_.FriendlyName } | ForEach-Object { $_.FriendlyName })",
      "$k = 'HKLM:\\SOFTWARE\\Classes\\CLSID\\{860BB310-5D01-11d0-BD3B-00A0C911CE86}\\Instance'",
      "if (Test-Path $k) { $n += @(Get-ChildItem $k | ForEach-Object { (Get-ItemProperty $_.PSPath).FriendlyName }) }",
      "$n | Where-Object { $_ } | Sort-Object -Unique",
    ].join('; ');
    const r = await exec('powershell.exe', ['-NoProfile', '-Command', script]);
    return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((n) => ({ id: `${n}:`, name: n }));
  }
  try {
    return fs.readdirSync('/sys/class/video4linux').filter((d) => d.startsWith('video')).map((d) => ({
      id: `/dev/${d}`, name: fs.readFileSync(`/sys/class/video4linux/${d}/name`, 'utf8').trim() }));
  } catch { return []; }
}

/** Beste Vermutung für eine Rolle (oder undefined). Jedes Gerät wird nur einmal vorgeschlagen. */
function guessCamera(role, cameras, taken = []) {
  return cameras.find((c) => role.pattern.test(c.name) && !taken.includes(c.id));
}

/** Kamera-Eingänge einer geladenen Collection (Quellen mit Kamera-Typ). */
const cameraInputs = (doc) => doc.sources.filter((s) => CAMERA_KINDS[s.id]).map((s) => ({ name: s.name, kind: s.id }));

/** Eingang zu einer Rolle: Name enthält das Rollen-Label. */
const inputForRole = (role, inputs) => inputs.find((i) => i.name === role.input) || inputs.find((i) => i.name.toLowerCase().includes(role.label.toLowerCase()));

/**
 * Fragt OBS nach den Geräten, die es für den Eingang selbst sieht (exakte IDs inkl. Pfad).
 * Rückgabe: [{ id, name }]
 */
async function listObsDevices(ws, input) {
  const spec = CAMERA_KINDS[input.kind];
  const r = await ws.call('GetInputPropertiesListPropertyItems', { inputName: input.name, propertyName: spec.property });
  return (r.propertyItems || []).filter((i) => i.itemValue).map((i) => ({ id: i.itemValue, name: i.itemName }));
}

/** Weist einem Eingang ein Gerät zu. */
async function assignCamera(ws, input, device) {
  await ws.call('SetInputSettings', { inputName: input.name, inputSettings: CAMERA_KINDS[input.kind].settings(device.id, device.name), overlay: true });
}

module.exports = { ROLES, CAMERA_KINDS, listSystemCameras, guessCamera, cameraInputs, inputForRole, listObsDevices, assignCamera };
