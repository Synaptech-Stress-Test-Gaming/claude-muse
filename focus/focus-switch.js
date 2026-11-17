/* Focus / stress / drowsy display switch, the New / Legacy engine switch, and remembered Legacy baselines.
   New (default): the numbers come from the new engine (window.EngineOut, engine/ + panel/engine-link.js): FOCUS, STRESS and (Cyton) DROWSY,
     each a within-person relative index (50 = usual for you), with a state chip (LIVE, HELD, LEARNING, --) and no calibration of any kind.
   Legacy: today's formulas, unchanged. FOCUS = ln(beta/alpha) mapped with your 10 s baselines; STRESS = 100 minus that number.
   Both are always computed, so switching is instant. Neither is a validated measure.
   Needs from the panel: $, S, focus, pctOf, renderFocus. Optional: S.mot (panel/motion.js), EngineOut, engMode (here). */
"use strict";
const MKEY = "muse2panel.focusmode", BKEY = "muse2panel.baselines", EKEY = "muse2panel.engine";
let MODE_PREF = "focus";
try { const m = localStorage.getItem(MKEY); MODE_PREF = m === "stress" || m === "drowsy" ? m : "focus"; } catch (e) {}
/* engine mode: URL ?engine=, else localStorage muse2panel.engine, else new (the validation protocol forces new) */
let engMode = "new";
try { const u = new URLSearchParams(location.search), e = u.get("engine") || localStorage.getItem(EKEY); engMode = e === "legacy" ? "legacy" : "new"; if (u.get("validate") === "1") engMode = "new"; } catch (e) {}
function engIsNew() { return engMode === "new"; }
function engDrowsyOk() { return S.dev === "cyton" && engIsNew(); }
function effMode() { return MODE_PREF === "drowsy" && !engDrowsyOk() ? "focus" : MODE_PREF; }
function shown() { return focus; }
/* the number on the big meter: New -> EngineOut[metric].value (null = "--"); Legacy -> pctOf(focus), STRESS = 100 - focus */
function focusPct() {
  const m = effMode();
  if (engIsNew()) { const o = window.EngineOut, key = m === "drowsy" ? "drowsiness" : m; if (!S.connected || !o || !o[key]) return null; const v = o[key].value; return v == null ? null : v; }
  if (S.dev === "cyton") { const L = typeof engLegacyPct === "function" ? engLegacyPct() : null; return L == null ? null : m === "stress" ? 100 - L : L; }
  const p = pctOf(focus); return p == null ? null : m === "stress" ? 100 - p : p;
}
function engMetric() { const o = window.EngineOut, m = effMode(), key = m === "drowsy" ? "drowsiness" : m; return o && o[key] ? o[key] : null; }
function motionHeld() { if (engIsNew()) { const m = engMetric(); return !!(m && (m.state === "held" || m.state === "stale")); } return !!(S.mot && S.mot.bad); }
function motionWhy() { return S.mot && S.mot.status === "NO_MOTION_DATA" ? "no motion data" : "movement"; }
function setMode(m) {
  MODE_PREF = m === "stress" || m === "drowsy" ? m : "focus";
  try { localStorage.setItem(MKEY, MODE_PREF); } catch (e) {}
  renderFocus();
}
function setEngMode(m) {
  engMode = m === "legacy" ? "legacy" : "new";
  try { localStorage.setItem(EKEY, engMode); } catch (e) {}
  document.documentElement.classList.toggle("eng-new", engIsNew());
  renderFocus();
}
/* Legacy baselines from the 10 second Auto Set Baselines are remembered for next time (browser storage, wrapped in try/catch) */
function saveBaselines() {
  try { localStorage.setItem(BKEY, JSON.stringify({ lo: focus.lo, hi: focus.hi, t: Date.now() })); } catch (e) {}
}
function loadBaselines() {
  try {
    const b = JSON.parse(localStorage.getItem(BKEY));
    if (b && isFinite(b.lo) && isFinite(b.hi) && b.hi - b.lo >= 0.05) {
      focus.lo = b.lo; focus.hi = b.hi;
      focus.result = "Using your baselines from last time (" + new Date(b.t).toLocaleDateString() + "). Press Auto Set Baselines to redo them.";
    }
  } catch (e) {}
}
const ENG_NOTES = {
  focus: { cyton: "Relative to your usual. Not a validated measure.", muse: "4 sensors: weaker. Relative to your usual." },
  stress: "Measures arousal (excitement looks the same).",
  drowsy: "Slow trend, minutes of lag.", drowsyLearning: "Needs 10 min of history."
};
function engChipText(m) {
  if (!m) return "--";
  if (m.state === "live") return "LIVE";
  if (m.state === "held") return "HELD · " + (m.reason || "");
  if (m.state === "learning") return "LEARNING";
  return "--";
}
/* buttons, title, badge and the note under the title. Called from renderFocus(). */
function renderFocusSwitch() {
  const md = effMode(), st = md === "stress", dr = md === "drowsy", isNew = engIsNew();
  const fD = $("fmD"); if (fD) { fD.style.display = engDrowsyOk() ? "" : "none"; fD.classList.toggle("on", dr); fD.setAttribute("aria-checked", dr ? "true" : "false"); }
  $("fmode").classList.toggle("three", engDrowsyOk());
  $("fmF").classList.toggle("on", md === "focus"); $("fmS").classList.toggle("on", st);
  $("fmF").setAttribute("aria-checked", md === "focus" ? "true" : "false"); $("fmS").setAttribute("aria-checked", st ? "true" : "false");
  $("fmF").title = isNew ? "Focus: frontal theta up, posterior alpha down, relative to your usual (not a validated measure)" : "Show the Legacy focus meter (a rough proxy, not a validated measure)";
  $("fmS").title = isNew ? "Stress: heart rate, heart-rate variability and alpha; measures arousal" : "Show Legacy stress = 100 minus focus (a rough proxy, not a validated measure)";
  $("fname").textContent = dr ? "DROWSY" : st ? "STRESS" : "FOCUS";
  const fn = $("fnote"); fn.textContent = "";
  if (isNew) {
    const m = engMetric();
    let note;
    if (!S.connected) note = "Connect to use " + (dr ? "drowsiness" : st ? "stress" : "focus");
    else if (!m) note = "Starting…";
    else if (m.state === "stale" || m.state === "unavailable") note = "-- " + (m.reason || "no reading");
    else if (dr) note = m.state === "learning" ? ENG_NOTES.drowsyLearning : ENG_NOTES.drowsy;
    else if (st) note = ENG_NOTES.stress;
    else note = ENG_NOTES.focus[S.dev === "cyton" ? "cyton" : "muse"];
    if (S.connected && m && m.state !== "stale" && m.state !== "unavailable") { const b = document.createElement("b"); b.id = "cstat"; b.className = m.state === "held" ? "hold" : m.state === "learning" ? "learn" : "live"; b.textContent = engChipText(m); fn.appendChild(b); }
    else if (S.connected && m && dr && m.state === "learning") { const b = document.createElement("b"); b.id = "cstat"; b.className = "learn"; b.textContent = "LEARNING"; fn.appendChild(b); }
    fn.appendChild(document.createTextNode(note));
    return;
  }
  let note;
  if (S.dev === "cyton" && typeof engLegacyNote === "function") note = engLegacyNote(st);
  else if (focus.cal) note = focus.cal.msg();
  else if (!S.connected) note = "Connect to use " + (st ? "stress" : "focus");
  else if (S.usable === 0) note = "No sensor contact";
  else if (focus.lo == null || focus.hi == null) note = focus.result || "Press the button to set baselines";
  else note = focus.result || "Baselines set. " + (st ? "Stress" : "Focus") + " is live.";
  if (S.dev !== "cyton" && st && focus.lo != null && S.connected) note += " Stress = 100 minus focus.";
  if (S.mot && S.mot.bad && S.dev !== "cyton") { const b = document.createElement("b"); b.id = "cstat"; b.className = "hold"; b.textContent = "HELD · " + motionWhy(); fn.appendChild(b); }
  fn.appendChild(document.createTextNode(note));
}
function initFocusSwitch() {
  $("fmF").addEventListener("click", () => setMode("focus"));
  $("fmS").addEventListener("click", () => setMode("stress"));
  if (!$("fmD")) { const b = document.createElement("button"); b.type = "button"; b.id = "fmD"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", "false"); b.textContent = "DROWSY";
    b.title = "Drowsiness (Cyton): a slow trend with minutes of lag; needs 10 min of history"; $("fmode").appendChild(b); }
  $("fmD").addEventListener("click", () => setMode("drowsy"));
  document.documentElement.classList.toggle("eng-new", engIsNew());
}
