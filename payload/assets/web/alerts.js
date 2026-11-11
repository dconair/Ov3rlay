// Alerts: Warteschlange, flache Animation (Klebeband-Wisch, Aufprall mit Wackeln, Tippschrift, Konfetti-Quadrate, Zeitbalken).
(function () {
  var cfg = window.DC_CONFIG || {};
  var stage = document.getElementById("stage");
  var queue = [], busy = false;
  var LABEL = { follow: "NEUER FOLLOWER", sub: "NEUES ABO", tip: "TIP", raid: "RAID", cheer: "BITS" };
  var COLORS = ["#c8f31d", "#ff6200", "#0e0f0f", "#ece6d6"];
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

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

  async function play(e) {
    var seconds = (cfg.alertSeconds || 6) * 1000;
    var tape = document.createElement("div"); tape.className = "tape";
    var box = document.createElement("div"); box.className = "alert " + (e.type || "follow");
    var tag = document.createElement("span"); tag.className = "tag"; tag.textContent = LABEL[e.type] || "ALERT";
    var name = document.createElement("span"); name.className = "name";
    var msg = document.createElement("p"); msg.className = "msg"; msg.textContent = detail(e);
    var bar = document.createElement("div"); bar.className = "bar";
    box.append(tag, name, msg, bar); stage.append(tape, box);

    // 1. Klebeband wischt quer durchs Bild
    tape.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 260, easing: "cubic-bezier(.7,0,.2,1)", fill: "forwards" });
    await sleep(200);
    // 2. Karte schlägt ein, wackelt kurz
    box.style.opacity = 1;
    box.animate([
      { transform: "scale(.35) rotate(-12deg)", opacity: 0 },
      { transform: "scale(1.1) rotate(2.5deg)", opacity: 1, offset: .55 },
      { transform: "scale(.97) rotate(-2deg)", offset: .75 },
      { transform: "scale(1) rotate(-1.5deg)" }], { duration: 520, easing: "cubic-bezier(.2,1,.3,1)", fill: "forwards" });
    confetti(box, e.type === "sub" || e.type === "raid" ? 26 : 16);
    tape.animate([{ transform: "scaleX(1)", transformOrigin: "right" }, { transform: "scaleX(0)", transformOrigin: "right" }],
      { duration: 380, delay: 240, easing: "ease-in", fill: "forwards" });
    await sleep(520);
    box.animate([{ transform: "translateX(0) rotate(-1.5deg)" }, { transform: "translateX(-9px) rotate(-1.5deg)" },
      { transform: "translateX(9px) rotate(-1.5deg)" }, { transform: "translateX(0) rotate(-1.5deg)" }], { duration: 160 });
    // 3. Name wird eingetippt, danach erscheint die Zeile
    var text = String(e.name || "").slice(0, 22);
    for (var i = 1; i <= text.length; i++) { name.textContent = text.slice(0, i); await sleep(45); }
    name.classList.add("done"); msg.classList.add("on");
    // 4. Zeitbalken läuft ab
    bar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: seconds, easing: "linear", fill: "forwards" });
    await sleep(seconds);
    // 5. raus: nach oben
    await box.animate([{ transform: "translateY(0) rotate(-1.5deg)", opacity: 1 }, { transform: "translateY(-260px) rotate(-4deg)", opacity: 0 }],
      { duration: 420, easing: "cubic-bezier(.6,0,.9,.4)", fill: "forwards" }).finished;
    tape.remove(); box.remove();
  }

  function confetti(box, n) {
    var r = box.getBoundingClientRect();
    for (var i = 0; i < n; i++) {
      var q = document.createElement("i"); q.className = "sq";
      q.style.background = COLORS[i % COLORS.length];
      q.style.outline = i % 4 === 2 ? "2px solid #ece6d6" : "none";
      var x0 = r.left + Math.random() * r.width, y0 = r.top + Math.random() * r.height;
      q.style.left = x0 + "px"; q.style.top = y0 + "px"; stage.append(q);
      var a = Math.random() * Math.PI * 2, d = 140 + Math.random() * 260;
      q.animate([{ transform: "translate(0,0) rotate(0)", opacity: 1 },
        { transform: "translate(" + Math.cos(a) * d + "px," + (Math.sin(a) * d * .7 + 90) + "px) rotate(" + (Math.random() * 720 - 360) + "deg)", opacity: 0 }],
        { duration: 900 + Math.random() * 500, easing: "cubic-bezier(.1,.7,.3,1)", fill: "forwards" }).finished.then(function () { q.remove(); });
    }
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
    var k = 0; setTimeout(function loop() { window.dcAlert(demo[k++ % demo.length]); setTimeout(loop, 9500); }, 700);
  }
})();
