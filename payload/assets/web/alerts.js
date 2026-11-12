// Alerts im DJ-Thema: Warteschlange; Schallplatte schlägt ein und scratcht, Bass-Schlag lässt das Bild zucken,
// Equalizer springt, der Name wird eingetippt, ein Crossfader-Regler zeigt die Restzeit, dann fährt alles raus.
(function () {
  var cfg = window.DC_CONFIG || {};
  var stage = document.getElementById("stage");
  var queue = [], busy = false;
  var LABEL = { follow: "NEUER FOLLOWER", sub: "NEUES ABO", tip: "TIP", raid: "RAID", cheer: "BITS" };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var EASE_OUT = "cubic-bezier(.2,1,.3,1)";

  function detail(e) {
    var parts = [];
    if (e.type === "tip" && e.amount) parts.push(e.amount);
    if (e.type === "raid" && e.amount) parts.push(e.amount + " Zuschauer im Anmarsch");
    if (e.type === "sub" && e.amount) parts.push(e.amount + " Monate");
    if (e.type === "cheer" && e.amount) parts.push(e.amount + " Bits");
    if (e.type === "follow") parts.push("Willkommen im Set.");
    if (e.message) parts.push(e.message);
    return parts.join(" · ");
  }
  function el(tag, cls, parent) { var n = document.createElement(tag); if (cls) n.className = cls; if (parent) parent.append(n); return n; }

  async function play(e) {
    var seconds = (cfg.alertSeconds || 6) * 1000;
    var hot = e.type === "sub" || e.type === "raid";
    var eq = el("div", "eq" + (hot ? " hot" : ""), stage), bars = [];
    for (var i = 0; i < 20; i++) bars.push(el("b", "", eq));
    var box = el("div", "alert " + (e.type || "follow"), stage);
    el("span", "tag", box).textContent = LABEL[e.type] || "ALERT";
    var name = el("span", "name", box);
    var msg = el("p", "msg", box); msg.textContent = detail(e);
    var fader = el("div", "fader", box), knob = el("i", "knob", fader);
    var vinyl = el("div", "vinyl" + (hot ? " hot" : ""), stage); el("i", "", vinyl);

    // 1. Platte rollt von links ein und dreht auf
    vinyl.style.opacity = 1;
    vinyl.animate([{ transform: "translateX(-900px) rotate(-720deg)" }, { transform: "translateX(0) rotate(0)" }], { duration: 650, easing: EASE_OUT, fill: "forwards" });
    await sleep(430);
    // 2. Bass-Schlag: Karte knallt rein, Bild zuckt, Ringe pulsieren von der Platte aus
    box.style.opacity = 1;
    box.animate([{ transform: "translateX(60px) scale(.6) rotate(5deg)", opacity: 0 }, { transform: "translateX(0) scale(1.07) rotate(-2.5deg)", opacity: 1, offset: .55 },
      { transform: "scale(.98) rotate(-1deg)", offset: .8 }, { transform: "scale(1) rotate(-1.5deg)" }], { duration: 480, easing: EASE_OUT, fill: "forwards" });
    stage.animate([{ transform: "translate(0,0)" }, { transform: "translate(-10px,7px)" }, { transform: "translate(9px,-6px)" }, { transform: "translate(-6px,4px)" }, { transform: "translate(0,0)" }], { duration: 300 });
    for (var r = 0; r < 3; r++) {
      var ring = el("div", "ring" + (hot ? " hot" : ""), stage);
      ring.animate([{ transform: "scale(1)", opacity: .9 }, { transform: "scale(2.4)", opacity: 0 }], { duration: 900, delay: r * 170, easing: "ease-out", fill: "forwards" })
        .finished.then((function (n) { return function () { n.remove(); }; })(ring));
    }
    eq.style.opacity = 1;
    var eqLoop = bars.map(function (b) {
      var a = 12 + Math.random() * 20, z = 40 + Math.random() * 48;
      return b.animate([{ height: a + "px" }, { height: z + "px" }, { height: (a + z) / 3 + "px" }], { duration: 260 + Math.random() * 260, iterations: Infinity, direction: "alternate", easing: "steps(4)" });
    });
    await sleep(420);
    // Scratch: die Platte wird vor und zurück gezogen, während der Name getippt wird
    var spin = vinyl.animate([{ transform: "rotate(0)" }, { transform: "rotate(32deg)" }, { transform: "rotate(-24deg)" }, { transform: "rotate(18deg)" }, { transform: "rotate(0)" }],
      { duration: 520, easing: "ease-in-out", fill: "forwards" });
    var text = String(e.name || "").slice(0, 20);
    for (var k = 1; k <= text.length; k++) { name.textContent = text.slice(0, k); await sleep(45); }
    name.classList.add("done"); msg.classList.add("on");
    await spin.finished.catch(function () {});
    vinyl.animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 2400, iterations: Infinity, easing: "linear" });
    // 3. Crossfader-Regler wandert von rechts nach links
    knob.animate([{ left: "100%" }, { left: "0%" }], { duration: seconds, easing: "linear", fill: "forwards" });
    await sleep(Math.max(seconds - 1000, 500));
    // 4. raus: Platte rollt nach links, Karte fährt nach oben
    vinyl.animate([{ transform: "translateX(0) rotate(0)" }, { transform: "translateX(-1000px) rotate(-540deg)" }], { duration: 520, easing: "ease-in", fill: "forwards" });
    await box.animate([{ transform: "translateY(0) rotate(-1.5deg)", opacity: 1 }, { transform: "translateY(-300px) rotate(-4deg)", opacity: 0 }],
      { duration: 460, delay: 80, easing: "cubic-bezier(.6,0,.9,.4)", fill: "forwards" }).finished;
    eqLoop.forEach(function (a) { a.cancel(); });
    eq.remove(); box.remove(); vinyl.remove();
  }

  async function run() {
    if (busy) return; busy = true;
    while (queue.length) { try { await play(queue.shift()); } catch (err) { console.error(err); } await sleep(500); }
    busy = false;
  }

  // Öffentliche Schnittstelle: window.dcAlert({type:"follow|sub|tip|raid|cheer", name:"...", amount:"...", message:"..."})
  window.dcAlert = function (e) { queue.push(e || {}); run(); };
  window.addEventListener("message", function (ev) { if (ev.data && ev.data.dcAlert) window.dcAlert(ev.data.dcAlert); });

  // Vorschau: außerhalb von OBS (Doppelklick auf die Datei) oder mit demo:true in config.js
  var inObs = typeof window.obsstudio !== "undefined";
  if (!inObs || cfg.demo) {
    var demo = [{ type: "follow", name: "mara_k" }, { type: "sub", name: "nico", amount: 3, message: "Mehr Bass!" },
      { type: "tip", name: "tom_93", amount: "5,00 €", message: "Spiel den Track nochmal" }, { type: "raid", name: "DJ_Lea", amount: 42 }];
    var n = 0; setTimeout(function loop() { window.dcAlert(demo[n++ % demo.length]); setTimeout(loop, 9500); }, 700);
  }
})();
