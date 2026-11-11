# dc_onair OBS-Setup

Ein-Klick-Installer, der auf einer frischen OBS-Installation (macOS oder Windows) das komplette dc_onair-Streaming-Setup einrichtet: Szenen, Übergänge, Effekte, Kamera-Quellen, Audio-Filter, Branding und ein passendes Streaming-Profil.

Alles, was noch fehlt (Logo, Schrift, Hintergründe), steckt als Platzhalter drin und lässt sich später einfach austauschen.

## Installer-App (empfohlen)

`dc_onair Setup` ist eine App für Windows und macOS, die diese Einrichtung als Assistent erledigt: OBS finden, sichern, Szenen und Profil installieren, Encoder erkennen, Kameras zuweisen und mit einem Selbsttest jede Szene und jeden Übergang einmal durchschalten. Download, Ablauf und Entwicklung: [docs/APP.md](docs/APP.md). Welcher Übergang zwischen welchen Szenen läuft: [docs/UEBERGAENGE.md](docs/UEBERGAENGE.md).

Die folgende Installation per Skript funktioniert weiterhin als Notlösung ohne App.

## Installation

1. OBS Studio ab Version 30 installieren (<https://obsproject.com>) und einmal starten und wieder schließen.
2. Dieses Paket entpacken (`dc_onair-obs-setup.zip`) oder das Repository klonen.
3. Installer starten:
   - **macOS:** `Install-macOS.command` doppelklicken. Falls macOS das blockiert: Rechtsklick > Öffnen, oder im Terminal `xattr -dr com.apple.quarantine <Paketordner>`.
   - **Windows:** `Install-Windows.bat` doppelklicken. Bei der SmartScreen-Warnung "Weitere Informationen" > "Trotzdem ausführen".
4. Dem Assistenten folgen. Er fragt Plattform (Twitch, YouTube, anderer Dienst), Qualität (1080p60, 1080p30, 720p60) und die Kameras ab. Mit Enter wird jeweils die Empfehlung übernommen.
5. OBS starten. Es öffnet direkt mit der Collection und dem Profil `dc_onair`.

Das Setup ist wiederholbar. Vorhandene Dateien werden vorher nach `…/dc_onair/backups/<Zeitstempel>/` gesichert. Entfernen: Installer mit `--uninstall` (Windows: `-Uninstall`) starten.

Der Stream-Schlüssel wird nicht abgefragt und nicht gespeichert. Konto verbinden oder Schlüssel eintragen unter OBS > Einstellungen > Stream.

## Was eingerichtet wird

Das Design ist flach und bewusst zurückhaltend: Schwarz, Papierweiß, Limette als Akzentfarbe und Orange nur für den Partner und den LIVE-Punkt. Schriften sind Anton (Überschriften) und Space Mono (alles andere). Es gibt keine Verläufe und kein Leuchten, damit bei IRL- und DJ-Streams das Bild im Vordergrund bleibt.

| Szene | Inhalt |
|---|---|
| 01 Starting Soon | Überschrift, Countdown mit rollenden Ziffern, springende Equalizer-Balken, Laufband |
| 02 Kamera iPhone | iPhone vollbild, kleines Logo mit blinkendem LIVE-Zeichen, Laufband |
| 03 Kamera Sony | Sony A7 II vollbild, dasselbe |
| 04 Dual Cam | beide Kameras nebeneinander mit Eckmarken |
| 05 Screen + Cam | Bildschirm mit Sony-Kamera unten rechts |
| 06 Screen Only | nur Bildschirm |
| 07 BRB | Pausenbild mit Countdown "Zurück in" |
| 08 Ending | Abspann |
| 09 Connection Lost | Notfallbild bei Verbindungsabbruch (IRL) |

Hilfsszenen mit `_` am Anfang (Logo/LIVE, Lower Third, Partner, Laufband, Web) sind in allen Szenen eingebunden und werden einmal zentral gepflegt.

**Übergänge:** `dc Stinger` (Standard, harte Farbwische in Limette, Papierweiß und Schwarz mit Logo, 60 fps), `dc Slide`, `dc Swipe`, `dc Fade Black` und der eingebaute `Fade`. Pro Szene:

| Wechsel nach | Übergang |
|---|---|
| 01 Starting, 07 BRB, 08 Ending | `dc Stinger` (Standard) |
| 02 bis 06 (Kamera- und Screen-Szenen) | `dc Slide` (450 ms), mit Move-Plugin `dc Move` (600 ms) |
| 09 Connection Lost | `Fade` (300 ms, eingebaut), damit das Notfallbild sofort greift |

**Bewegung:** blinkender LIVE-Punkt, laufendes Band unten, Streifen im Hintergrund, Equalizer-Balken auf den Titelszenen, rollender Countdown, harte Wisch-Übergänge. Lower Third, Partner-Schild und Laufband fahren per Slide ein und aus. Alerts und Chat haben eigene Animationen (siehe unten).

**Audio:** Desktop-Ton und Mikrofon (`Mic/Aux`) mit Rauschunterdrückung, Verstärkung, Kompressor und Limiter. Kamera-Farbkorrektur und Schärfe sind auf den Kameraquellen eingestellt.

**Fehlt eine Kamera**, zeigt die Szene eine Karte "Kamera nicht verbunden" statt eines schwarzen Bildes.

### Laufband mit Tracklist, laufendem Titel und Ort

Das Band unten liest den Text aus der Datei `ticker.txt` im Ordner der installierten Dateien (macOS: `~/Library/Application Support/dc_onair/assets/`, Windows: `%APPDATA%\dc_onair\assets\`). Datei öffnen, Text ändern, speichern: OBS übernimmt die Änderung selbst. Trenne Abschnitte mit `///` und halte die Zeile zwischen etwa 150 und 300 Zeichen lang. Die Datei wird bei einer Neuinstallation nicht überschrieben.

**Automatisch aus dem DJ-Programm:** Die Kommandozeile hat dafür den Befehl `ticker`. Er schreibt `ticker.txt` bei jedem Titelwechsel neu und führt dabei eine Liste der zuletzt gespielten Titel mit ("NOW PLAYING: ..." und "ZULETZT: ..."). Den laufenden Titel bekommt er von einem kleinen Zusatzprogramm, das dein DJ-Programm ausliest:

```
node cli/dc-onair.js ticker --file "/Pfad/zu/now-playing.txt" --base "LIVE  ///  Berlin"
node cli/dc-onair.js ticker --unbox                      # live von Unbox (ws://localhost:8080/ws)
```

Passende Zusatzprogramme, die ich aus deren Dokumentation kenne (Stand heute, nicht von mir mit echter DJ-Software getestet): [Unbox](https://github.com/erikrichardlarson/unbox) (Rekordbox, Serato, Traktor, VirtualDJ, Mixxx, Denon, djay Pro; liefert den Titel per WebSocket), [What's Now Playing](https://github.com/whatsnowplaying/whats-now-playing) (Serato, Traktor, VirtualDJ, Denon, djay Pro, DJUCED, Mixxx; Rekordbox nur über die Zusatz-App EarShot) und die Textdatei-Ausgabe der App "Now Playing" (nowplayingapp.com). Wichtig: Diese Programme liefern den **laufenden** Titel, aber keine Warteschlange und keine kommende Playlist. Die Liste der zuletzt gespielten Titel baut der Befehl selbst auf. Er braucht Node.js 22 oder neuer.

### Partner-Schild (nur auf Abruf)

Wenn der Partner dabei ist, blendet **Strg+Alt+P** oben rechts ein kleines Schild mit Logo und Name ein, **Strg+Alt+O** blendet es wieder aus. Nach der Installation ist es aus. Es ist bewusst klein gehalten und kein zweiter Stream.

**Partner-Logo:** Mitgeliefert ist nur ein neutraler Platzhalter. Das echte Logo gehört dem Partner und liegt deshalb nicht im Repository. Lege es lokal als `assets/branding/partner_logo.png` in den Ordner der installierten Dateien (siehe oben, Unterordner `branding`). Eine Neuinstallation überschreibt diese Datei nicht. Den Namen änderst du in OBS bei der Textquelle `Txt Partner Name` oder dauerhaft in `brand/brand.json` unter `coop.name` (danach `python3 tools/build.py`).

### Alerts und Chat

Beide sind Browserquellen mit eigenen Seiten unter `assets/web/` (Quellen `Web Alerts` und `Web Chat` in der Hilfsszene `_Web`), transparent und im selben Stil wie der Rest.

- **Alerts im DJ-Thema:** Eine Schallplatte rollt von links ein und dreht auf, dann knallt die Karte mit einem Bass-Schlag rein (das Bild zuckt, Schallwellen-Ringe pulsieren), ein Equalizer springt über der Karte, die Platte scratcht, während der Name getippt wird. Als Zeitanzeige wandert ein Crossfader-Regler von rechts nach links. Zum Schluss rollt die Platte raus und die Karte fährt nach oben weg. Typen: Follower, Abo, Tip, Raid, Bits. Mehrere Alerts laufen nacheinander. Von Hand auslösen: `window.dcAlert({type: "follow", name: "mara_k"})`.
- **Chat:** Nachrichten springen mit kleiner Bewegung ein und gleiten nach einer Weile wieder raus. Moderatoren, VIPs und der Kanalinhaber haben Orange, alle anderen Limette. Der **Twitch-Chat** wird anonym gelesen (nur Lesen, ohne Anmeldung und ohne Token): Kanalname in `assets/web/config.js` bei `twitchChannel` eintragen.
- **Vorschau:** Eine der Seiten (`alerts.html`, `chat.html`) per Doppelklick im Browser öffnen, dort laufen Testdaten. In OBS laufen die Testdaten nur, wenn in `config.js` `demo: true` steht.
- **Noch nicht angebunden:** Echte Alert-Ereignisse (Follower, Abos, Tips) kommen von einem Dienst wie Streamlabs oder StreamElements. Diese Anbindung und Chat-Plattformen außer Twitch sind noch nicht eingebaut. Die Gestaltung und die Animationen stehen, die Schnittstelle `window.dcAlert` ist dafür vorbereitet.

`config.js` bleibt bei einer Neuinstallation erhalten. Trage dort keine geheimen Schlüssel ein, wenn du die Datei teilst.

### Countdown auf "Starting Soon" und "BRB"

Beide Szenen zeigen einen großen Countdown mit rollenden Ziffern und einem Zeitbalken. Er zählt jedes Mal neu, wenn die Szene sichtbar wird (Dauer in `assets/web/config.js`: `startMinutes` und `brbMinutes`, Standard 5 Minuten). Alternativ eine feste Uhrzeit mit `startAt: "21:30"` oder `brbAt`. Bei null erscheint "Gleich geht's los" beziehungsweise "Wir sind gleich wieder da", in den letzten zehn Sekunden pulsieren die Ziffern.

### Optional: weiche Kamerawechsel mit "Move Transition"

Mit dem kostenlosen Plugin [Move Transition](https://obsproject.com/forum/resources/move-transition.913/) bewegen sich die Kameras zwischen den Szenen fließend, zum Beispiel vom Vollbild in die Dual-Cam-Ansicht. Plugin installieren, OBS schließen und den Installer erneut starten. Er erkennt das Plugin und wählt automatisch die passende Variante. Ohne das Plugin funktioniert alles auch, nur mit `dc Slide` statt Move.

### Hotkeys

| Aktion | Taste |
|---|---|
| Szene 1 bis 9 | Strg+Alt+1 bis 9 (macOS: Control+Option) |
| Lower Third ein / aus | Strg+Alt+L / H |
| Partner-Schild ein / aus | Strg+Alt+P / O |
| Laufband ein / aus | Strg+Alt+T / Z |
| Mikrofon stumm | Strg+Alt+M |
| Desktop-Ton stumm | Strg+Alt+D |

Auf macOS muss OBS dafür unter Systemeinstellungen > Datenschutz & Sicherheit die Rechte "Bedienungshilfen" und "Eingabeüberwachung" haben.

## Kameras

### iPhone (kabellos)

Der Installer listet die erkannten Kameras auf, das iPhone muss dafür zum Zeitpunkt des Setups verbunden sein. Sonst später in OBS: Quelle `CAM iPhone` > Eigenschaften > Gerät.

- **macOS:** Continuity Camera (macOS 13 oder neuer, iPhone XR oder neuer, gleiche Apple-ID). Das iPhone erscheint ohne zusätzliche App als Kamera.
- **macOS und Windows:** Apps wie Camo, Iriun Webcam oder EpocCam stellen das iPhone als virtuelle Webcam bereit.
- **NDI:** NDI HX Camera auf dem iPhone plus das Plugin DistroAV in OBS. Dafür die Quelle `CAM iPhone` manuell durch eine NDI-Quelle ersetzen.

**RØDE Capture:** Meines Wissens ist das eine Aufnahme-App für RØDE-Mikrofone und liefert kein Live-Kamerabild an OBS. Für das Bild also eine der Optionen oben nutzen. Ein RØDE-Funkmikrofon (Wireless GO, Wireless ME) arbeitet als normales Audiogerät und wird in OBS als `Mic/Aux` (Eigenschaften > Gerät) ausgewählt.

### Sony A7 II

- **USB als Webcam:** über die Sony-Software Imaging Edge Webcam (vorher prüfen, ob die A7 II in der Kompatibilitätsliste steht).
- **HDMI plus Capture-Karte** (zum Beispiel Elgato Cam Link): die zuverlässigste Variante mit der besten Bildqualität. In der Kamera die Bildschirmanzeigen der HDMI-Ausgabe ausschalten.

Beide Wege erscheinen in OBS als gewöhnliches Videogerät und werden vom Installer erkannt. Namen mit "sony", "ilce", "a7", "cam link" oder "elgato" werden vorausgewählt.

## Eigenes Branding einsetzen

Es reicht, die Dateien unter `payload/assets/` zu ersetzen (gleicher Dateiname) und den Installer erneut zu starten. Die Szenen bleiben unverändert.

| Datei | Zweck |
|---|---|
| `branding/logo.png` | Logo (Platzhalter: Limetten-Quadrat mit "D", einfach durch das eigene Logo ersetzen) |
| `branding/partner_logo.png` | Logo des Partners für das Partner-Schild (Platzhalter, echtes Logo lokal einsetzen, nicht committen) |
| `ticker.txt` | Text des Laufbands (bleibt bei Neuinstallation erhalten) |
| `web/config.js` | Einstellungen für Alerts und Chat (bleibt bei Neuinstallation erhalten) |
| `video/stinger.webm` | Übergangsvideo, VP9 mit Transparenz, Deckungspunkt bei 520 ms |
| `video/bg_loop.mp4` | animierter Hintergrund für Starting, BRB, Ending und Dual Cam |
| `video/live_tag.webm` | LIVE-Zeichen mit blinkendem Punkt |
| `video/eq_bars.webm` | springende Equalizer-Balken auf den Titelszenen |
| `video/eq_bars_gradient.webm` | dieselben Balken mit wanderndem Limette-Orange-Verlauf, nur auf „Gleich geht’s los“ |
| `overlays/frame_cam.png` | Eckmarken um Kamerabilder |
| `overlays/lower_third.png`, `ticker.png`, `partner_plate.png` | Platten für Lower Third, Laufband und Partner-Schild |
| `overlays/cam_offline_*.png` | Karte, wenn eine Kamera fehlt |

**Schrift:** Mitgeliefert sind Anton und Space Mono (SIL Open Font License; Lizenztexte liegen in `payload/assets/fonts/`). Der Installer richtet sie ein und trägt sie in alle Textquellen ein. Eigene Schriften: `.ttf` oder `.otf` in `payload/assets/fonts/` legen, in `brand/brand.json` bei `font.family` (Überschriften) und `font.mono` (Text, Laufband) die Familiennamen eintragen und `python3 tools/build.py` ausführen. Bei leerem Eintrag wird die Systemschrift genutzt (macOS: Helvetica Neue und Menlo, Windows: Segoe UI und Consolas).

**Texte:** in OBS die Textquellen `Txt …` bearbeiten, oder dauerhaft in `brand/brand.json` ändern und neu bauen.

**Farben und Platzhalter komplett neu erzeugen:** Farben in `brand/brand.json` ändern, dann `python3 tools/build.py --assets` (braucht Python, Pillow, numpy und ffmpeg).

## Für Entwickler

```
brand/brand.json        Name, Farben, Texte, Kameras
tools/build.py          erzeugt payload/ (Szenen-Collections, optional Assets)
payload/                alles, was der Installer verwendet (eingecheckt)
installer/install.sh    macOS-Assistent (bash 3.2 kompatibel)
installer/install.ps1   Windows-Assistent (Windows PowerShell 5.1)
tests/                  Tests
tools/package.sh        baut dist/dc_onair-obs-setup.zip
```

Nach Änderungen an `brand/brand.json` oder `tools/build_collection.py` immer `python3 tools/build.py` ausführen und das Ergebnis einchecken, die Tests prüfen das.

Tests:

```
python3 -m unittest discover -s tests -v      # Struktur der Collections
python3 tests/obs_smoke.py --shots shots       # lädt die Collection in ein echtes OBS (Linux, Xvfb) und speichert Screenshots
bash tests/test_installer_macos.sh             # Installer-Ablauf mit Dummy-Ordnern
pwsh tests/test_installer_windows.ps1
```

Die CI führt alles aus, auf macOS und Windows auch die Installer auf echten Runnern.

### Technischer Hintergrund

- Die Szenen-Collection ist eine OBS-JSON-Datei mit Platzhaltern (`{{ASSETS}}`, Kamera-IDs, Schrift). Der Installer füllt sie pro Rechner. Je Betriebssystem gibt es eine eigene Datei, weil Kamera-, Bildschirm- und Audio-Quellen unterschiedliche Typen haben.
- Der Installer schreibt nur in das OBS-Konfigurationsverzeichnis (`~/Library/Application Support/obs-studio` bzw. `%APPDATA%\obs-studio`) und in einen eigenen Ordner `dc_onair` daneben. Es werden keine Administratorrechte benötigt.
- Getestet wurde das Laden der Collection in OBS 30.0.2 (Linux, Xvfb). Die Quellentypen für macOS (`av_capture_input`, `screen_capture`, `sck_audio_capture`) und Windows (`dshow_input`, `monitor_capture`, `wasapi_*`) folgen der OBS-Dokumentation, konnten aber nicht auf echter Hardware geprüft werden. Falls eine Kamera nach dem Setup schwarz bleibt, in den Quelleneigenschaften das Gerät einmal neu wählen.
