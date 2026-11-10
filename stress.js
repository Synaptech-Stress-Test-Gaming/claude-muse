/* Experimental stress meter for the Muse 2 panel.
   NOT a validated stress measure. EEG cannot read stress directly. This combines three signals that tend to move with
   arousal and compares each one with YOUR OWN calm baseline:
     - heart rate (pulse sensor)            higher than your calm rate -> more arousal
     - frontal beta / alpha (AF7 + AF8)     higher than your calm ratio -> more arousal
     - facial muscle tension (30-44 Hz on the forehead sensors; clenching, frowning)
   Score: 20 = your calm baseline, 100 = about 3 standard deviations above it (0 = well below it).
   Core maths (no DOM) is testable: see stress.test.js. */
"use strict";
(function (root) {

const FS = 256, WIN = 512;
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

/* ---------- baseline and score ---------- */
function stats(a) { const m = a.reduce((s, v) => s + v, 0) / a.length; const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length); return { m, sd }; }
function makeMeter(cfg) {
  cfg = cfg || {};
  const calMin = cfg.minSamples || 10, ema = cfg.ema || 0.25;
  const M = { base: null, cal: null, value: null, z: {}, used: [] };
  M.startCal = () => { M.cal = { s: { hr: [], ratio: [], tension: [] } }; };
  M.push = f => { if (!M.cal) return; KEYS.forEach(k => { if (f[k] != null && isFinite(f[k])) M.cal.s[k].push(f[k]); }); };
  /* returns true when a usable baseline was made (at least one signal with enough samples) */
  M.finishCal = () => {
    const c = M.cal; M.cal = null; if (!c) return false;
    const base = {}; KEYS.forEach(k => { if (c.s[k].length >= calMin) { const st = stats(c.s[k]); base[k] = { m: st.m, sd: Math.max(st.sd, COMPS[k].minSd), n: c.s[k].length }; } });
    if (!Object.keys(base).length) return false;
    M.base = base; M.value = null; return true;
  };
  M.calCount = () => M.cal ? Math.max(...KEYS.map(k => M.cal.s[k].length)) : 0;
  M.ready = () => !!M.base;
  M.score = f => {
    if (!M.base) return null;
    let wsum = 0, zsum = 0; M.used = []; M.z = {};
    KEYS.forEach(k => { if (M.base[k] && f[k] != null && isFinite(f[k])) { const z = Math.max(-4, Math.min(4, (f[k] - M.base[k].m) / M.base[k].sd)); M.z[k] = z; zsum += COMPS[k].w * z; wsum += COMPS[k].w; M.used.push(k); } });
    if (!wsum) return M.value;
    const raw = Math.max(0, Math.min(100, 20 + 80 * (zsum / wsum) / 3));
    M.value = M.value == null ? raw : M.value + ema * (raw - M.value);
    return M.value;
  };
  return M;
}

const API = { fft, bandPowers, eegFeatures, makeMeter, COMPS, FS, WIN };

/* ---------- panel attachment (browser only) ---------- */
function attach(cfg) {
  const CAL_SEC = +(cfg.calSec || 30), meter = makeMeter({ minSamples: Math.min(10, Math.floor(CAL_SEC / 2)) });
  const css = document.createElement("style");
  css.textContent = `#stressCard{position:fixed;left:12px;bottom:12px;width:270px;z-index:50;background:rgba(5,10,40,.88);border:1px solid rgba(110,150,255,.6);border-radius:10px;padding:10px 12px;color:#e9f1ff;font:12px "Segoe UI",system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.5)}
#stressCard b.t{letter-spacing:.22em;font-size:10px;color:#9fb2e6}#stressCard .n{font-size:34px;font-weight:300;line-height:1.1}#stressCard .bar{height:12px;border-radius:3px;background:#050a26;box-shadow:inset 0 0 0 1px #2d3c6a;overflow:hidden;margin:3px 0 6px}
#stressCard .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3fd6ff,#ffd166 60%,#ff453a)}#stressCard .mini{display:flex;justify-content:space-between;color:#9fb2e6;font-size:10px;letter-spacing:.08em;margin-top:2px}
#stressCard button{background:#16215a;border:1px solid #4a6adf;color:#e9f1ff;border-radius:5px;padding:5px 10px;font-size:11px;cursor:pointer;margin-top:6px}#stressCard button:disabled{opacity:.45;cursor:default}
#stressCard small{display:block;color:#7f93c9;line-height:1.35;margin-top:6px;font-size:10px}#stressCard .demo{margin-top:6px;border-top:1px solid #2d3c6a;padding-top:6px}#stressCard .demo label{display:flex;justify-content:space-between;gap:8px;align-items:center;color:#9fb2e6}`;
  document.head.appendChild(css);
  const card = document.createElement("div"); card.id = "stressCard";
  card.innerHTML = `<b class="t">STRESS METER (EXPERIMENTAL)</b><div class="n" id="stN">--</div><div class="bar"><i id="stBar"></i></div>
   <div class="mini"><span>HEART RATE <b id="stHr">--</b></span><span>BETA/ALPHA <b id="stRa">--</b></span><span>MUSCLE <b id="stTe">--</b></span></div>
   <button id="stCal">Calibrate calm (${CAL_SEC} s)</button><div id="stMsg"><small>Sit still and relax with your eyes open, then press Calibrate. The meter compares you with your own calm baseline.</small></div>
   <small>Not a validated stress measure. EEG cannot read stress directly; this blends heart rate, frontal beta/alpha and facial tension.</small>`;
  document.body.appendChild(card);
  const $ = id => card.querySelector("#" + id), msg = $("stMsg");
  if (cfg.demo) {
    const d = document.createElement("div"); d.className = "demo";
    d.innerHTML = `<b class="t">DEMO SIGNAL (simulated headband)</b><label>Heart rate <input type="range" id="dHr" min="50" max="130" value="72"><b id="dHrV">72</b></label><label>Beta <input type="range" id="dBe" min="5" max="70" value="14"><b id="dBeV">14</b></label><label>Face tension <input type="range" id="dGa" min="2" max="60" value="6"><b id="dGaV">6</b></label>`;
    card.appendChild(d);
    [["dHr", "demoHr"], ["dBe", "demoBeta"], ["dGa", "demoGamma"]].forEach(([id, v]) => { const e = d.querySelector("#" + id); e.addEventListener("input", () => { window[v] = +e.value; d.querySelector("#" + id + "V").textContent = e.value; }); });
  }

  let calT0 = 0, calTimer = null, feat = { hr: null, ratio: null, tension: null }, lastRatio = null;
  /* one reading per second */
  function tick() {
    const live = cfg.connected();
    if (!live) { feat = { hr: null, ratio: null, tension: null }; render(); return; }
    const wins = cfg.frontalWindows(), art = cfg.artifact(), e = eegFeatures(wins, art);
    if (e.ratio != null) lastRatio = e.ratio;
    feat = { hr: cfg.heartRate(), ratio: e.ratio != null ? e.ratio : lastRatio, tension: wins.length ? e.tension : null };
    if (meter.cal) {
      meter.push(feat);
      const left = Math.max(0, CAL_SEC - (Date.now() - calT0) / 1000);
      msg.innerHTML = `<small>Calibrating... ${Math.ceil(left)} s. Stay relaxed and still.</small>`;
      if (left <= 0) finishCal();
    } else meter.score(feat);
    render();
  }
  function finishCal() {
    $("stCal").disabled = false;
    const ok = meter.finishCal(), b = meter.base;
    msg.innerHTML = ok ? `<small>Baseline set from: ${Object.keys(b).map(k => COMPS[k].label.toLowerCase()).join(", ")}${b.hr ? "" : ". No heart rate was available, so heart rate is not used"}.</small>` : `<small style="color:#ff9db0">Not enough clean signal. Check the sensors and try again.</small>`;
  }
  function render() {
    const v = meter.value;
    $("stN").textContent = v == null ? "--" : Math.round(v); $("stBar").style.width = (v == null ? 0 : v) + "%";
    const z = meter.z || {}, f = k => (meter.ready() && z[k] != null) ? (z[k] >= 0 ? "+" : "") + z[k].toFixed(1) : "--";
    $("stHr").textContent = f("hr"); $("stRa").textContent = f("ratio"); $("stTe").textContent = f("tension");
    $("stCal").disabled = !cfg.connected() || !!meter.cal;
  }
  $("stCal").addEventListener("click", () => { meter.startCal(); calT0 = Date.now(); $("stCal").disabled = true; });
  setInterval(tick, 1000);
  render();
  return { value: () => (cfg.connected() && meter.ready()) ? meter.value : null, ready: () => meter.ready(), meter, _tick: tick };
}

API.attach = attach;
if (typeof module !== "undefined" && module.exports) module.exports = API;
root.Stress = API;
})(typeof window !== "undefined" ? window : globalThis);
