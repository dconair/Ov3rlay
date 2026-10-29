#!/bin/bash
# Testet den macOS-Installer auf beliebigen Systemen mit Dummy-Verzeichnissen (ohne echtes OBS).
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/dc_onair_test.XXXXXX")"
trap 'rm -rf "$T"' EXIT
fails=0
check() { if eval "$2"; then echo "ok     $1"; else echo "FEHLER $1"; fails=$((fails + 1)); fi; }

export DC_SKIP_OBS_CHECK=1 DC_OBS_CONFIG="$T/Library/obs studio" DC_APP_DIR="$T/Library/dc \"onair\"" \
       DC_FONT_DIR="$T/Fonts" DC_REC_DIR="$T/Movies" HOME="$T"
export DC_FAKE_CAMERAS='UID-IPHONE\tiPhone von "Max"\nUID-SONY\tSony ILCE-7M2\nUID-FACE\tFaceTime HD Kamera'

# Bestehende OBS-Konfiguration, die erhalten bleiben muss
mkdir -p "$DC_OBS_CONFIG"
printf '[General]\nFirstRun=true\n\n[Basic]\nProfile=Alt\nProfileDir=Alt\nSceneCollection=Alt\nSceneCollectionFile=Alt\n\n[Video]\nRenderer=OpenGL\n' > "$DC_OBS_CONFIG/global.ini"

bash "$ROOT/installer/install.sh" --yes --platform twitch --quality 1080p60 > "$T/out.txt"

SC="$DC_OBS_CONFIG/basic/scenes/dc_onair.json"
check "Szenen-Datei ist gültiges JSON" "python3 -c 'import json,sys; json.load(open(sys.argv[1]))' '$SC'"
check "keine ungefüllten Platzhalter in Szenen" "! grep -q '{{' '$SC'"
check "Assets kopiert" "[ -f '$DC_APP_DIR/assets/video/stinger.webm' ]"
check "Asset-Pfad (mit Anführungszeichen) korrekt escaped" "python3 -c \"import json,sys; d=json.load(open(sys.argv[1])); t=[t for t in d['transitions'] if t['name']=='dc Stinger'][0]; import os; assert os.path.isfile(t['settings']['path']), t['settings']['path']\" '$SC'"
check "iPhone-ID gebunden (Name mit Anführungszeichen)" "python3 -c \"import json,sys; d=json.load(open(sys.argv[1])); s={x['name']:x for x in d['sources']}['CAM iPhone']['settings']; assert s['device']=='UID-IPHONE' and s['device_name']=='iPhone von \\\"Max\\\"', s\" '$SC'"
check "Sony-ID gebunden" "grep -q 'UID-SONY' '$SC'"
check "Standard-Variante ohne Move-Transition" "! grep -q move_transition '$SC'"
P="$DC_OBS_CONFIG/basic/profiles/dc_onair"
check "Profil: Bitrate Twitch 1080p60" "grep -q '^VBitrate=6000' '$P/basic.ini' && grep -q '^FPSCommon=60' '$P/basic.ini'"
check "Profil: Aufnahmepfad" "grep -q '^FilePath=$T/Movies' '$P/basic.ini'"
check "Profil: Twitch-Dienst, kein Schlüssel" "grep -q Twitch '$P/service.json' && grep -q '\"key\": \"\"' '$P/service.json'"
check "global.ini aktiviert dc_onair" "grep -q '^SceneCollection=dc_onair' '$DC_OBS_CONFIG/global.ini' && grep -q '^Profile=dc_onair' '$DC_OBS_CONFIG/global.ini'"
check "global.ini: übrige Einstellungen erhalten" "grep -q '^Renderer=OpenGL' '$DC_OBS_CONFIG/global.ini' && [ \"\$(grep -c '^\[Basic\]' '$DC_OBS_CONFIG/global.ini')\" = 1 ]"
check "global.ini gesichert" "ls '$DC_APP_DIR'/backups/*/global.ini >/dev/null"

# Zweiter Lauf: idempotent, Move-Plugin erkannt, Schrift installiert
mkdir -p "$DC_OBS_CONFIG/plugins/move-transition"
cp "$ROOT/payload/assets/branding/logo.png" "$ROOT/payload/assets/fonts/TestFont.ttf"
trap 'rm -f "$ROOT/payload/assets/fonts/TestFont.ttf"; rm -rf "$T"' EXIT
bash "$ROOT/installer/install.sh" --yes --platform youtube --quality 720p60 > "$T/out2.txt"
check "2. Lauf: Move-Variante gewählt" "grep -q move_transition '$SC' && grep -q 'dc Move' '$SC'"
check "2. Lauf: YouTube-Profil 720p60" "grep -q '^OutputCY=720' '$P/basic.ini' && grep -q YouTube '$P/service.json'"
check "2. Lauf: Schrift installiert" "[ -f '$DC_FONT_DIR/TestFont.ttf' ]"
check "2. Lauf: vorhandene Szenen gesichert" "ls '$DC_APP_DIR'/backups/*/dc_onair.json >/dev/null"

bash "$ROOT/installer/install.sh" --yes --uninstall > "$T/out3.txt"
check "Deinstallation entfernt Szenen, Profil, Assets" "[ ! -e '$SC' ] && [ ! -e '$P' ] && [ ! -e '$DC_APP_DIR/assets' ]"
check "Deinstallation setzt OBS auf Standard zurück" "grep -q '^SceneCollection=Untitled' '$DC_OBS_CONFIG/global.ini'"

if [ "$fails" = 0 ]; then echo "Alle Prüfungen bestanden"; else echo "$fails Prüfung(en) fehlgeschlagen"; exit 1; fi
