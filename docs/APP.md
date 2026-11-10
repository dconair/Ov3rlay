# dc_onair Setup (App für Windows und macOS)

Eine Electron-App, die OBS komplett einrichtet: Szenen, Übergänge, Profil, Schrift, Grafiken, Kameras, danach ein Selbsttest. Dieselbe Logik steckt in `core/` und läuft auch über die Kommandozeile (`node cli/dc-onair.js`). Die alten Skripte `installer/install.sh` und `install.ps1` bleiben als Notlösung ohne App erhalten.

## Installieren

Die Installer liegen als Artefakte bei jedem Lauf der GitHub-Action „App“ (Reiter *Actions*) und bei Versions-Tags (`v1.0.0`) unter *Releases*.

| System | Datei | Hinweis |
|---|---|---|
| Windows 10/11 | `dc_onair-Setup-<Version>-windows.exe` | Ohne Administratorrechte, nur für den aktuellen Benutzer. SmartScreen warnt, weil die App nicht signiert ist: *Weitere Informationen > Trotzdem ausführen*. |
| macOS 12 oder neuer (Intel und Apple Silicon) | `dc_onair-Setup-<Version>-macos.dmg` | Nur ad-hoc signiert. Beim ersten Start: Rechtsklick auf die App > *Öffnen*, oder `xattr -dr com.apple.quarantine "/Applications/dc_onair Setup.app"`. |

Voraussetzung: OBS Studio 30 oder neuer (<https://obsproject.com>).

## Ablauf

1. **Prüfen:** OBS suchen (Windows: Registry und Programme, macOS: `/Applications/OBS.app`), Version prüfen, läuft OBS noch? Grafikkarte erkennen.
2. **Einstellungen:** Plattform (Twitch, YouTube, anderer Dienst), Qualität (1080p30 ist vorausgewählt, 1080p60, 720p60) und Encoder.
3. **Installieren:** Vorher werden alle betroffenen Dateien gesichert (`…/dc_onair/backups/<Zeitstempel>/`). Dann Szenen-Collection, Profil, Assets und Schrift. Die Pfade der Collection zeigen auf den Ordner `…/dc_onair/assets`; die Platzhalter der Vorlagen werden dabei ersetzt.
4. **Kameras:** Die App startet OBS mit der neuen Collection und fragt OBS selbst nach den Geräten (exakte Geräte-IDs, bei Windows inklusive DirectShow-Pfad). Die Zuweisung wird gespeichert.
5. **Selbsttest:** OBS erreichbar, alle Szenen, Quellen und Dateien vorhanden, Kameras zugewiesen, Browserquellen antworten mit HTTP 200 (falls es welche gibt), danach werden **alle Szenen und alle Übergänge einmal durchgeschaltet** (siehe [UEBERGAENGE.md](UEBERGAENGE.md)). Screenshots jeder Szene und ein JSON-Bericht landen in `…/dc_onair/selftest/<Zeitstempel>/`. Der Test startet nicht, wenn OBS gerade streamt oder aufnimmt.
6. **Fertig:** Stream-Schlüssel in OBS eintragen (wird nie abgefragt oder gespeichert).

Wartung (auf der ersten Seite, wenn schon eingerichtet): *Entfernen* setzt OBS auf die vorherige Profil- und Collection-Auswahl zurück und löscht nur das, was dc_onair angelegt hat. Frühere Stände lassen sich aus den Sicherungen wiederherstellen.

## Encoder

| Erkannt | OBS-Encoder (einfacher Ausgabemodus) |
|---|---|
| NVIDIA | NVENC (`nvenc`) |
| AMD | AMF (`amd`) |
| Intel | Quick Sync (`qsv`) |
| macOS | VideoToolbox (`apple_h264`) |
| sonst | x264 |

Die Bitrate bleibt bei 6 Mbit/s (Twitch 1080p30). Die Auswahl lässt sich im Assistenten ändern.

## Kommandozeile

```
node cli/dc-onair.js status | encoder | cameras | matrix
node cli/dc-onair.js install --service twitch --quality 1080p30 --encoder auto
node cli/dc-onair.js selftest --shots ordner     # startet OBS bei Bedarf
node cli/dc-onair.js backups | restore <ID> | uninstall
```

Alle Pfade lassen sich über `DC_OBS_CONFIG`, `DC_APP_DIR`, `DC_FONT_DIR`, `DC_REC_DIR` umlenken (Tests).

## Entwickeln und bauen

```
npm ci
npm test                 # Node-Tests (Pfade, Installation, Rückbau, Matrix, Stinger)
npm start                # App im Entwicklungsmodus
npm run dist:win         # NSIS-Installer (auf Windows bauen)
npm run dist:mac         # dmg, universal (auf macOS bauen)
node tests/e2e_obs.js    # Installation + Selbsttest in echtem OBS (Linux, Xvfb)
node tests/electron_flow.js ordner   # App-Oberfläche durchklicken (Xvfb, echtes OBS)
```

Gebaut wird in GitHub Actions (`.github/workflows/app.yml`): Node-Tests auf allen drei Systemen, echtes OBS unter Linux, Windows-Installer auf `windows-latest`, dmg auf `macos-latest`, jeweils mit Smoke-Test des fertigen Pakets (stille Installation bzw. dmg einhängen, gepackte CLI ausführen). Optional und nicht blockierend läuft zusätzlich echtes OBS auf den Windows- und macOS-Runnern.

Aufbau: `core/` (gesamte Logik, ohne Abhängigkeiten), `cli/`, `electron/` (Fenster, Oberfläche), `payload/` (Szenen, Assets, Profile; wird in die App eingepackt), `tests/`.

## Offene Punkte

- **Echte Hardware:** Die Quellentypen und Geräteerkennung für Windows (`dshow_input`, PowerShell-Abfragen) und macOS (`av_capture_input`, `system_profiler`) sind gegen die OBS-Dokumentation gebaut, aber nicht auf einem echten Rechner mit Kamera geprüft. Die CI prüft sie auf den Runnern ohne Kamera und Grafikkarte. Der Selbsttest in der App meldet nicht zugewiesene Kameras als Hinweis.
- **Signierung:** Ohne Zertifikat gibt es SmartScreen- bzw. Gatekeeper-Hinweise. Für Weitergabe ein Windows-Code-Signing-Zertifikat und ein Apple-Developer-Konto einplanen.
- **Mobcam und Moblin** werden nicht mitgeliefert (eigene Lizenzen). iPhone-Kamera siehe README (Continuity Camera, Camo, Iriun, NDI).
- **Optionales Plugin Move Transition** wird erkannt, aber nicht automatisch installiert.
- **Cockpit, Chat, Alerts, Karte, Failover (v2):** Diese Teile der Übergabe (`localhost:7777`, Twitch-Anbindung) liegen nicht im Repository und sind nicht Teil dieser App. Der Selbsttest prüft Browserquellen bereits generisch (HTTP 200), sobald die Collection welche enthält.
