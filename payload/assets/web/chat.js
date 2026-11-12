// Chat mit kleiner Animation. Quellen: StreamElements (Twitch + YouTube zusammen, wenn seToken gesetzt ist)
// oder der Twitch-Chat anonym (nur Lesen, keine Anmeldung, kein Token).
(function () {
  var cfg = window.DC_CONFIG || {};
  var box = document.getElementById("chat");
  var max = cfg.chatMax || 6, life = (cfg.chatSeconds || 25) * 1000;

  function add(user, text, mod, id, uid, provider) {
    var m = document.createElement("div"); m.className = "msg" + (mod ? " mod" : "");
    if (id) m.dataset.id = id; if (uid) m.dataset.uid = uid; if (provider) m.dataset.provider = provider;
    var b = document.createElement("b"); b.textContent = user;
    m.append(b, document.createTextNode(text)); box.append(m);
    while (box.children.length > max) drop(box.firstElementChild);
    setTimeout(function () { drop(m); }, life);
  }
  function drop(m) {
    if (!m || !m.parentNode || m.classList.contains("out")) return;
    m.classList.add("out"); setTimeout(function () { m.remove(); }, 360);
  }
  window.dcChat = add; // dcChat("name", "text", istMod)
  function removeWhere(attr, value) {
    Array.prototype.slice.call(box.children).forEach(function (m) { if (m.dataset[attr] === String(value)) drop(m); });
  }
  function fromStreamElements(e) {
    if (e.event === "message") add(e.user, e.text, e.mod, e.id, e.uid, e.provider);
    else if (e.event === "message_deleted") removeWhere("id", e.id);
    else if (e.event === "user_cleared") removeWhere("uid", e.uid);
    else if (e.event === "chat_cleared") Array.prototype.slice.call(box.children).forEach(drop);
  }

  function parse(line) {
    var tags = {}, rest = line;
    if (rest[0] === "@") { var i = rest.indexOf(" "); rest.slice(1, i).split(";").forEach(function (t) { var p = t.split("="); tags[p[0]] = p[1] || ""; }); rest = rest.slice(i + 1); }
    var m = rest.match(/^:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$/);
    if (!m) return null;
    var badges = tags.badges || "";
    return { user: tags["display-name"] || m[1], text: m[2], mod: /moderator|broadcaster|vip/.test(badges) };
  }
  function connect(channel) {
    var ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    ws.onopen = function () {
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws.send("PASS SCHMOOPIIE"); ws.send("NICK justinfan" + Math.floor(10000 + Math.random() * 80000));
      ws.send("JOIN #" + channel.toLowerCase());
    };
    ws.onmessage = function (ev) {
      String(ev.data).split("\r\n").forEach(function (line) {
        if (line.indexOf("PING") === 0) { ws.send("PONG :tmi.twitch.tv"); return; }
        var p = parse(line); if (p) add(p.user, p.text, p.mod);
      });
    };
    ws.onclose = function () { setTimeout(function () { connect(channel); }, 5000); };
  }

  var inObs = typeof window.obsstudio !== "undefined";
  var viaSE = !!(cfg.seToken && window.dcStreamElements);
  if (viaSE) window.dcStreamElements.connectChat(cfg, fromStreamElements); // Twitch und YouTube; der anonyme Twitch-Chat bleibt dann aus (sonst doppelt)
  else if (cfg.twitchChannel) connect(cfg.twitchChannel);
  if (!viaSE && !cfg.twitchChannel && (!inObs || cfg.demo)) {
    var demo = [["mara_k", "Wo seid ihr gerade??", 0], ["nico", "das Set ist 🔥", 0], ["ModLea", "Gleich Drop, bleibt dran!", 1],
      ["tom_93", "Ton ist mega", 0], ["jule", "Track-ID bitte!", 0], ["kai_", "Gruß aus Köln", 0]];
    var k = 0; setInterval(function () { var d = demo[k++ % demo.length]; add(d[0], d[1], d[2]); }, 1800);
  }
})();
