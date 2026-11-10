/* Experimental stress meter for the Muse 2 panel.
   NOT a validated stress measure. EEG cannot read stress directly. This combines three signals that tend to move with
   arousal and learns, PER PERSON, which of them actually respond:
     - heart rate (pulse sensor)
     - frontal beta / alpha (AF7 + AF8)
     - facial muscle tension (30-44 Hz on the forehead sensors; clenching, frowning)
   Calibration has two phases: a calm baseline, then a short mental-arithmetic task that raises arousal. Each signal is
   scored by how far it moved between the two phases (effect size d). Signals that did not respond (d < 0.5) are ignored
   and the report says so. Score: 20 = your calm level, 80 = your level during the task, clamped to 0..100.
   If the task is skipped it falls back to "20 = calm, 100 = 3 SD above calm" using the calm phase only.
   Core maths has no DOM and is tested in stress.test.js. */
"use strict";
(function (root) {

const FS = 256, WIN = 512, MIN_D = 0.5;
const COMPS = { hr: { w: 0.40, minSd: 3.0, label: "HEART RATE" }, ratio: { w: 0.35, minSd: 0.15, label: "BETA/ALPHA" }, tension: { w: 0.25, minSd: 0.15, label: "MUSCLE TENSION" } };
const KEYS = Object.keys(COMPS);

/* ---------- spectrum ---------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
/* x: 512 samples in uV. Returns power (uV^2) in alpha 8-13, beta 13-30, gamma 30-44 and total 1-44 Hz. */
function bandPowers(x) {
  const n = WIN, re = new Float64Array(n), im = new Float64Array(n);
  let mean = 0; for (let i = 0; i < n; i++) mean += x[i]; mean /= n;
  for (let i = 0; i < n; i++) re[i] = (x[i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  fft(re, im);
  const df = FS / n, band = (lo, hi) => { let s = 0; for (let k = Math.ceil(lo / df); k * df < hi && k < n / 2; k++) s += (re[k] * re[k] + im[k] * im[k]); return s; };
  return { alpha: band(8, 13), beta: band(13, 30), gamma: band(30, 44), total: band(1, 44) };
}
/* windows: array of 512-sample arrays (the usable frontal channels). Returns {ratio, tension} (ln values) or null parts. */
function eegFeatures(windows, rejectRatio) {
  if (!windows.length) return { ratio: null, tension: null };
  let a = 0, b = 0, g = 0, t = 0;
  windows.forEach(w => { const p = bandPowers(w); a += p.alpha; b += p.beta; g += p.gamma; t += p.total; });
  const eps = 1e-6;
  return { ratio: rejectRatio ? null : Math.log((b + eps) / (a + eps)), tension: Math.log((g + eps) / (t + eps)) };
}

/* ---------- the arithmetic task (pure, so it can be tested) ---------- */
/* Count backwards from `start` by `step`. A wrong answer sends you back to the start (the classic stressor). */
function makeTask(start, step) {
  start = start || 1022; step = step || 13;
  const T = { cur: start, start, step, correct: 0, wrong: 0 };
  T.prompt = () => `${T.cur} - ${T.step}`;
  T.answer = v => { if (+v === T.cur - T.step) { T.cur -= T.step; T.correct++; if (T.cur - T.step < 0) T.cur = T.start; return true; } T.wrong++; T.cur = T.start; return false; };
  return T;
}

/* ---------- baseline, model, score ---------- */
function stats(a) { const m = a.reduce((s, v) => s + v, 0) / a.length; const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length); return { m, sd }; }
function phaseStats(samples, min) {
  const out = {};
  KEYS.forEach(k => { if (samples[k].length >= min) { const st = stats(samples[k]); out[k] = { m: st.m, sd: Math.max(st.sd, COMPS[k].minSd), n: samples[k].length }; } });
  return out;
}
function makeMeter(cfg) {
  cfg = cfg || {};
  const minN = cfg.minSamples || 10, ema = cfg.ema || 0.25;
  const M = { phases: {}, cur: null, model: null, base: null, value: null, z: {}, used: [], report: [] };
  M.startPhase = name => { M.cur = { name, s: { hr: [], ratio: [], tension: [] } }; };
  M.startCal = () => { M.phases = {}; M.model = null; M.base = null; M.value = null; M.startPhase("calm"); };
  M.push = f => { if (!M.cur) return; KEYS.forEach(k => { if (f[k] != null && isFinite(f[k])) M.cur.s[k].push(f[k]); }); };
  M.endPhase = () => { const c = M.cur; M.cur = null; if (!c) return null; const st = phaseStats(c.s, minN); M.phases[c.name] = st; if (c.name === "calm") M.base = st; return st; };
  M.phaseCount = () => M.cur ? Math.max(...KEYS.map(k => M.cur.s[k].length)) : 0;
  /* build the scoring model from the calm phase (required) and the task phase (optional). Returns true if usable. */
  M.build = () => {
    const calm = M.phases.calm, task = M.phases.stress; M.report = []; M.model = null;
    if (!calm || !Object.keys(calm).length) return false;
    const two = {}, one = {};
    KEYS.forEach(k => {
      if (!calm[k]) { M.report.push({ key: k, status: "no data" }); return; }
      one[k] = { mc: calm[k].m, sd: calm[k].sd, w: COMPS[k].w };
      const s = task && task[k];
      if (!s) { M.report.push({ key: k, status: task ? "no data in task" : "calm only" }); return; }
      const d = (s.m - calm[k].m) / Math.sqrt((calm[k].sd * calm[k].sd + s.sd * s.sd) / 2);
      if (d >= MIN_D) { two[k] = { mc: calm[k].m, ms: s.m, w: Math.min(d, 3) }; M.report.push({ key: k, status: "used", d }); }
      else M.report.push({ key: k, status: "ignored", d });
    });
    if (Object.keys(two).length) M.model = { mode: "two-point", comps: two };
    else M.model = { mode: "baseline-only", comps: one, weak: !!task };
    return true;
  };
  M.finishCal = () => { M.endPhase(); return M.build(); };       // calm-only convenience
  M.ready = () => !!M.model;
  M.score = f => {
    if (!M.model) return null;
    let wsum = 0, acc = 0; M.used = []; M.z = {};
    const two = M.model.mode === "two-point";
    Object.keys(M.model.comps).forEach(k => {
      const c = M.model.comps[k];
      if (f[k] == null || !isFinite(f[k])) return;
      const v = two ? Math.max(-0.5, Math.min(1.5, (f[k] - c.mc) / (c.ms - c.mc))) : Math.max(-4, Math.min(4, (f[k] - c.mc) / c.sd));
      M.z[k] = v; acc += c.w * v; wsum += c.w; M.used.push(k);
    });
    if (!wsum) return M.value;
    const mean = acc / wsum;
    const raw = Math.max(0, Math.min(100, two ? 20 + 60 * mean : 20 + 80 * mean / 3));
    M.value = M.value == null ? raw : M.value + ema * (raw - M.value);
    return M.value;
  };
  return M;
}

const API = { fft, bandPowers, eegFeatures, makeMeter, makeTask, COMPS, FS, WIN, MIN_D };

/* ---------- panel attachment (browser only) ---------- */
function attach(cfg) {
  const CAL_SEC = +(cfg.calSec || 30), TASK_SEC = +(cfg.taskSec || CAL_SEC), meter = makeMeter({ minSamples: Math.min(10, Math.floor(CAL_SEC / 2)) });
  const css = document.createElement("style");
  css.textContent = `#stressCard{position:fixed;left:12px;bottom:12px;width:290px;z-index:50;background:rgba(5,10,40,.9);border:1px solid rgba(110,150,255,.6);border-radius:10px;padding:10px 12px;color:#e9f1ff;font:12px "Segoe UI",system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.5)}
#stressCard b.t{letter-spacing:.22em;font-size:10px;color:#9fb2e6}#stressCard .n{font-size:34px;font-weight:300;line-height:1.1}#stressCard .bar{height:12px;border-radius:3px;background:#050a26;box-shadow:inset 0 0 0 1px #2d3c6a;overflow:hidden;margin:3px 0 6px}
#stressCard .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3fd6ff,#ffd166 60%,#ff453a)}#stressCard .mini{display:flex;justify-content:space-between;color:#9fb2e6;font-size:10px;letter-spacing:.08em;margin-top:2px}
#stressCard button{background:#16215a;border:1px solid #4a6adf;color:#e9f1ff;border-radius:5px;padding:5px 10px;font-size:11px;cursor:pointer;margin:6px 6px 0 0}#stressCard button:disabled{opacity:.45;cursor:default}
#stressCard small{display:block;color:#7f93c9;line-height:1.4;margin-top:6px;font-size:10px}#stressCard .demo{margin-top:6px;border-top:1px solid #2d3c6a;padding-top:6px}#stressCard .demo label{display:flex;justify-content:space-between;gap:8px;align-items:center;color:#9fb2e6}
#stressCard .task{display:none;margin-top:6px}#stressCard .task .q{font-size:22px;font-weight:300;margin:2px 0}#stressCard .task input{width:90px;background:#050a26;border:1px solid #4a6adf;color:#fff;border-radius:4px;padding:4px 6px;font-size:16px}
#stressCard .ok{color:#6fe7a8}#stressCard .no{color:#ff9db0}`;
  document.head.appendChild(css);
  const card = document.createElement("div"); card.id = "stressCard";
  card.innerHTML = `<b class="t">STRESS METER (EXPERIMENTAL)</b><div class="n" id="stN">--</div><div class="bar"><i id="stBar"></i></div>
   <div class="mini"><span>HEART RATE <b id="stHr">--</b></span><span>BETA/ALPHA <b id="stRa">--</b></span><span>MUSCLE <b id="stTe">--</b></span></div>
   <div class="task" id="stTask"><small id="stTaskMsg"></small><div class="q" id="stQ"></div><input id="stIn" inputmode="numeric" autocomplete="off"><span id="stFb" style="margin-left:6px"></span></div>
   <button id="stCal">Calibrate (calm, then a short task)</button><button id="stSkip" style="display:none">Skip task</button><div id="stMsg"><small>Step 1: sit still and relax with your eyes open for ${CAL_SEC} s. Step 2: a ${TASK_SEC} s arithmetic task. The meter learns which of your signals respond.</small></div>
   <small>Not a validated stress measure. EEG cannot read stress directly; this blends heart rate, frontal beta/alpha and facial tension.</small>`;
  document.body.appendChild(card);
  const $ = id => card.querySelector("#" + id), msg = $("stMsg");
  if (cfg.demo) {
    const d = document.createElement("div"); d.className = "demo";
    d.innerHTML = `<b class="t">DEMO SIGNAL (simulated headband)</b><label>Heart rate <input type="range" id="dHr" min="50" max="130" value="72"><b id="dHrV">72</b></label><label>Beta <input type="range" id="dBe" min="5" max="70" value="14"><b id="dBeV">14</b></label><label>Face tension <input type="range" id="dGa" min="2" max="60" value="6"><b id="dGaV">6</b></label>`;
    card.appendChild(d);
    [["dHr", "demoHr"], ["dBe", "demoBeta"], ["dGa", "demoGamma"]].forEach(([id, v]) => { const e = d.querySelector("#" + id); e.addEventListener("input", () => { window[v] = +e.value; d.querySelector("#" + id + "V").textContent = e.value; }); });
  }

  let phase = null, phaseT0 = 0, task = null, feat = { hr: null, ratio: null, tension: null }, lastRatio = null, noSig = 0;
  const say = (html) => { msg.innerHTML = html; };
  /* one reading per second */
  function tick() {
    if (!cfg.connected()) { feat = { hr: null, ratio: null, tension: null }; noSig = 0; if (phase) abort("Headband disconnected. Calibration cancelled."); render(); return; }
    const wins = cfg.frontalWindows(), art = cfg.artifact(), e = eegFeatures(wins, art);
    if (e.ratio != null) lastRatio = e.ratio;
    feat = { hr: cfg.heartRate(), ratio: e.ratio != null ? e.ratio : lastRatio, tension: wins.length ? e.tension : null };
    noSig = (feat.hr == null && !wins.length) ? noSig + 1 : 0;
    if (phase) {
      const len = phase === "calm" ? CAL_SEC : TASK_SEC, el = (Date.now() - phaseT0) / 1000, left = Math.max(0, len - el);
      if (el >= Math.min(8, 0.3 * len)) meter.push(feat);   // skip the first seconds: heart rate uses an 8 s window and arousal takes time to build
      if (phase === "calm") say(`<small>Step 1 of 2: stay relaxed and still... ${Math.ceil(left)} s</small>`);
      else say(`<small>Step 2 of 2: keep going, faster! ${Math.ceil(left)} s. Mistakes send you back to the start.</small>`);
      if (left <= 0) endPhase();
    } else meter.score(feat);
    render();
  }
  function startCal() { meter.startCal(); phase = "calm"; phaseT0 = Date.now(); $("stCal").disabled = true; $("stSkip").style.display = "none"; $("stTask").style.display = "none"; }
  function endPhase() {
    meter.endPhase();
    if (phase === "calm") {
      const have = Object.keys(meter.phases.calm || {});
      if (!have.length) return abort("Not enough clean signal during the calm phase. Check the headband fit and try again.");
      phase = null; $("stSkip").style.display = "inline-block"; $("stCal").textContent = "Start the task"; $("stCal").disabled = false; $("stCal").dataset.mode = "task";
      say(`<small>Calm baseline recorded (${have.map(k => COMPS[k].label.toLowerCase()).join(", ")}). Step 2: count backwards from 1022 by 13 as fast as you can. Type each answer and press Enter. Press "Start the task" when ready, or skip.</small>`);
    } else { phase = null; finishModel(); }
  }
  function startTask() {
    task = makeTask(1022, 13); phase = "stress"; phaseT0 = Date.now(); meter.startPhase("stress");
    $("stCal").disabled = true; $("stSkip").style.display = "none"; $("stTask").style.display = "block"; $("stTaskMsg").textContent = "Count backwards by 13. Type the answer, press Enter.";
    $("stQ").textContent = task.prompt() + " = ?"; $("stIn").value = ""; $("stFb").textContent = ""; $("stIn").focus();
  }
  function finishModel() {
    $("stTask").style.display = "none"; $("stCal").textContent = "Calibrate again"; $("stCal").dataset.mode = ""; $("stCal").disabled = false; $("stSkip").style.display = "none";
    if (!meter.build()) return say(`<small class="no">Calibration failed: not enough clean signal.</small>`);
    const rows = meter.report.map(r => r.status === "used" ? `<span class="ok">used</span> ${COMPS[r.key].label.toLowerCase()} (d ${r.d.toFixed(1)})` : r.status === "ignored" ? `<span class="no">ignored</span> ${COMPS[r.key].label.toLowerCase()} (d ${r.d.toFixed(1)}: did not respond)` : `<span class="no">${r.status}</span> ${COMPS[r.key].label.toLowerCase()}`).join("<br>");
    const m = meter.model;
    say(`<small>${m.mode === "two-point" ? "Ready. 20 = your calm, 80 = your level during the task." : m.weak ? "<span class='no'>The task did not change any signal for you, so the meter uses calm-baseline-only scoring (less reliable).</span>" : "Calm-baseline-only scoring (task skipped): 20 = calm, 100 = about 3 SD above."}<br>${rows}</small>`);
  }
  function abort(why) { phase = null; meter.cur = null; $("stTask").style.display = "none"; $("stCal").textContent = "Calibrate (calm, then a short task)"; $("stCal").dataset.mode = ""; $("stCal").disabled = !cfg.connected(); $("stSkip").style.display = "none"; say(`<small class="no">${why}</small>`); }
  function render() {
    const v = (cfg.connected() && noSig < 5) ? meter.value : null;
    $("stN").textContent = v == null ? "--" : Math.round(v); $("stBar").style.width = (v == null ? 0 : v) + "%";
    const z = meter.z || {}, f = k => (meter.ready() && z[k] != null) ? (z[k] >= 0 ? "+" : "") + z[k].toFixed(1) : "--";
    $("stHr").textContent = f("hr"); $("stRa").textContent = f("ratio"); $("stTe").textContent = f("tension");
    if (!phase && !$("stCal").dataset.mode) $("stCal").disabled = !cfg.connected();
    if (cfg.connected() && noSig >= 5 && !phase) say(`<small class="no">No usable signal. Check the headband fit and sensor contact.</small>`);
  }
  $("stCal").addEventListener("click", () => { if ($("stCal").dataset.mode === "task") startTask(); else startCal(); });
  $("stSkip").addEventListener("click", () => { phase = null; $("stCal").dataset.mode = ""; finishModel(); });
  $("stIn").addEventListener("keydown", e => {
    if (e.key !== "Enter" || !task) return; e.stopPropagation();
    const ok = task.answer($("stIn").value); $("stFb").textContent = ok ? "correct" : "WRONG, back to " + task.start; $("stFb").style.color = ok ? "#6fe7a8" : "#ff6b6b";
    $("stQ").textContent = task.prompt() + " = ?"; $("stIn").value = "";
  });
  card.addEventListener("keydown", e => e.stopPropagation());
  setInterval(tick, 1000);
  render();
  return { value: () => (cfg.connected() && meter.ready() && noSig < 5) ? meter.value : null, ready: () => meter.ready(), meter, task: () => task, _tick: tick, _startCal: startCal, _startTask: startTask, _skip: () => $("stSkip").click() };
}

API.attach = attach;
if (typeof module !== "undefined" && module.exports) module.exports = API;
root.Stress = API;
})(typeof window !== "undefined" ? window : globalThis);
