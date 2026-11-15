/* panel/validation.js
   The guided validation-recording protocol (active with ?validate=1; entry page validation.html). A developer validation, not a calibration:
   the engine never needs it. It records the v2 files (panel/engine-rec.js) with markers {t (stream time), wall, block, label, kind, n} in
   meta.json, then tools/autotune.py analyses them. 18 blocks; &fast=1 divides every duration by 10; &autostart=1 starts on its own.
   If the stream drops, the protocol pauses, says so, and resumes at the start of the interrupted block.
   In Node it only exports the block table and the marker builder (tested by panel/validation.test.js). One IIFE: no top-level names. */
"use strict";
(function (root) {
  const BLOCKS = [
    { id: "rest_open", dur: 120, text: "Sit still, eyes open, look at the dot.", dot: true },
    { id: "rest_closed", dur: 60, text: "Close your eyes. Open them at the double beep." },
    { id: "nback", dur: 180, text: "2-back: press Space when the letter matches the one two letters back.", task: "nback" },
    { id: "arith", dur: 120, text: "Subtract 13 each time. Type the answer and press Enter. Wrong or late starts again at 1022.", task: "arith" },
    { id: "rest2", dur: 60, text: "Rest, eyes open.", dot: true },
    { id: "art_blink", trials: 20, trial: 3, text: "Blink once at each beep." },
    { id: "art_dblink", trials: 20, trial: 4, text: "Blink twice quickly at each beep." },
    { id: "art_clench", trials: 20, trial: 4, text: "Clench your jaw briefly at each beep (a quick tap)." },
    { id: "art_clench_long", trials: 20, trial: 6, text: "Clench and hold for 3 seconds at each beep.", hold: 3 },
    { id: "art_frown", trials: 20, trial: 4, text: "Frown hard for a second at each beep." },
    { id: "art_talk", dur: 60, text: "Read this text aloud.", read: true },
    { id: "art_chew", dur: 30, text: "Chew (gum or pretend) until the beep." },
    { id: "art_turn", trials: 20, trial: 4, text: "Turn your head left / right at each beep.", alt: ["left", "right"] },
    { id: "art_nod", trials: 20, trial: 4, text: "Nod once at each beep." },
    { id: "art_stand", trials: 3, trial: 15, text: "Stand up, then sit down." },
    { id: "art_type", dur: 60, text: "Type random letters in the box. Do not think hard.", task: "type" },
    { id: "game", dur: 300, text: "Race: the browser Mario Kart opens and closes after 5 minutes.", task: "game" },
    { id: "fixation", dur: 300, text: "Look at the dot. Do nothing.", dot: true, dim: true }
  ];
  const READ = "The library on the corner opens at nine in the morning. On weekdays it is quiet, and most people come to read the newspaper or to use the computers near the window. On Saturdays there is a short reading hour for children, and the staff put out extra chairs. In winter the heating is turned up and the windows fog a little. The coffee machine in the hall takes coins only. A small notice board lists the opening hours, a lost glove and a lecture about local birds.";
  /* &fast=N: continuous blocks last 1/N as long; trial blocks keep the natural trial spacing (artifacts must not overlap) with 1/N of the trials */
  const nTrials = (b, fast) => Math.max(1, Math.round(b.trials / (fast || 1)));
  const durOf = (b, fast) => b.dur != null ? b.dur / (fast || 1) : nTrials(b, fast) * b.trial;
  const totalS = fast => BLOCKS.reduce((s, b) => s + durOf(b, fast), 0);
  /* stream time t, wall ms, block index or id, label, kind start|end|cue, n */
  function marker(t, wall, block, label, kind, n) {
    const b = typeof block === "number" ? BLOCKS[block] : BLOCKS.find(x => x.id === block);
    if (!b || !["start", "end", "cue"].includes(kind)) throw new Error("bad marker");
    return { t: t == null ? null : Math.round(t * 1000) / 1000, wall, block: b.id, label: String(label || kind), kind, n: n == null ? null : n };
  }
  /* the cue times of a block (seconds from the block start), for trials */
  function cues(b, fast) { const out = []; if (b.trials) for (let k = 0; k < nTrials(b, fast); k++) out.push(k * b.trial); return out; }
  const API = { BLOCKS, durOf, totalS, marker, cues, nTrials, READ };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }
  root.EngValidation = API;
  const p = new URLSearchParams(location.search);
  if (p.get("validate") !== "1") return;

  /* ---------------- the overlay (browser only) ---------------- */
  const fast = p.get("fast") === "1" ? 10 : 1, auto = p.get("autostart") === "1";
  const V = { running: false, paused: false, bi: 0, blockT0: 0, markers: [], done: false, timer: null, ctx: null, nb: null, task: null, selfTest: { blocks: [] } };
  const css = document.createElement("style");
  css.textContent = `#valOv{position:fixed;inset:0;z-index:99970;background:rgba(2,4,24,.93);color:#e9f1ff;font-family:"Segoe UI",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
#valOv.dim{background:rgba(0,0,0,.97)}#valOv h2{font-weight:300;letter-spacing:.35em;margin:0}#valCue{font-size:26px;max-width:900px;text-align:center;line-height:1.35}#valCount{font-size:44px;font-weight:200}
#valBar{width:min(800px,80vw);height:8px;background:#141c4c;border-radius:4px;overflow:hidden}#valBar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#5a7cff,#35e6ff)}
#valOv button{background:#16215a;border:1px solid #4a6adf;color:#e9f1ff;border-radius:6px;padding:10px 26px;font-size:16px;cursor:pointer}#valOv button:disabled{opacity:.5;cursor:default}
#valDot{width:14px;height:14px;border-radius:50%;background:#fff;display:none}#valTask{font-size:64px;min-height:80px}#valIn{font-size:22px;padding:6px 10px;width:220px;background:#0b1450;color:#fff;border:1px solid #4a6adf;border-radius:6px;display:none}
#valRead{max-width:820px;font-size:20px;line-height:1.6;display:none}#valMsg{font-size:14px;color:#ffd98a;min-height:20px;max-width:900px;text-align:center}#valSelf{display:none}
#valTb{width:min(800px,80vw);height:6px;background:#141c4c;display:none}#valTb i{display:block;height:100%;background:#ffd98a}`;
  document.head.appendChild(css);
  const ov = document.createElement("div"); ov.id = "valOv";
  ov.innerHTML = '<h2>VALIDATION RECORDING</h2><div id="valMsg"></div><div id="valCue">About 32 minutes, alone, in 18 parts. This is not a calibration. Press Start when the headset is connected and data flows.</div><div id="valDot"></div><div id="valTask"></div><input id="valIn" autocomplete="off"><div id="valTb"><i></i></div><div id="valRead"></div><div id="valCount"></div><div id="valBar"><i></i></div><button id="valStart" disabled>Start</button><pre id="validationSelfTest"></pre>';
  document.body.appendChild(ov);
  const $v = id => document.getElementById(id);
  $v("validationSelfTest").style.display = "none";
  function beep(n) { try { V.ctx = V.ctx || new (window.AudioContext || window.webkitAudioContext)(); for (let k = 0; k < n; k++) { const o = V.ctx.createOscillator(), g = V.ctx.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(V.ctx.destination); const t0 = V.ctx.currentTime + k * 0.25; o.start(t0); o.stop(t0 + 0.15); } } catch (e) {} }
  const streamT = () => window.EngineOut ? EngineOut.t : null;
  function mark(label, kind, n) { const m = marker(streamT(), Date.now(), V.bi, label, kind, n); V.markers.push(m); if (typeof engRecMarker === "function") engRecMarker(m);
    if (kind === "start" || kind === "end") V.selfTest.blocks.push(m.block + ":" + kind); $v("validationSelfTest").textContent = JSON.stringify(V.selfTest); }
  function flowing() { return typeof S !== "undefined" && S.connected && typeof engState !== "undefined" && Date.now() - engState.lastFrameWall < 2000; }
  setInterval(() => { if (!V.running && !V.done) $v("valStart").disabled = !flowing(); if (auto && !V.running && !V.done && flowing() && !V.autoStarted) { V.autoStarted = true; start(); } }, 250);
  $v("valStart").addEventListener("click", start);
  function start() {
    if (V.running) return; if (typeof setEngMode === "function") setEngMode("new");
    if (typeof engRecStart === "function" && !engRecActive()) engRecStart({});
    V.running = true; V.bi = 0; $v("valStart").style.display = "none"; runBlock();
  }
  function clearTask() { $v("valTask").textContent = ""; $v("valIn").style.display = "none"; $v("valRead").style.display = "none"; $v("valDot").style.display = "none"; $v("valTb").style.display = "none"; ov.classList.remove("dim"); V.task = null; document.removeEventListener("keydown", nbKey); }
  function runBlock() {
    clearTask(); const b = BLOCKS[V.bi], dur = durOf(b, fast); V.blockT0 = Date.now(); V.cueN = 0; V.trialCues = cues(b, fast); V.lastTrial = -1;
    $v("valCue").textContent = (V.bi + 1) + "/18  " + b.text; if (b.dot) $v("valDot").style.display = "block"; if (b.dim) ov.classList.add("dim");
    if (b.read) { $v("valRead").textContent = READ; $v("valRead").style.display = "block"; }
    beep(2); mark(b.id, "start");
    if (b.task === "nback") startNback(); else if (b.task === "arith") startArith(); else if (b.task === "type") { $v("valIn").value = ""; $v("valIn").style.display = "block"; $v("valIn").focus(); } else if (b.task === "game") startGame();
    clearInterval(V.timer); V.timer = setInterval(() => tick(dur), 100);
  }
  function tick(dur) {
    const b = BLOCKS[V.bi], el = (Date.now() - V.blockT0) / 1000;
    if (!flowing()) { if (!V.paused) { V.paused = true; $v("valMsg").textContent = "The signal dropped. Paused: this part starts again when data flows."; if (b.task === "game" && root.MKDSUI) try { root.MKDSUI.close(); } catch (e) {} } return; }
    if (V.paused) { V.paused = false; $v("valMsg").textContent = ""; mark(b.id, "end", -1); runBlock(); return; }     // resume at the start of the interrupted block
    $v("valCount").textContent = Math.max(0, Math.ceil(dur - el)); const done = BLOCKS.slice(0, V.bi).reduce((s, x) => s + durOf(x, fast), 0) + Math.min(el, dur);
    $v("valBar").firstChild.style.width = (100 * done / totalS(fast)) + "%";
    const k = V.trialCues.findIndex((c, i) => i > V.lastTrial && el >= c);
    if (k >= 0) { V.lastTrial = k; beep(1); mark(b.id + (b.alt ? " " + b.alt[k % 2] : ""), "cue", k); if (b.alt) $v("valCue").textContent = (V.bi + 1) + "/18  Turn your head " + b.alt[k % 2] + "."; }
    if (b.hold && V.lastTrial >= 0 && !V.holdMarked && el >= V.trialCues[V.lastTrial] + b.hold) { V.holdMarked = true; mark(b.id + " release", "cue", V.lastTrial); beep(1); }
    if (b.hold && V.lastTrial >= 0 && el < V.trialCues[V.lastTrial] + b.hold) V.holdMarked = false;
    if (V.task && V.task.tick) V.task.tick(el);
    if (el >= dur) { clearInterval(V.timer); if (V.task && V.task.end) V.task.end(); mark(b.id, "end"); V.bi++; if (V.bi >= BLOCKS.length) finish(); else runBlock(); }
  }
  /* 2-back: a letter every 2.5 s (shown 500 ms), 30% targets */
  function nbKey(e) { if (e.code !== "Space" || !V.task || !V.task.nb) return; e.preventDefault(); const T = V.task.nb; if (T.resp) return; T.resp = true; const hit = T.target; T.hits += hit ? 1 : 0; T.fa += hit ? 0 : 1; mark("nback response " + (hit ? "hit" : "false alarm"), "cue", T.n); }
  function startNback() {
    const L = "BCDFGHJKLMNPQRSTVWXZ", seq = []; let n = 0; const T = { nb: true, hits: 0, fa: 0, targets: 0, n: 0, resp: false, target: false, next: 0 };
    T.tick = el => { if (el >= T.next) { T.next += 2.5 / fast; const target = seq.length >= 2 && Math.random() < 0.3; let c = target ? seq[seq.length - 2] : L[Math.floor(Math.random() * L.length)]; if (!target && seq.length >= 2 && c === seq[seq.length - 2]) c = L[(L.indexOf(c) + 3) % L.length];
        seq.push(c); T.target = target; T.targets += target ? 1 : 0; T.resp = false; T.n = n++; $v("valTask").textContent = c; mark("nback " + c + (target ? " target" : ""), "cue", T.n); setTimeout(() => { if (V.task === T) $v("valTask").textContent = ""; }, 500 / fast); } };
    T.end = () => { $v("valMsg").textContent = "2-back: " + T.hits + " of " + T.targets + " targets, " + T.fa + " false alarms."; };
    V.task = { nb: true, tick: T.tick, end: T.end }; V.task.nb = T; Object.assign(V.task, { nb: T }); V.task.tick = T.tick; document.addEventListener("keydown", nbKey);
  }
  /* serial subtraction with time pressure (Stress.makeTask) */
  function startArith() {
    const task = root.Stress && root.Stress.makeTask ? root.Stress.makeTask(1022, 13) : null; if (!task) return;
    const inp = $v("valIn"), tb = $v("valTb"); inp.style.display = "block"; tb.style.display = "block"; inp.value = ""; inp.focus(); let due = 0, n = 0;
    const ask = el => { $v("valTask").textContent = task.prompt(); due = el + 5 / fast; inp.value = ""; };
    V.task = { tick: el => { if (!due) ask(el); tb.firstChild.style.width = Math.max(0, 100 * (due - el) / (5 / fast)) + "%"; if (el >= due) { task.answer(NaN); mark("arith late", "cue", n++); ask(el); } }, end: () => { inp.onkeydown = null; $v("valMsg").textContent = "Arithmetic: " + task.correct + " right, " + task.wrong + " wrong or late."; } };
    inp.onkeydown = e => { if (e.key !== "Enter") return; const ok = task.answer(inp.value.trim()); mark("arith " + (ok ? "right" : "wrong"), "cue", n++); ask((Date.now() - V.blockT0) / 1000); };
  }
  function startGame() {
    const go = () => { try { root.MKDSUI.open({ stage: document.getElementById("stage"), focus: () => (typeof gameFocus === "function" ? gameFocus() : null), sensors: () => [], status: () => "validation", onClose: () => {} }); } catch (e) { $v("valMsg").textContent = "The game could not open; keep still and wait."; } };
    const close = () => { try { if (root.MKDSUI) root.MKDSUI.close(); } catch (e) {} };
    V.task = { end: close };
    if (root.MKDSUI) return go();
    let left = 2; ["game/mkds.js", "game/mkds-render.js"].forEach(src => { const s = document.createElement("script"); s.src = src; s.onload = () => { if (--left === 0) go(); }; s.onerror = () => { $v("valMsg").textContent = "The game could not load."; }; document.head.appendChild(s); });
  }
  function finish() {
    V.running = false; V.done = true; clearTask();
    const name = typeof engRecStop === "function" ? engRecStop(false) : null;
    V.selfTest.done = true; V.selfTest.markers = V.markers.length; V.selfTest.file = name; $v("validationSelfTest").textContent = JSON.stringify(V.selfTest);
    $v("valCue").textContent = "Done. Next: run  python tools/autotune.py  (see workflows/validate_focus_stress.md)"; $v("valCount").textContent = ""; beep(2);
  }
})(typeof window !== "undefined" ? window : globalThis);
