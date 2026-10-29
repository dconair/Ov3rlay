#!/usr/bin/env python3
"""Smoke-Test: lädt die Szenen-Collection in einem echten OBS (headless unter Xvfb)
und prüft sie über obs-websocket.

Aufruf:  python3 tests/obs_smoke.py [--shots DIR]
Benötigt: obs, xvfb-run, ffmpeg-fähige OBS-Plugins, pip install websocket-client
Die Linux-Variante der Collection ersetzt nur die plattformspezifischen Quellen
(Kamera, Bildschirm, Audio); Szenen, Filter, Übergänge und Hotkeys sind identisch.
"""
import argparse
import base64
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import websocket  # pip install websocket-client

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import build_collection as bc  # noqa: E402

PORT = 4459
EXPECTED_SCENES = ["01 Starting Soon", "02 Kamera iPhone", "03 Kamera Sony", "04 Dual Cam",
                   "05 Screen + Cam", "06 Screen Only", "07 BRB", "08 Ending"]
EXPECTED_TRANSITIONS = ["dc Stinger", "dc Slide", "dc Swipe", "dc Fade Black"]
# Linux hat kein Pulse/V4L2-Gerät im Container; diese Warnungen sind erwartet.
IGNORED_LOG = ("pulse", "v4l2", "dbus", "window manager", "Failed to glob", "libEGL", "MESA")


class Ws:
    def __init__(self):
        self.ws = websocket.create_connection(f"ws://127.0.0.1:{PORT}", timeout=20, subprotocols=["obswebsocket.json"])
        self.ws.recv()  # Hello
        self.ws.send(json.dumps({"op": 1, "d": {"rpcVersion": 1}}))
        self.ws.recv()  # Identified
        self.n = 0

    def call(self, request, data=None):
        self.n += 1
        self.ws.send(json.dumps({"op": 6, "d": {"requestType": request, "requestId": str(self.n),
                                                "requestData": data or {}}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg["op"] == 7 and msg["d"]["requestId"] == str(self.n):
                status = msg["d"]["requestStatus"]
                if not status["result"]:
                    raise RuntimeError(f"{request}: {status.get('comment')}")
                return msg["d"].get("responseData", {})


def prepare_home(home, config):
    assets = home / "dc_onair" / "assets"
    shutil.copytree(ROOT / "payload" / "assets", assets)
    doc = json.dumps(bc.build("linux", move=False), ensure_ascii=False)
    for token in bc.TOKENS:
        doc = doc.replace("{{%s}}" % token, str(assets) if token == "ASSETS" else
                          "DejaVu Sans" if token == "FONT_FACE" else "")
    (config / "basic" / "scenes").mkdir(parents=True)
    (config / "basic" / "profiles" / "dc_onair").mkdir(parents=True)
    scene_file = config / "basic" / "scenes" / "dc_onair.json"
    scene_file.write_text(doc, encoding="utf-8")
    (config / "basic" / "profiles" / "dc_onair" / "basic.ini").write_text(
        "[General]\nName=dc_onair\n[Video]\nBaseCX=1920\nBaseCY=1080\nOutputCX=1920\nOutputCY=1080\n", encoding="utf-8")
    (config / "global.ini").write_text(
        "[General]\nFirstRun=false\n[Basic]\nProfile=dc_onair\nProfileDir=dc_onair\n"
        "SceneCollection=dc_onair\nSceneCollectionFile=dc_onair\n"
        f"[OBSWebSocket]\nFirstLoad=false\nServerEnabled=true\nServerPort={PORT}\nAuthRequired=false\n",
        encoding="utf-8")
    return scene_file


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--shots", type=Path, help="Verzeichnis für Szenen-Screenshots")
    args = parser.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="obs-smoke-"))
    config = tmp / ".config" / "obs-studio"
    scene_file = prepare_home(tmp, config)
    env = {**os.environ, "HOME": str(tmp), "LIBGL_ALWAYS_SOFTWARE": "1", "QT_QPA_PLATFORM": "xcb",
           # CI-Runner setzen XDG_*, dann würde OBS seine Konfiguration nicht unter HOME suchen
           "XDG_CONFIG_HOME": str(tmp / ".config"), "XDG_DATA_HOME": str(tmp / ".local" / "share"),
           "XDG_CACHE_HOME": str(tmp / ".cache")}
    obs = subprocess.Popen(
        ["xvfb-run", "-a", "-s", "-screen 0 1920x1080x24", "obs", "--disable-shutdown-check", "--disable-updater",
         "--collection", "dc_onair", "--profile", "dc_onair"],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    failures = []
    completed = False

    def check(cond, msg):
        print(("ok    " if cond else "FEHLER"), msg)
        if not cond:
            failures.append(msg)

    try:
        ws = None
        for _ in range(60):
            try:
                ws = Ws()
                break
            except OSError:
                time.sleep(1)
        if ws is None:
            raise SystemExit("OBS-WebSocket nicht erreichbar")

        scenes = [s["sceneName"] for s in ws.call("GetSceneList")["scenes"]]
        check(all(n in scenes for n in EXPECTED_SCENES), f"alle 8 Szenen geladen ({len(scenes)} inkl. Hilfsszenen)")
        trans = ws.call("GetSceneTransitionList")
        names = [t["transitionName"] for t in trans["transitions"]]
        check(all(n in names for n in EXPECTED_TRANSITIONS), f"Übergänge vorhanden: {EXPECTED_TRANSITIONS}")
        check(trans["currentSceneTransitionName"] == "dc Stinger", "Standard-Übergang ist dc Stinger")
        inputs = {i["inputName"]: i["inputKind"] for i in ws.call("GetInputList")["inputs"]}
        for name in ("BG Loop", "Logo", "CAM iPhone", "CAM Sony A7 II", "Screen", "Txt LT Name", "Desktop Audio", "Mic/Aux"):
            check(name in inputs, f"Quelle vorhanden: {name}")
        filters = [f["filterName"] for f in ws.call("GetSourceFilterList", {"sourceName": "Mic/Aux"})["filters"]]
        check(filters == ["Rauschunterdrückung", "Verstärkung", "Kompressor", "Limiter"], f"Mic-Filterkette {filters}")
        cam_filters = [f["filterName"] for f in ws.call("GetSourceFilterList", {"sourceName": "CAM Sony A7 II"})["filters"]]
        check(cam_filters == ["Farbkorrektur", "Schärfe"], f"Kamera-Filter {cam_filters}")
        for scene in EXPECTED_SCENES:
            count = len(ws.call("GetSceneItemList", {"sceneName": scene})["sceneItems"])
            check(count >= 2, f"{scene}: {count} Elemente")
        override = ws.call("GetSceneSceneTransitionOverride", {"sceneName": "02 Kamera iPhone"})
        check(override["transitionName"] == "dc Slide", f"Szenen-Override 02: {override}")
        stinger = ws.call("GetCurrentSceneTransition")
        check(stinger["transitionKind"] == "obs_stinger_transition", "Stinger ist vom Typ obs_stinger_transition")

        # Speichern erzwingen, damit OBS die Datei neu schreibt (Rundlauf-Test von Items, Hotkeys, Übergängen)
        ws.call("CreateScene", {"sceneName": "_tmp"})
        ws.call("RemoveScene", {"sceneName": "_tmp"})
        time.sleep(3)
        saved = json.loads(scene_file.read_text(encoding="utf-8"))
        by_name = {s["name"]: s for s in saved["sources"]}
        lower = by_name["_Lower Third"]
        item = lower["settings"]["items"][0]
        check(item.get("show_transition", {}).get("id") == "slide_transition", "Item-Show-Transition bleibt erhalten")
        check(item.get("hide_transition", {}).get("id") == "slide_transition", "Item-Hide-Transition bleibt erhalten")
        check(bool(lower["hotkeys"].get("libobs.show_scene_item.1")), "Lower-Third-Hotkey bleibt erhalten")
        check(bool(by_name["03 Kamera Sony"]["hotkeys"]["OBSBasic.SelectScene"]), "Szenen-Hotkey bleibt erhalten")
        check("DesktopAudioDevice1" in saved and "AuxAudioDevice1" in saved, "Globale Audio-Geräte bleiben erhalten")

        if args.shots:
            args.shots.mkdir(parents=True, exist_ok=True)
            time.sleep(2)
            for scene in EXPECTED_SCENES + ["_Lower Third"]:
                if scene == "_Lower Third":
                    ws.call("SetSceneItemEnabled", {"sceneName": "_Lower Third", "sceneItemId": 1, "sceneItemEnabled": True})
                    time.sleep(2)  # Slide-Animation abwarten
                shot = ws.call("GetSourceScreenshot", {"sourceName": scene, "imageFormat": "png",
                                                       "imageWidth": 960, "imageHeight": 540})
                data = shot["imageData"].split(",", 1)[1]
                (args.shots / f"{scene.replace(' ', '_').replace('+', 'plus')}.png").write_bytes(base64.b64decode(data))
            print("Screenshots in", args.shots)
        completed = True
    finally:
        os.killpg(obs.pid, signal.SIGTERM)  # xvfb-run + OBS beenden
        try:
            log = obs.communicate(timeout=15)[0]
        except subprocess.TimeoutExpired:
            os.killpg(obs.pid, signal.SIGKILL)
            log = obs.communicate()[0]
        if not completed:  # Abbruch: OBS-Log zur Diagnose ausgeben
            print("--- OBS-Log (Ende) ---\n" + "\n".join(log.splitlines()[-60:]))

    bad = [line for line in log.splitlines()
           if line.startswith(("warning", "error")) and not any(k in line for k in IGNORED_LOG)]
    check(not bad, "keine unerwarteten OBS-Warnungen/Fehler" + ("".join("\n    " + b for b in bad[:15])))
    shutil.rmtree(tmp, ignore_errors=True)
    if failures:
        sys.exit(f"{len(failures)} Prüfung(en) fehlgeschlagen")
    print("Alle Prüfungen bestanden")


if __name__ == "__main__":
    main()
