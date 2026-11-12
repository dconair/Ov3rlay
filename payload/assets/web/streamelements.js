// StreamElements-Anbindung für die Alerts: lauscht auf dem Echtzeit-Dienst (Astro-WebSocket) und ruft window.dcAlert auf.
// Aktiv nur, wenn in config.js ein seToken steht. Ohne Token passiert hier nichts.
(function (root) {
  var URL = "wss://astro.streamelements.com/";

  function pick(d, keys) { for (var i = 0; i < keys.length; i++) { if (d[keys[i]] != null && d[keys[i]] !== "") return d[keys[i]]; } return ""; }

  // channel.activities -> Alert (Tips kommen über channel.tips, damit nichts doppelt läuft)
  function fromActivity(msg) {
    var a = msg && msg.data; if (!a || !a.type) return null;
    var d = a.data || {};
    var name = d.displayName || d.username || "";
    var out = { name: name, message: d.message || "" };
    switch (a.type) {
      case "follow": case "follower": out.type = "follow"; break;
      case "subscriber": case "sponsor": out.type = "sub"; out.amount = pick(d, ["amount", "months"]); break;
      case "communityGiftPurchase": out.type = "sub"; out.amount = ""; out.message = (pick(d, ["amount", "count"]) || "Mehrere") + " Abos verschenkt"; break;
      case "cheer": out.type = "cheer"; out.amount = pick(d, ["amount", "bits"]); break;
      case "raid": out.type = "raid"; out.amount = pick(d, ["amount", "viewers", "count"]); break;
      default: return null;
    }
    return out;
  }

  // channel.tips -> Alert
  function fromTip(msg) {
    var t = msg && msg.data; var don = t && t.donation; if (!don) return null;
    if (t.approved === "rejected") return null;
    var amount = don.amount;
    try { amount = new Intl.NumberFormat("de-DE", { style: "currency", currency: don.currency || "EUR" }).format(don.amount); } catch (e) { amount = don.amount + " " + (don.currency || ""); }
    return { type: "tip", name: (don.user && don.user.username) || "", amount: amount, message: don.message || "" };
  }

  function connect(cfg, emit, WS) {
    WS = WS || root.WebSocket;
    if (!cfg.seToken || !WS) return null;
    var tries = 0, ws, stopped = false, reconnect = "";
    function open() {
      ws = new WS((cfg.seUrl || URL) + (reconnect ? "?reconnect_token=" + encodeURIComponent(reconnect) : ""));
      ws.onopen = function () {
        tries = 0;
        ["channel.activities", "channel.tips"].forEach(function (topic, i) {
          var data = { topic: topic, token: cfg.seToken, token_type: cfg.seTokenType || "apikey" };
          if (cfg.seChannelId) data.room = cfg.seChannelId;
          setTimeout(function () { try { ws.send(JSON.stringify({ type: "subscribe", nonce: "dc-" + topic, data: data })); } catch (e) {} }, i * 150);
        });
      };
      ws.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === "reconnect" && m.data) { reconnect = m.data.reconnect_token || ""; return; }
        if (m.type === "response") { if (m.error) console.warn("StreamElements:", m.error, m.data && m.data.message); return; }
        if (m.type !== "message") return;
        var alert = m.topic === "channel.tips" ? fromTip(m) : m.topic === "channel.activities" ? fromActivity(m) : null;
        if (alert) emit(alert);
      };
      ws.onclose = function () {
        if (stopped) return;
        var wait = Math.min(30000, 1000 * Math.pow(2, tries++)) + Math.random() * 500;
        setTimeout(open, wait);
      };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    }
    open();
    return { stop: function () { stopped = true; try { ws.close(); } catch (e) {} } };
  }

  var api = { fromActivity: fromActivity, fromTip: fromTip, connect: connect };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.dcStreamElements = api;
    var cfg = root.DC_CONFIG || {};
    if (cfg.seToken && typeof root.dcAlert === "function") connect(cfg, root.dcAlert);
    else if (cfg.seToken) root.addEventListener("load", function () { connect(cfg, root.dcAlert); });
  }
})(typeof window !== "undefined" ? window : globalThis);
