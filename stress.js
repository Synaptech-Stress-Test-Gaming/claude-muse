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
/* dir = expected direction under stress (+1 up, -1 down, 0 unknown). twoSided signals may be used if they move either way
   for this person (literature on frontal asymmetry and beta/alpha is mixed). */
const COMPS = {
  hr: { w: 0.40, minSd: 3.0, label: "HEART RATE", dir: 1 },
  hrv: { w: 0.40, minSd: 8.0, label: "HRV (RMSSD)", dir: -1, twoSided: true },
  ratio: { w: 0.35, minSd: 0.15, label: "BETA/ALPHA", dir: 1, twoSided: true },
  tension: { w: 0.25, minSd: 0.15, label: "MUSCLE TENSION", dir: 1 },
  faa: { w: 0.20, minSd: 0.10, label: "FRONTAL ASYMMETRY", dir: 0, twoSided: true }
};
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

/* Frontal alpha asymmetry: ln(alpha AF8) - ln(alpha AF7). Windows are 512-sample arrays. */
function faa(w7, w8) { const eps = 1e-6; return Math.log(bandPowers(w8).alpha + eps) - Math.log(bandPowers(w7).alpha + eps); }

/* ---------- heart rate variability from the pulse signal ---------- */
/* x: band-passed pulse samples (NaN = missing). Returns beat positions in samples (fractional), min spacing 0.35 s. */
function findBeats(x, fs) {
  const n = x.length, minDist = Math.round(0.35 * fs), beats = [];
  let sum = 0, cnt = 0; for (let i = 0; i < n; i++) if (x[i] === x[i]) { sum += x[i] * x[i]; cnt++; }
  if (cnt < fs * 3) return beats;
  const thr = 0.35 * Math.sqrt(sum / cnt);
  for (let i = 1; i < n - 1; i++) {
    const a = x[i - 1], b = x[i], c = x[i + 1];
    if (!(a === a && b === b && c === c) || b < thr || b < a || b <= c) continue;
    const den = a - 2 * b + c, off = den < 0 ? 0.5 * (a - c) / den : 0, pos = i + off;
    if (beats.length && pos - beats[beats.length - 1] < minDist) { if (b > x[Math.round(beats[beats.length - 1])]) beats[beats.length - 1] = pos; continue; }
    beats.push(pos);
  }
  return beats;
}
/* Inter-beat intervals (ms) from beat times in seconds; drops impossible intervals and jumps (missed or extra beats). */
function ibisFromBeats(times) {
  const out = [];
  for (let i = 1; i < times.length; i++) {
    const ms = (times[i] - times[i - 1]) * 1000;
    if (ms < 400 || ms > 1500) continue;
    const prev = out.length ? out[out.length - 1] : null;
    if (prev != null && Math.abs(ms - prev) > 0.3 * prev) continue;
    out.push(ms);
  }
  return out;
}
/* RMSSD in ms from successive differences (needs >= 15 intervals); null otherwise. */
function rmssd(ibis) {
  if (ibis.length < 15) return null;
  let s = 0; for (let i = 1; i < ibis.length; i++) { const d = ibis[i] - ibis[i - 1]; s += d * d; }
  return Math.sqrt(s / (ibis.length - 1));
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
  M.startPhase = name => { M.cur = { name, s: Object.fromEntries(KEYS.map(k => [k, []])) }; };
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
      if (COMPS[k].dir) one[k] = { mc: calm[k].m, sd: calm[k].sd, w: COMPS[k].w, dir: COMPS[k].dir };
      const s = task && task[k];
      if (!s) { M.report.push({ key: k, status: task ? "no data in task" : "calm only" }); return; }
      const d = (s.m - calm[k].m) / Math.sqrt((calm[k].sd * calm[k].sd + s.sd * s.sd) / 2);
      if ((COMPS[k].twoSided ? Math.abs(d) : d) >= MIN_D) { two[k] = { mc: calm[k].m, ms: s.m, w: Math.min(Math.abs(d), 3) }; M.report.push({ key: k, status: "used", d, inverse: d < 0 && COMPS[k].dir > 0 || d > 0 && COMPS[k].dir < 0 }); }
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
      const v = two ? Math.max(-0.5, Math.min(1.5, (f[k] - c.mc) / (c.ms - c.mc))) : Math.max(-4, Math.min(4, c.dir * (f[k] - c.mc) / c.sd));
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

const API = { fft, bandPowers, eegFeatures, faa, findBeats, ibisFromBeats, rmssd, makeMeter, makeTask, COMPS, FS, WIN, MIN_D };

/* ---------- panel attachment (browser only) ---------- */
const TICK_MS = 250;                 // score updates 4 times per second
function attach(cfg) {
  const CAL_SEC = +(cfg.calSec || 30), TASK_SEC = +(cfg.taskSec || CAL_SEC), meter = makeMeter({ minSamples: Math.min(10, Math.floor(CAL_SEC / 2)), ema: 0.3 });
  const css = document.createElement("style");
  css.textContent = `#stressCard{position:fixed;left:12px;bottom:12px;width:300px;z-index:50;background:rgba(5,10,40,.92);border:1px solid rgba(110,150,255,.6);border-radius:10px;padding:10px 12px;color:#e9f1ff;font:12px "Segoe UI",system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.5)}
#stressCard .hd{display:flex;justify-content:space-between;align-items:center}#stressCard b.t{letter-spacing:.2em;font-size:10px;color:#9fb2e6}
#stressCard .st{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.14em;font-weight:700;margin:2px 0 6px}#stressCard .st i{width:9px;height:9px;border-radius:50%;background:#6a7391}
#stressCard .row{display:flex;align-items:flex-end;gap:10px}#stressCard .n{font-size:40px;font-weight:300;line-height:1;min-width:74px}
#stressCard canvas{flex:1;height:46px;background:#050a26;border-radius:4px;box-shadow:inset 0 0 0 1px #2d3c6a}
#stressCard .bar{height:12px;border-radius:3px;background:#050a26;box-shadow:inset 0 0 0 1px #2d3c6a;overflow:hidden;margin:5px 0 6px}
#stressCard .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3fd6ff,#ffd166 60%,#ff453a);transition:width .2s}
#stressCard .sig{display:grid;grid-template-columns:10px 1fr 64px 42px;gap:6px;align-items:center;font-size:10px;letter-spacing:.06em;color:#9fb2e6;margin-top:3px}
#stressCard .sig i{width:8px;height:8px;border-radius:50%;background:#3a4166}#stressCard .sig i.on{background:#43f28a;box-shadow:0 0 6px #43f28a}#stressCard .sig .m{height:6px;background:#050a26;border-radius:3px;overflow:hidden;box-shadow:inset 0 0 0 1px #2d3c6a}
#stressCard .sig .m u{display:block;height:100%;width:0;background:#6fa8ff;text-decoration:none;transition:width .2s}#stressCard .sig b{font-weight:400;color:#dfe8ff;text-align:right}#stressCard .sig em{font-style:normal;text-align:right;color:#7f93c9}
#stressCard button{background:#16215a;border:1px solid #4a6adf;color:#e9f1ff;border-radius:5px;padding:5px 10px;font-size:11px;cursor:pointer;margin:6px 6px 0 0}#stressCard button:disabled{opacity:.45;cursor:default}
#stressCard small{display:block;color:#7f93c9;line-height:1.4;margin-top:6px;font-size:10px}#stressCard .demo{margin-top:6px;border-top:1px solid #2d3c6a;padding-top:6px}#stressCard .demo label{display:flex;justify-content:space-between;gap:8px;align-items:center;color:#9fb2e6}
#stressCard .task{display:none;margin-top:6px}#stressCard .task .q{font-size:22px;font-weight:300;margin:2px 0}#stressCard .task input{width:90px;background:#050a26;border:1px solid #4a6adf;color:#fff;border-radius:4px;padding:4px 6px;font-size:16px}
#stressCard .ok{color:#6fe7a8}#stressCard .no{color:#ff9db0}#stressCard .tg{background:none;border:0;color:#9fb2e6;cursor:pointer;font-size:12px;padding:0 2px;margin:0}#stressCard.min>*:not(.hd):not(.st):not(.row){display:none}`;
  document.head.appendChild(css);
  const card = document.createElement("div"); card.id = "stressCard";
  const sigRows = KEYS.map(k => `<div class="sig" data-k="${k}"><i></i><span>${COMPS[k].label}</span><span class="m"><u></u></span><em>--</em></div>`).join("");
  card.innerHTML = `<div class="hd"><b class="t">STRESS METER (EXPERIMENTAL)</b><button class="tg" id="stTg" title="Collapse">&#9662;</button></div><div class="st"><i id="stDot"></i><span id="stState">NOT CALIBRATED</span></div>
   <div class="row"><div class="n" id="stN">--</div><canvas id="stCv" width="400" height="92"></canvas></div><div class="bar"><i id="stBar"></i></div>
   ${sigRows}
   <div class="task" id="stTask"><small id="stTaskMsg"></small><div class="q" id="stQ"></div><input id="stIn" inputmode="numeric" autocomplete="off"><span id="stFb" style="margin-left:6px"></span></div>
   <button id="stCal">Calibrate (calm, then a short task)</button><button id="stSkip" style="display:none">Skip task</button><div id="stMsg"></div>
   <small id="stHint">Quick check: clench your jaw (muscle tension jumps), hold a slow breath, then do mental arithmetic. Green dots = that signal is arriving; bars = how far each has moved from your calm level.</small>
   <small>Not a validated stress measure. EEG cannot read stress directly.</small>`;
  document.body.appendChild(card);
  const $ = id => card.querySelector("#" + id), msg = $("stMsg"), cv = $("stCv"), g = cv.getContext("2d");
  $("stTg").addEventListener("click", () => { card.classList.toggle("min"); $("stTg").innerHTML = card.classList.contains("min") ? "&#9656;" : "&#9662;"; });
  if (cfg.demo) {
    const d = document.createElement("div"); d.className = "demo";
    d.innerHTML = `<b class="t">DEMO SIGNAL (simulated headband)</b><label>Heart rate <input type="range" id="dHr" min="50" max="130" value="72"><b id="dHrV">72</b></label><label>Beta <input type="range" id="dBe" min="5" max="70" value="14"><b id="dBeV">14</b></label><label>Face tension <input type="range" id="dGa" min="2" max="60" value="6"><b id="dGaV">6</b></label>`;
    card.appendChild(d);
    [["dHr", "demoHr"], ["dBe", "demoBeta"], ["dGa", "demoGamma"]].forEach(([id, v]) => { const e = d.querySelector("#" + id); e.addEventListener("input", () => { window[v] = +e.value; d.querySelector("#" + id + "V").textContent = e.value; }); });
  }

  const DEFAULT_MSG = `<small>Step 1: sit still and relax with your eyes open for ${CAL_SEC} s. Step 2: a ${TASK_SEC} s arithmetic task. The meter learns which of your signals respond.</small>`;
  let noSigMsg = false, phase = null, phaseT0 = 0, task = null, feat = {}, lastRatio = null, lastSigAt = Date.now(), lastPush = 0, tickN = 0;
  let beats = [], absPos = 0, lastPos = null, lastFilled = 0, hist = [], lastArt = 0;
  const say = html => { msg.innerHTML = html; noSigMsg = false; };
  say(DEFAULT_MSG);

  /* HRV and a fast heart rate from the pulse ring buffer. Beat times use the sample position (device clock), not arrival time, so packet jitter does not leak in. */
  function pulse() {
    const w = cfg.ppgWindow ? cfg.ppgWindow() : null;
    if (!w) { beats = []; lastPos = null; return { hr: null, hrv: null }; }
    if (lastPos == null || w.filled < lastFilled) { beats = []; absPos = 0; }
    else absPos += (w.pos - lastPos + w.len) % w.len;
    lastPos = w.pos; lastFilled = w.filled;
    const found = findBeats(w.x, w.fs), n = w.x.length;
    found.forEach(p => { const t = (absPos - (n - 1 - p)) / w.fs; if (!beats.length || t > beats[beats.length - 1] + 0.35) beats.push(t); });
    const tEnd = absPos / w.fs; beats = beats.filter(t => t > tEnd - 45);
    const recent = ibisFromBeats(beats.filter(t => t > tEnd - 8)), hrFast = recent.length >= 4 ? 60000 / (recent.slice(-6).reduce((a, b) => a + b, 0) / recent.slice(-6).length) : null;
    return { hr: hrFast, hrv: rmssd(ibisFromBeats(beats.filter(t => t > tEnd - 30))) };
  }

  function tick() {
    tickN++;
    if (!cfg.connected()) { feat = {}; beats = []; lastPos = null; if (phase) abort("Headband disconnected. Calibration cancelled."); render(); return; }
    const wins = cfg.frontalWindows(), art = cfg.artifact(); if (art) lastArt = Date.now();
    const e = eegFeatures(wins, art); if (e.ratio != null) lastRatio = e.ratio;
    const pu = pulse();
    feat = { hr: pu.hr != null ? pu.hr : cfg.heartRate(), hrv: pu.hrv, ratio: e.ratio != null ? e.ratio : lastRatio, tension: wins.length ? e.tension : null,
      faa: (!art && wins.af7 && wins.af8) ? faa(wins.af7, wins.af8) : null };
    if (feat.hr != null || wins.length) lastSigAt = Date.now();
    const sec = Date.now(), oneHz = sec - lastPush >= 1000; if (oneHz) lastPush = sec;
    if (phase) {
      const len = phase === "calm" ? CAL_SEC : TASK_SEC, el = (sec - phaseT0) / 1000, left = Math.max(0, len - el);
      if (oneHz && el >= Math.min(8, 0.3 * len)) meter.push(feat);   // skip the first seconds: heart rate needs a few beats and arousal takes time to build
      if (phase === "calm") say(`<small>Step 1 of 2: stay relaxed and still... ${Math.ceil(left)} s</small>`);
      else say(`<small>Step 2 of 2: keep going, faster! ${Math.ceil(left)} s. Mistakes send you back to the start.</small>`);
      if (left <= 0) endPhase();
    } else { meter.score(feat); if (meter.value != null) { hist.push(meter.value); if (hist.length > 240) hist.shift(); } }
    render();
  }
  function startCal() { meter.startCal(); phase = "calm"; phaseT0 = Date.now(); hist = []; $("stCal").disabled = true; $("stSkip").style.display = "none"; $("stTask").style.display = "none"; }
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
    const rows = meter.report.map(r => r.status === "used" ? `<span class="ok">used</span> ${COMPS[r.key].label.toLowerCase()} (d ${r.d.toFixed(1)}${r.inverse ? ", moves opposite to the usual direction" : ""})` : r.status === "ignored" ? `<span class="no">ignored</span> ${COMPS[r.key].label.toLowerCase()} (d ${r.d.toFixed(1)}: did not respond)` : `<span class="no">${r.status}</span> ${COMPS[r.key].label.toLowerCase()}`).join("<br>");
    const m = meter.model;
    say(`<small>${m.mode === "two-point" ? "Ready. 20 = your calm, 80 = your level during the task." : m.weak ? "<span class='no'>The task did not change any signal for you, so the meter uses calm-baseline-only scoring (less reliable).</span>" : "Calm-baseline-only scoring (task skipped): 20 = calm, 100 = about 3 SD above."}<br>${rows}</small>`);
  }
  function abort(why) { phase = null; meter.cur = null; $("stTask").style.display = "none"; $("stCal").textContent = "Calibrate (calm, then a short task)"; $("stCal").dataset.mode = ""; $("stCal").disabled = !cfg.connected(); $("stSkip").style.display = "none"; say(`<small class="no">${why}</small>`); }

  function status() {
    if (!cfg.connected()) return ["NO HEADBAND", "#6a7391"];
    if (Date.now() - lastSigAt > 5000) return ["NO SIGNAL", "#ff453a"];
    if (phase) return ["CALIBRATING", "#4da3ff"];
    if (!meter.ready()) return ["NOT CALIBRATED", "#ffd166"];
    return ["LIVE", "#43f28a"];
  }
  function drawSpark() {
    const W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
    g.strokeStyle = "rgba(110,150,255,.25)"; g.lineWidth = 1; g.beginPath(); [20, 50, 80].forEach(v => { const y = H - v / 100 * H; g.moveTo(0, y); g.lineTo(W, y); }); g.stroke();
    if (hist.length < 2) return;
    g.strokeStyle = "#ffd166"; g.lineWidth = 2; g.beginPath();
    hist.forEach((v, i) => { const x = W - (hist.length - 1 - i) / 240 * W, y = H - Math.max(0, Math.min(100, v)) / 100 * H; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  }
  function render() {
    const [stateTxt, col] = status(), live = stateTxt === "LIVE";
    $("stState").textContent = stateTxt; $("stState").style.color = col; $("stDot").style.background = col; $("stDot").style.boxShadow = live && tickN % 2 ? `0 0 8px ${col}` : "none";
    const v = (cfg.connected() && live) ? meter.value : null;
    $("stN").textContent = v == null ? "--" : Math.round(v); $("stBar").style.width = (v == null ? 0 : v) + "%";
    const z = meter.z || {}, used = {}; (meter.report || []).forEach(r => used[r.key] = r);
    card.querySelectorAll(".sig").forEach(row => {
      const k = row.dataset.k, have = feat[k] != null && isFinite(feat[k]) && cfg.connected(), pos = (meter.ready() && z[k] != null) ? z[k] : null;
      row.querySelector("i").className = have ? "on" : "";
      const two = meter.model && meter.model.mode === "two-point", u = row.querySelector("u");
      u.style.width = pos == null ? "0" : Math.max(0, Math.min(100, (two ? pos : (pos + 1) / 4) * (two ? 66 : 100))) + "%";
      const r = used[k], em = row.querySelector("em"); em.textContent = !meter.ready() ? (have ? "live" : "--") : !r ? "--" : r.status === "used" ? "used" : r.status === "ignored" ? "ignored" : "no data";
      em.style.color = r && r.status === "used" ? "#6fe7a8" : r && r.status === "ignored" ? "#ff9db0" : "#7f93c9";
    });
    drawSpark();
    if (!phase && !$("stCal").dataset.mode) $("stCal").disabled = !cfg.connected();
    if (cfg.connected() && stateTxt === "NO SIGNAL" && !phase) { say(`<small class="no">No usable signal for 5 s. Check the headband fit and sensor contact.</small>`); noSigMsg = true; }
    else if (noSigMsg) say(meter.ready() ? `<small>Signal is back.</small>` : DEFAULT_MSG);
  }
  $("stCal").addEventListener("click", () => { if ($("stCal").dataset.mode === "task") startTask(); else startCal(); });
  $("stSkip").addEventListener("click", () => { phase = null; $("stCal").dataset.mode = ""; finishModel(); });
  $("stIn").addEventListener("keydown", e => {
    if (e.key !== "Enter" || !task) return; e.stopPropagation();
    const ok = task.answer($("stIn").value); $("stFb").textContent = ok ? "correct" : "WRONG, back to " + task.start; $("stFb").style.color = ok ? "#6fe7a8" : "#ff6b6b";
    $("stQ").textContent = task.prompt() + " = ?"; $("stIn").value = "";
  });
  card.addEventListener("keydown", e => e.stopPropagation());
  setInterval(tick, TICK_MS);
  render();
  return { value: () => (cfg.connected() && meter.ready() && Date.now() - lastSigAt <= 5000) ? meter.value : null, ready: () => meter.ready(), meter, task: () => task, _tick: tick, _startCal: startCal, _startTask: startTask, _skip: () => $("stSkip").click(), _feat: () => feat };
}

API.attach = attach;
if (typeof module !== "undefined" && module.exports) module.exports = API;
root.Stress = API;
})(typeof window !== "undefined" ? window : globalThis);
