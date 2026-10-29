# dc_onair OBS-Setup

Ein-Klick-Installer, der auf einer frischen OBS-Installation (macOS oder Windows) das komplette dc_onair-Streaming-Setup einrichtet: Szenen, Übergänge, Effekte, Kamera-Quellen, Audio-Filter, Branding und ein passendes Streaming-Profil.

Alles, was noch fehlt (Logo, Schrift, Hintergründe), steckt als Platzhalter drin und lässt sich später einfach austauschen.

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

| Szene | Inhalt |
|---|---|
| 01 Starting Soon | animierter Hintergrund, Logo, Text, scrollendes Streifenband |
| 02 Kamera iPhone | iPhone vollbild, Logo-Bug, Lower Third |
| 03 Kamera Sony | Sony A7 II vollbild, Logo-Bug, Lower Third |
| 04 Dual Cam | beide Kameras nebeneinander mit Eckrahmen |
| 05 Screen + Cam | Bildschirm mit Sony-Kamera unten rechts |
| 06 Screen Only | nur Bildschirm |
| 07 BRB | Pausenbild |
| 08 Ending | Abspann |

Hilfsszenen mit `_` am Anfang (Lower Third, Logo-Bug) sind in allen Szenen eingebunden und werden einmal zentral gepflegt.

**Übergänge:** `dc Stinger` (Standard, animierter Farbwisch mit Logo), `dc Slide`, `dc Swipe`, `dc Fade Black`. Zwischen den Kameraszenen wechselt OBS automatisch mit `dc Slide`. Der Lower Third fährt beim Einblenden und Ausblenden mit Slide-Animation ein und aus.

**Effekte:** Kamera-Farbkorrektur und Schärfe, scrollendes Warnband, animierter Hintergrund-Loop, Rahmen mit Eckklammern.

**Audio:** Desktop-Ton und Mikrofon (`Mic/Aux`) mit Rauschunterdrückung, Verstärkung, Kompressor und Limiter.

**Fehlt eine Kamera**, zeigt die Szene eine Karte "Kamera nicht verbunden" statt eines schwarzen Bildes.

### Optional: weiche Kamerawechsel mit "Move Transition"

Mit dem kostenlosen Plugin [Move Transition](https://obsproject.com/forum/resources/move-transition.913/) bewegen sich die Kameras zwischen den Szenen fließend, zum Beispiel vom Vollbild in die Dual-Cam-Ansicht. Plugin installieren, OBS schließen und den Installer erneut starten. Er erkennt das Plugin und wählt automatisch die passende Variante. Ohne das Plugin funktioniert alles auch, nur mit `dc Slide` statt Move.

### Hotkeys

| Aktion | Taste |
|---|---|
| Szene 1 bis 8 | Strg+Alt+1 bis 8 (macOS: Control+Option) |
| Lower Third ein / aus | Strg+Alt+L / H |
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
| `branding/logo.png` | Logo (Platzhalter: bisheriges HB-Logo) |
| `video/stinger.webm` | Übergangsvideo, VP9 mit Transparenz, Deckungspunkt bei 520 ms |
| `video/bg_loop.mp4` | animierter Hintergrund für Starting, BRB, Ending und Dual Cam |
| `overlays/frame_cam.png` | Rahmen um Kamerabilder |
| `overlays/lower_third.png` | Platte hinter Name und Titel |
| `overlays/cam_offline_*.png` | Karte, wenn eine Kamera fehlt |

**Schrift:** `.ttf` oder `.otf` in `payload/assets/fonts/` legen und in `payload/brand.env` bei `FONT_FAMILY=` den Familiennamen eintragen. Der Installer richtet die Schrift ein und trägt sie in alle Textquellen ein. Ohne Eintrag wird die Systemschrift genutzt (macOS: Helvetica Neue, Windows: Segoe UI).

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
