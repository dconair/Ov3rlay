'use strict';
// Platzhalter {{NAME}} in Vorlagen ersetzen. Unbekannte Platzhalter werden zu leeren Strings,
// damit nie ein rohes {{...}} in einer OBS-Datei landet.
const { jsonEscape } = require('./util');

const TOKEN_RE = /\{\{([A-Z0-9_]+)\}\}/g;

const tokensIn = (text) => [...new Set([...text.matchAll(TOKEN_RE)].map((m) => m[1]))];

function render(text, values) {
  return text.replace(TOKEN_RE, (_, name) => String(values[name] ?? ''));
}

/** Rendert eine JSON-Vorlage; Werte werden JSON-sicher escaped (Anführungszeichen, Backslashes in Pfaden). */
function renderJson(text, values) {
  const escaped = {};
  for (const [k, v] of Object.entries(values)) escaped[k] = jsonEscape(v);
  return render(text, escaped);
}

module.exports = { tokensIn, render, renderJson };
