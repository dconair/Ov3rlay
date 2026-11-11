#!/bin/bash
# Smoke-Test der gebauten dmg: Signatur, Architekturen, gepackte CLI (Electron als Node) gegen Dummy-Ordner.
set -euo pipefail
DMG="$(ls dist/dc_onair-Setup-*-macos.dmg | head -n1)"
echo "dmg: $DMG ($(du -h "$DMG" | cut -f1))"
MNT="$(mktemp -d)"
hdiutil attach "$DMG" -mountpoint "$MNT" -nobrowse -quiet
trap 'hdiutil detach "$MNT" -quiet || true' EXIT
APP="$MNT/dc_onair Setup.app"
BIN="$APP/Contents/MacOS/dc_onair Setup"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E "Signature|Identifier|Format" || true
codesign --verify --deep --strict "$APP"
echo "Architekturen: $(lipo -archs "$BIN")"
lipo -archs "$BIN" | grep -q arm64 && lipo -archs "$BIN" | grep -q x86_64
RES="$APP/Contents/Resources"
for f in payload/brand.env payload/assets/video/stinger.webm payload/scenes/dc_onair.macos.json app.asar; do [ -e "$RES/$f" ] || { echo "fehlt im Paket: $f"; exit 1; }; done

T="$(mktemp -d)"
export DC_OBS_CONFIG="$T/OBS Studio" DC_APP_DIR="$T/dc onair" DC_FONT_DIR="$T/Fonts" DC_REC_DIR="$T/Movies" ELECTRON_RUN_AS_NODE=1
cli() { "$BIN" "$RES/app.asar/cli/dc-onair.js" "$@" --payload "$RES/payload"; }
cli status; cli encoder; cli cameras; cli matrix >/dev/null
cli install --service twitch --quality 1080p60
SC="$DC_OBS_CONFIG/basic/scenes/dc_onair.json"
! grep -q '{{' "$SC"
python3 - "$SC" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1]))
p = [t for t in d["transitions"] if t["id"] == "obs_stinger_transition"][0]["settings"]["path"]
assert os.path.isfile(p), p
PY
grep -q '^StreamEncoder=apple_h264' "$DC_OBS_CONFIG/basic/profiles/dc_onair/basic.ini"
cli uninstall
[ ! -e "$SC" ]
echo "Smoke-Test bestanden"
