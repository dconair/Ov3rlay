// Einstellungen für Alerts, Chat und Countdown. Diese Datei bleibt bei einer Neuinstallation erhalten.
// Keine Zugangsdaten oder Tokens hier eintragen, wenn du die Datei teilst.
window.DC_CONFIG = {
  twitchChannel: "",      // Twitch-Kanalname für den Chat, zum Beispiel "dc_onair" (nur Lesen, ohne Anmeldung)
  chatMax: 6,             // wie viele Nachrichten gleichzeitig sichtbar sind
  chatSeconds: 25,        // so lange bleibt eine Nachricht stehen
  startMinutes: 5,        // Countdown auf "Starting Soon": so viele Minuten ab Sichtbarwerden der Szene
  startAt: "",            // oder feste Uhrzeit, zum Beispiel "21:30" (hat Vorrang)
  brbMinutes: 5,          // Countdown auf "BRB"
  brbAt: "",
  seToken: "",            // StreamElements "Overlay Token" (nicht das JWT): echte Alerts + Chat von Twitch und YouTube, siehe README. Leer = keine Anbindung
  seChannelId: "",        // optional: StreamElements-Kanal-ID, falls die Anmeldung ohne sie nicht klappt
  alertSeconds: 6,        // Anzeigedauer eines Alerts
  demo: false             // true = Testnachrichten und Test-Alerts auch in OBS (zum Ausprobieren)
};
