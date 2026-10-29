#!/bin/bash
# dc_onair OBS-Setup für macOS: richtet Szenen, Übergänge, Profil und Assets in OBS ein.
# Aufruf: Install-macOS.command (Doppelklick) oder  bash installer/install.sh [--yes] [--uninstall]
# Läuft mit der bash 3.2 von macOS, daher bewusst ohne neuere Bash-Features.
set -eo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAYLOAD="$PKG_DIR/payload"

# Überschreibbar für Tests
OBS_APP="${DC_OBS_APP:-/Applications/OBS.app}"
OBS_CONFIG="${DC_OBS_CONFIG:-$HOME/Library/Application Support/obs-studio}"
APP_DIR="${DC_APP_DIR:-$HOME/Library/Application Support/dc_onair}"
FONT_DIR="${DC_FONT_DIR:-$HOME/Library/Fonts}"
REC_DIR="${DC_REC_DIR:-$HOME/Movies}"

ASSUME_YES=0
UNINSTALL=0
PLATFORM=""
QUALITY=""

# --- Ausgabe ----------------------------------------------------------------
if [ -t 1 ]; then
  B=$(tput bold 2>/dev/null || true); R=$(tput sgr0 2>/dev/null || true)
  G=$(tput setaf 2 2>/dev/null || true); Y=$(tput setaf 3 2>/dev/null || true); E=$(tput setaf 1 2>/dev/null || true)
fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$R" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$R" "$*"; }
die()  { printf '\n%sFehler:%s %s\n' "$E" "$R" "$*" >&2; exit 1; }
step() { printf '\n%s%s%s\n' "$B" "$*" "$R"; }

usage() {
  cat <<EOF
dc_onair OBS-Setup

  --yes, -y              Alle Fragen mit der Empfehlung beantworten
  --platform NAME        twitch | youtube | custom
  --quality NAME         1080p60 | 1080p30 | 720p60
  --uninstall            Szenen, Profil und Assets von dc_onair wieder entfernen
  --help                 Diese Hilfe
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --platform) PLATFORM="$2"; shift ;;
    --quality) QUALITY="$2"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage; die "Unbekannte Option: $1" ;;
  esac
  shift
done

# --- Eingabe ----------------------------------------------------------------
ask() { # ask "Frage" "Standard" -> Antwort in $REPLY_VALUE
  if [ "$ASSUME_YES" = 1 ]; then REPLY_VALUE="$2"; return; fi
  printf '  %s [%s]: ' "$1" "$2"
  read -r REPLY_VALUE || REPLY_VALUE=""
  [ -n "$REPLY_VALUE" ] || REPLY_VALUE="$2"
}

ask_yes() { # ask_yes "Frage" j|n  -> Rückgabe 0 bei Ja
  ask "$1 (j/n)" "$2"
  case "$REPLY_VALUE" in j|J|ja|Ja|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

wait_enter() {
  [ "$ASSUME_YES" = 1 ] && return 0
  printf '  Weiter mit Enter ...'; read -r _ || true
}

# --- Hilfsfunktionen -------------------------------------------------------------
brand_value() { grep -E "^$1=" "$PAYLOAD/brand.env" | head -n1 | cut -d= -f2-; }

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# render <Vorlage> <Ziel>: ersetzt {{NAME}} durch $T_NAME (Namen in $TOKEN_NAMES), ohne Escape-Probleme
render() {
  DC_TOKEN_NAMES="$TOKEN_NAMES" awk '
    BEGIN { n = split(ENVIRON["DC_TOKEN_NAMES"], names, " ") }
    { line = $0
      for (i = 1; i <= n; i++) {
        key = "{{" names[i] "}}"; val = ENVIRON["T_" names[i]]; out = ""
        while ((p = index(line, key)) > 0) { out = out substr(line, 1, p - 1) val; line = substr(line, p + length(key)) }
        line = out line
      }
      print line }' "$1" > "$2"
}

# ini_set <Datei> <Abschnitt> <Schlüssel> <Wert>
ini_set() {
  local f="$1" tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/dc_onair.XXXXXX")
  [ -f "$f" ] || : > "$f"
  awk -v sec="$2" -v key="$3" -v val="$4" '
    BEGIN { insec = 0; done = 0; seen = 0 }
    /^\[/ { if (insec && !done) { print key "=" val; done = 1 } insec = ($0 == "[" sec "]"); if (insec) seen = 1 }
    insec && index($0, key "=") == 1 { print key "=" val; done = 1; next }
    { print }
    END { if (!seen) { print ""; print "[" sec "]"; print key "=" val } else if (insec && !done) print key "=" val }
  ' "$f" > "$tmp"
  cat "$tmp" > "$f"; rm -f "$tmp"
}

backup() { # backup <Pfad>: Kopie unter APP_DIR/backups/<Zeitstempel>/
  [ -e "$1" ] || return 0
  mkdir -p "$BACKUP_DIR"
  cp -R "$1" "$BACKUP_DIR/$(basename "$1")"
  BACKED_UP=1
}

obs_version() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$OBS_APP/Contents/Info.plist" 2>/dev/null || echo ""
}

obs_running() { pgrep -xi obs >/dev/null 2>&1; }

move_plugin_installed() {
  local dir f
  for dir in "$OBS_CONFIG/plugins" "/Library/Application Support/obs-studio/plugins"; do
    for f in "$dir"/*[Mm]ove*[Tt]ransition*; do [ -e "$f" ] && return 0; done
  done
  return 1
}

# Kameras als "ID<TAB>Name"-Zeilen
list_cameras() {
  if [ -n "${DC_FAKE_CAMERAS:-}" ]; then printf '%b\n' "$DC_FAKE_CAMERAS"; return; fi
  command -v system_profiler >/dev/null 2>&1 || return 0
  system_profiler SPCameraDataType -json 2>/dev/null | osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run() {
      var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
      var text = $.NSString.alloc.initWithDataEncoding(data, 4).js;
      return JSON.parse(text).SPCameraDataType.map(function (c) {
        return c["spcamera_unique-id"] + "\t" + c["_name"];
      }).join("\n");
    }' 2>/dev/null || true
}

CAM_COUNT=0
CAM_IDS=()
CAM_NAMES=()

load_cameras() {
  local id name
  while IFS=$'\t' read -r id name; do
    [ -n "$id" ] || continue
    CAM_IDS[CAM_COUNT]="$id"; CAM_NAMES[CAM_COUNT]="$name"; CAM_COUNT=$((CAM_COUNT + 1))
  done <<EOF
$(list_cameras)
EOF
}

# pick_camera <Bezeichnung> <Regex für Vorauswahl> -> setzt PICK_ID / PICK_NAME
pick_camera() {
  local label="$1" pattern="$2" i guess=0
  PICK_ID=""; PICK_NAME=""
  [ "$CAM_COUNT" -gt 0 ] || return 0
  i=0
  while [ "$i" -lt "$CAM_COUNT" ]; do
    if [ "$guess" = 0 ] && printf '%s' "${CAM_NAMES[$i]}" | grep -Eqi "$pattern"; then guess=$((i + 1)); fi
    i=$((i + 1))
  done
  ask "$label: Nummer wählen, 0 = später in OBS auswählen" "$guess"
  case "$REPLY_VALUE" in ''|*[!0-9]*) REPLY_VALUE=0 ;; esac
  if [ "$REPLY_VALUE" -ge 1 ] && [ "$REPLY_VALUE" -le "$CAM_COUNT" ]; then
    PICK_ID="${CAM_IDS[$((REPLY_VALUE - 1))]}"; PICK_NAME="${CAM_NAMES[$((REPLY_VALUE - 1))]}"
    ok "$label: $PICK_NAME"
  else
    say "  $label: wird später in OBS ausgewählt"
  fi
}

# --- Ablauf -----------------------------------------------------------------------
[ -d "$PAYLOAD" ] || die "Ordner 'payload' nicht gefunden. Bitte das gesamte Paket entpacken."
COLLECTION="$(brand_value COLLECTION)"
BRAND_NAME="$(brand_value NAME)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$APP_DIR/backups/$STAMP"
BACKED_UP=0
TOKEN_NAMES="ASSETS FONT_FACE CAM_IPHONE_ID CAM_IPHONE_NAME CAM_SONY_ID CAM_SONY_NAME"

say "${B}$BRAND_NAME OBS-Setup${R}"
say "Richtet Szenen, Übergänge, Effekte und ein Streaming-Profil in OBS ein."

step "1/5  OBS prüfen"
if [ -z "${DC_SKIP_OBS_CHECK:-}" ]; then
  [ -d "$OBS_APP" ] || die "OBS wurde nicht gefunden ($OBS_APP). Bitte zuerst OBS von https://obsproject.com installieren."
  VERSION="$(obs_version)"
  ok "OBS ${VERSION:-unbekannte Version} gefunden"
  case "$VERSION" in
    '') ;;
    [0-9].*|1[0-9].*|2[0-9].*) warn "Diese OBS-Version ist älter als 30. Szenen laden, aber der Desktop-Ton benötigt OBS 30 und macOS 13." ;;
  esac
  while obs_running; do
    warn "OBS läuft noch. Bitte OBS beenden, sonst überschreibt es die neuen Einstellungen."
    [ "$ASSUME_YES" = 1 ] && die "OBS ist geöffnet."
    wait_enter
  done
fi
mkdir -p "$OBS_CONFIG/basic/scenes" "$OBS_CONFIG/basic/profiles"

if [ "$UNINSTALL" = 1 ]; then
  step "Entfernen"
  backup "$OBS_CONFIG/basic/scenes/$COLLECTION.json"
  rm -f "$OBS_CONFIG/basic/scenes/$COLLECTION.json"
  rm -rf "$OBS_CONFIG/basic/profiles/$COLLECTION" "$APP_DIR/assets"
  for f in "$OBS_CONFIG/global.ini" "$OBS_CONFIG/user.ini"; do
    [ -f "$f" ] || continue
    for key in Profile ProfileDir SceneCollection SceneCollectionFile; do ini_set "$f" Basic "$key" "Untitled"; done
  done
  ok "$BRAND_NAME wurde aus OBS entfernt. Sicherungen liegen unter $APP_DIR/backups"
  exit 0
fi

step "2/5  Streaming-Einstellungen"
if [ -z "$PLATFORM" ]; then
  say "  1 = Twitch   2 = YouTube   3 = Anderer Dienst (Server und Schlüssel später in OBS)"
  ask "Plattform" "1"
  case "$REPLY_VALUE" in 2) PLATFORM=youtube ;; 3) PLATFORM=custom ;; *) PLATFORM=twitch ;; esac
fi
if [ -z "$QUALITY" ]; then
  say "  1 = 1080p60   2 = 1080p30   3 = 720p60"
  ask "Qualität" "1"
  case "$REPLY_VALUE" in 2) QUALITY=1080p30 ;; 3) QUALITY=720p60 ;; *) QUALITY=1080p60 ;; esac
fi
case "$PLATFORM" in twitch|youtube|custom) ;; *) die "Plattform '$PLATFORM' unbekannt" ;; esac
# Bitraten nach den Empfehlungen von Twitch bzw. YouTube (kbit/s)
case "$QUALITY" in
  1080p60) OUT_W=1920; OUT_H=1080; FPS=60; BITRATE=9000; [ "$PLATFORM" != twitch ] || BITRATE=6000 ;;
  1080p30) OUT_W=1920; OUT_H=1080; FPS=30; BITRATE=6000; [ "$PLATFORM" != twitch ] || BITRATE=4500 ;;
  720p60)  OUT_W=1280; OUT_H=720;  FPS=60; BITRATE=6000; [ "$PLATFORM" != twitch ] || BITRATE=4500 ;;
  *) die "Qualität '$QUALITY' unbekannt" ;;
esac
ok "$PLATFORM, $QUALITY, $BITRATE kbit/s"

step "3/5  Kameras"
load_cameras
if [ "$CAM_COUNT" -gt 0 ]; then
  i=0; while [ "$i" -lt "$CAM_COUNT" ]; do say "  $((i + 1)) = ${CAM_NAMES[$i]}"; i=$((i + 1)); done
else
  warn "Keine Kamera erkannt. iPhone und Sony werden später in OBS ausgewählt (Rechtsklick auf die Quelle, Eigenschaften)."
fi
pick_camera "iPhone (kabellos über Continuity Camera, Camo, Iriun o. ä.)" "iphone|camo|iriun|epoccam"
IPHONE_ID="$PICK_ID"; IPHONE_NAME="$PICK_NAME"
pick_camera "Sony A7 II (USB-Webcam-Modus oder Capture-Karte)" "sony|ilce|a7|imaging edge|capture|cam link|elgato"
SONY_ID="$PICK_ID"; SONY_NAME="$PICK_NAME"

step "4/5  Installieren"
VARIANT="macos"
if move_plugin_installed; then VARIANT="macos.move"; ok "Plugin 'Move Transition' erkannt, fließende Kamerawechsel aktiv"; fi

mkdir -p "$APP_DIR"
backup "$APP_DIR/assets"
rm -rf "$APP_DIR/assets"
cp -R "$PAYLOAD/assets" "$APP_DIR/assets"
rm -f "$APP_DIR/assets/fonts/HIER_SCHRIFTEN_ABLEGEN.txt"
ok "Grafiken und Videos nach $APP_DIR/assets kopiert"

FONT_FACE="Helvetica Neue"
FONT_FILES="$(find "$APP_DIR/assets/fonts" -type f \( -iname '*.ttf' -o -iname '*.otf' \) 2>/dev/null || true)"
if [ -n "$FONT_FILES" ]; then
  mkdir -p "$FONT_DIR"
  printf '%s\n' "$FONT_FILES" | while IFS= read -r font; do cp "$font" "$FONT_DIR/"; done
  [ -z "$(brand_value FONT_FAMILY)" ] || FONT_FACE="$(brand_value FONT_FAMILY)"
  ok "Markenschrift installiert: $FONT_FACE"
fi

export T_ASSETS T_FONT_FACE T_CAM_IPHONE_ID T_CAM_IPHONE_NAME T_CAM_SONY_ID T_CAM_SONY_NAME
T_ASSETS="$(json_escape "$APP_DIR/assets")"; T_FONT_FACE="$(json_escape "$FONT_FACE")"
T_CAM_IPHONE_ID="$(json_escape "$IPHONE_ID")"; T_CAM_IPHONE_NAME="$(json_escape "$IPHONE_NAME")"
T_CAM_SONY_ID="$(json_escape "$SONY_ID")"; T_CAM_SONY_NAME="$(json_escape "$SONY_NAME")"

SCENE_FILE="$OBS_CONFIG/basic/scenes/$COLLECTION.json"
backup "$SCENE_FILE"
render "$PAYLOAD/scenes/$COLLECTION.$VARIANT.json" "$SCENE_FILE"
ok "Szenen-Collection '$COLLECTION' installiert"

PROFILE_DIR="$OBS_CONFIG/basic/profiles/$COLLECTION"
backup "$PROFILE_DIR"
mkdir -p "$PROFILE_DIR"
TOKEN_NAMES="OUT_W OUT_H FPS BITRATE REC_PATH NAME"
export T_OUT_W="$OUT_W" T_OUT_H="$OUT_H" T_FPS="$FPS" T_BITRATE="$BITRATE" T_REC_PATH="$REC_DIR" T_NAME="$COLLECTION"
render "$PAYLOAD/profile/basic.ini.tmpl" "$PROFILE_DIR/basic.ini"
cp "$PAYLOAD/profile/service.$PLATFORM.json" "$PROFILE_DIR/service.json"
ok "Profil '$COLLECTION' ($QUALITY, Aufnahmen in $REC_DIR) angelegt"

for f in "$OBS_CONFIG/global.ini" "$OBS_CONFIG/user.ini"; do
  [ "$f" = "$OBS_CONFIG/global.ini" ] || [ -f "$f" ] || continue
  if [ -f "$f" ]; then backup "$f"; else ini_set "$f" General FirstRun true; fi
  ini_set "$f" Basic Profile "$COLLECTION"
  ini_set "$f" Basic ProfileDir "$COLLECTION"
  ini_set "$f" Basic SceneCollection "$COLLECTION"
  ini_set "$f" Basic SceneCollectionFile "$COLLECTION"
done
ok "OBS startet künftig mit $COLLECTION"
[ "$BACKED_UP" = 0 ] || say "  Vorherige Dateien gesichert unter $BACKUP_DIR"

step "5/5  Fertig"
if [ "$VARIANT" = "macos" ] && [ "$ASSUME_YES" = 0 ]; then
  if ask_yes "Plugin 'Move Transition' (weiche Kamerawechsel) jetzt herunterladen? Danach dieses Setup erneut starten" n; then
    open "https://obsproject.com/forum/resources/move-transition.913/" 2>/dev/null || true
  fi
fi
cat <<EOF

${B}Noch zu tun in OBS:${R}
  1. Einstellungen > Stream: Konto verbinden bzw. Stream-Schlüssel eintragen (wird nicht gespeichert).
  2. macOS fragt beim ersten Start nach Kamera, Mikrofon und Bildschirmaufnahme: erlauben
     (Systemeinstellungen > Datenschutz & Sicherheit).
  3. Kameras prüfen: Quellen 'CAM iPhone' und 'CAM Sony A7 II' > Eigenschaften > Gerät wählen.
  4. Eigenes Logo, Schrift, Hintergründe: siehe README.

Szenen-Hotkeys: Strg+Alt+1 bis 8, Lower Third Strg+Alt+L (an) / H (aus), Mikro stumm Strg+Alt+M
EOF
if [ "$ASSUME_YES" = 0 ] && [ -z "${DC_SKIP_OBS_CHECK:-}" ]; then
  if ask_yes "OBS jetzt starten?" j; then open -a "$OBS_APP" || true; fi
fi
