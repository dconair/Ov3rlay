# Übergänge zwischen allen Szenen

Stand: Collection mit 9 Szenen (`01 Starting Soon` bis `09 Connection Lost`), 72 geordnete Szenenpaare.

## Regel

OBS wählt den Übergang **nach der Zielszene**: Hat die Zielszene einen Szenen-Override, gilt dieser (Übergang und Dauer), sonst der Standard-Übergang der Collection (`dc Stinger`). Die Startszene spielt keine Rolle. Deshalb besteht die Matrix aus genau einer Entscheidung pro Zielszene:

| Ziel | Übergang | Warum |
|---|---|---|
| 01 Starting Soon, 07 BRB, 08 Ending | `dc Stinger` (Schnittpunkt 520 ms) | Titelkarten sind Ereignisse im Stream: Farbwisch mit Logo, Wechsel unter voller Deckung |
| 02 bis 06 (Kameras, Dual Cam, Screen) | `dc Slide` 450 ms (mit Move-Plugin `dc Move`) | Zwischen Bildinhalten kurz und ruhig, kein Logo-Effekt |
| 09 Connection Lost | `Fade` (eingebaut) 300 ms | Soll beim automatischen Failover so schnell und unauffällig wie möglich sein |

Hinweis: OBS speichert in der Collection nur *konfigurierbare* Übergänge. Die eingebauten `Cut` und `Fade` dürfen deshalb nicht als eigener Eintrag (`dc Fade`) angelegt werden, sonst verschwinden sie beim ersten Speichern durch OBS samt Szenen-Zuordnung. Der Selbsttest prüft das im echten OBS (Rundlauf) und `npm test` statisch.

Nicht automatisch genutzt, aber vorhanden (manuell oder per Hotkey): `dc Swipe`, `dc Fade Black`.

## Matrix (von = Zeile, nach = Spalte)

| von \ nach | 01 Starting Soon | 02 Kamera iPhone | 03 Kamera Sony | 04 Dual Cam | 05 Screen + Cam | 06 Screen Only | 07 BRB | 08 Ending | 09 Connection Lost |
|---|---|---|---|---|---|---|---|---|---|
| **01 Starting Soon** | · | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Stinger (520 ms Schnitt) | dc Stinger (520 ms Schnitt) | Fade 300 ms |
| **02 Kamera iPhone** | dc Stinger (520 ms Schnitt) | · | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Stinger (520 ms Schnitt) | dc Stinger (520 ms Schnitt) | Fade 300 ms |
| **03 Kamera Sony** | dc Stinger (520 ms Schnitt) | dc Slide 450 ms | · | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Stinger (520 ms Schnitt) | dc Stinger (520 ms Schnitt) | Fade 300 ms |
| **04 Dual Cam** | dc Stinger (520 ms Schnitt) | dc Slide 450 ms | dc Slide 450 ms | · | dc Slide 450 ms | dc Slide 450 ms | dc Stinger (520 ms Schnitt) | dc Stinger (520 ms Schnitt) | Fade 300 ms |
| **05 Screen + Cam** | dc Stinger (520 ms Schnitt) | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | · | dc Slide 450 ms | dc Stinger (520 ms Schnitt) | dc Stinger (520 ms Schnitt) | Fade 300 ms |
| **06 Screen Only** | dc Stinger (520 ms Schnitt) | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | · | dc Stinger (520 ms Schnitt) | dc Stinger (520 ms Schnitt) | Fade 300 ms |
| **07 BRB** | dc Stinger (520 ms Schnitt) | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | · | dc Stinger (520 ms Schnitt) | Fade 300 ms |
| **08 Ending** | dc Stinger (520 ms Schnitt) | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Stinger (520 ms Schnitt) | · | Fade 300 ms |
| **09 Connection Lost** | dc Stinger (520 ms Schnitt) | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Slide 450 ms | dc Stinger (520 ms Schnitt) | dc Stinger (520 ms Schnitt) | · |

Neu erzeugen: `node cli/dc-onair.js matrix` (liest die Collection aus `payload/scenes`).

## Wie geprüft wird

1. **Statisch** (`npm test`, `core/matrix.js`): Jeder Übergang ist definiert, Dauer liegt zwischen 150 und 1500 ms, Stinger hat Videopfad und Schnittpunkt, es gibt zu jeder Zielszene genau einen Übergang.
2. **Stinger-Alpha** (`tests/node/stinger.test.js`, braucht ffmpeg): Der Schnittpunkt liegt in der Phase voller Deckung des Videos. Gemessen am aktuellen `stinger.webm` (60 fps, 66 Bilder = 1,1 s): volle Deckung von 283 bis 767 ms, Schnittpunkt 520 ms liegt fast genau in der Mitte. Das Video beginnt und endet vollständig transparent.
3. **Im echten OBS** (`tests/e2e_obs.js`, in der CI; in der App der Selbsttest): Ein Euler-Kreis schaltet alle 72 Szenenpaare nacheinander durch. Pro Wechsel wird geprüft, dass die Zielszene erreicht wird, der Übergang endet und der Name dem erwarteten Übergang entspricht, außerdem die Dauer.

Gemessen mit OBS 30.0.2 unter Linux (Software-Rendering, also eher langsamer als auf echter Hardware):

| Übergang | Wechsel | Soll | gemessen |
|---|---|---|---|
| dc Slide | 40 | 450 ms | 459 bis 594 ms |
| dc Stinger | 24 | Video 1,1 s | 1357 bis 1448 ms (inkl. Start und Ende des Medienspielers) |
| Fade | 8 | 300 ms | 341 bis 413 ms |

Alle 72 Wechsel liefen mit dem erwarteten Übergang. Auf echter Windows- und macOS-Hardware ist das bisher nicht gemessen; die App führt denselben Test beim Einrichten aus.
