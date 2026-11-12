// Countdown für "Starting Soon" und "BRB". Startet jedes Mal neu, wenn die Szene sichtbar wird.
// Dauer in config.js: startMinutes / brbMinutes, oder feste Uhrzeit startAt / brbAt ("21:30").
(function () {
  var cfg = window.DC_CONFIG || {}, mode = window.DC_COUNTDOWN;
  var minutes = Number(cfg[mode.minutesKey]) || 5, at = cfg[mode.atKey] || "";
  var label = document.getElementById("label"), digits = document.getElementById("digits"), fill = document.getElementById("fill"), done = document.getElementById("done");
  label.textContent = mode.label; done.textContent = mode.done;
  var end = 0, total = 1, timer = null, shown = "";
  var cols = [];
  ["0", "0", ":", "0", "0"].forEach(function (c) {
    var el = document.createElement("div");
    if (c === ":") { el.className = "colon"; el.textContent = ":"; } else { el.className = "d"; var s = document.createElement("span"); s.textContent = c; el.append(s); }
    digits.append(el); cols.push(el);
  });

  function roll(el, ch) {
    var old = el.firstElementChild; if (old.textContent === ch) return;
    var neu = document.createElement("span"); neu.textContent = ch; neu.style.transform = "translateY(100%)"; el.append(neu);
    old.animate([{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], { duration: 260, easing: "cubic-bezier(.7,0,.3,1)", fill: "forwards" });
    neu.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { duration: 260, easing: "cubic-bezier(.7,0,.3,1)", fill: "forwards" })
      .finished.then(function () { old.remove(); neu.style.transform = "none"; });
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function start() {
    var now = Date.now();
    if (/^\d{1,2}:\d{2}$/.test(at)) {
      var p = at.split(":"), t = new Date(); t.setHours(+p[0], +p[1], 0, 0);
      if (t.getTime() <= now) t.setDate(t.getDate() + 1);
      end = t.getTime();
    } else end = now + minutes * 60000;
    total = Math.max(end - now, 1);
    document.body.classList.remove("finished"); clearInterval(timer);
    tick(); timer = setInterval(tick, 100);
  }
  function tick() {
    var left = Math.max(end - Date.now(), 0), sec = Math.ceil(left / 1000);
    var text = pad(Math.floor(sec / 60)) + pad(sec % 60);
    if (text !== shown) { var idx = [0, 1, 3, 4]; for (var i = 0; i < 4; i++) roll(cols[idx[i]], text[i]); shown = text; }
    digits.classList.toggle("hot", sec <= 10 && sec > 0);
    fill.style.transform = "scaleX(" + (left / total) + ")";
    if (left <= 0) { document.body.classList.add("finished"); clearInterval(timer); }
  }
  // OBS meldet, wenn die Quelle sichtbar wird: dann von vorn zählen
  window.addEventListener("obsSourceActivated", start);
  start();
})();
