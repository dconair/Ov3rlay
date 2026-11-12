// StreamElements-Anbindung für Alerts und Chat: lauscht auf dem Echtzeit-Dienst (Astro-WebSocket), ruft window.dcAlert auf bzw. liefert Chat (Twitch + YouTube).
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

  // channel.chat -> {event, id, user, text, mod, provider ...}
  function fromChat(msg) {
    var c = msg && msg.data; if (!c || !c.event) return null;
    if (c.event === "message") {
      var au = c.author || {}, roles = au.roles || [];
      return { event: "message", id: c.id, uid: au.id || au.login || "", user: au.name || au.login || "", text: c.text || "", provider: c.provider || "",
        mod: roles.indexOf("moderator") >= 0 || roles.indexOf("broadcaster") >= 0 || roles.indexOf("vip") >= 0 };
    }
    if (c.event === "message_deleted") return { event: "message_deleted", id: c.message_id };
    if (c.event === "user_cleared") return { event: "user_cleared", uid: (c.user && (c.user.id || c.user.login)) || "" };
    if (c.event === "chat_cleared") return { event: "chat_cleared" };
    return null;
  }

  // Verbindung zum Echtzeit-Dienst. topics: Liste der Themen; onMessage(topic, nachricht)
  function connectRaw(cfg, topics, onMessage, WS) {
    WS = WS || root.WebSocket;
    if (!cfg.seToken || !WS) return null;
    var tries = 0, ws, stopped = false, reconnect = "";
    function open() {
      ws = new WS((cfg.seUrl || URL) + (reconnect ? "?reconnect_token=" + encodeURIComponent(reconnect) : ""));
      ws.onopen = function () {
        tries = 0;
        topics.forEach(function (topic, i) {
          var data = { topic: topic, token: cfg.seToken, token_type: cfg.seTokenType || "apikey" };
          if (cfg.seChannelId) data.room = cfg.seChannelId;
          setTimeout(function () { try { ws.send(JSON.stringify({ type: "subscribe", nonce: "dc-" + topic, data: data })); } catch (e) {} }, i * 150);
        });
      };
      ws.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === "reconnect" && m.data) { reconnect = m.data.reconnect_token || ""; return; }
        if (m.type === "response") { if (m.error) console.warn("StreamElements:", m.error, m.data && m.data.message); return; }
        if (m.type === "message") onMessage(m.topic, m);
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

  // Alerts: Aktivitäten und Tips
  function connect(cfg, emit, WS) {
    return connectRaw(cfg, ["channel.activities", "channel.tips"], function (topic, m) {
      var alert = topic === "channel.tips" ? fromTip(m) : topic === "channel.activities" ? fromActivity(m) : null;
      if (alert) emit(alert);
    }, WS);
  }

  // Chat: Twitch und YouTube in einem Format
  function connectChat(cfg, onEvent, WS) {
    return connectRaw(cfg, ["channel.chat"], function (topic, m) {
      var e = topic === "channel.chat" ? fromChat(m) : null;
      if (e) onEvent(e);
    }, WS);
  }

  var api = { fromActivity: fromActivity, fromTip: fromTip, fromChat: fromChat, connect: connect, connectChat: connectChat };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.dcStreamElements = api;
    var cfg = root.DC_CONFIG || {};
    // Auf der Alert-Seite (dcAlert vorhanden) Alerts verbinden; die Chat-Seite ruft connectChat selbst auf
    var start = function () { if (cfg.seToken && typeof root.dcAlert === "function") connect(cfg, root.dcAlert); };
    if (document.readyState === "complete") start(); else root.addEventListener("load", start);
  }
})(typeof window !== "undefined" ? window : globalThis);
