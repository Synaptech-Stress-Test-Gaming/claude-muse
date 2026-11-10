/* Focus / stress display switch and remembered baselines.
   FOCUS shows the focus meter (ln(beta/alpha), mapped to 0-100 with your baselines). STRESS shows 100 minus that number
   (focus 100 = stress 0, focus 0 = stress 100). Both use the same baselines. External games and the game menu always get the FOCUS number.
   Both are rough proxies, not validated measures. The muscle-corrected score is parked in focus/experimental/ and is not loaded.
   Needs from the panel: $, S, focus, pctOf, renderFocus. Optional: S.mot (panel/motion.js). */
"use strict";
const MKEY = "muse2panel.focusmode", BKEY = "muse2panel.baselines";
let MODE_PREF = "focus";
try { MODE_PREF = localStorage.getItem(MKEY) === "stress" ? "stress" : "focus"; } catch (e) {}
function effMode() { return MODE_PREF; }
function shown() { return focus; }
function focusPct() { const p = pctOf(focus); return p == null ? null : MODE_PREF === "stress" ? 100 - p : p; }
function motionHeld() { return !!(S.mot && S.mot.bad); }
function motionWhy() { return S.mot && S.mot.status === "NO_MOTION_DATA" ? "no motion data" : "movement"; }
function setMode(m) {
  MODE_PREF = m === "stress" ? "stress" : "focus";
  try { localStorage.setItem(MKEY, MODE_PREF); } catch (e) {}
  renderFocus();
}
/* baselines from the 10 second Auto Set Baselines are remembered for next time (browser storage, wrapped in try/catch) */
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
/* buttons, title, movement badge and the note under the title. Called from renderFocus(). */
function renderFocusSwitch() {
  const st = MODE_PREF === "stress";
  $("fmF").classList.toggle("on", !st); $("fmS").classList.toggle("on", st);
  $("fmF").setAttribute("aria-checked", st ? "false" : "true"); $("fmS").setAttribute("aria-checked", st ? "true" : "false");
  $("fmF").title = "Show the focus meter (a rough proxy, not a validated measure)";
  $("fmS").title = "Show stress = 100 minus focus (a rough proxy, not a validated measure)";
  $("fname").textContent = st ? "STRESS" : "FOCUS";
  let note;
  if (focus.cal) note = focus.cal.msg();
  else if (!S.connected) note = "Connect to use " + (st ? "stress" : "focus");
  else if (S.usable === 0) note = "No sensor contact";
  else if (focus.lo == null || focus.hi == null) note = focus.result || "Press the button to set baselines";
  else note = focus.result || "Baselines set. " + (st ? "Stress" : "Focus") + " is live.";
  if (st && focus.lo != null && S.connected) note += " Stress = 100 minus focus.";
  const fn = $("fnote"); fn.textContent = "";
  if (motionHeld()) { const b = document.createElement("b"); b.id = "cstat"; b.className = "hold"; b.textContent = "HELD \u00b7 " + motionWhy(); fn.appendChild(b); }
  fn.appendChild(document.createTextNode(note));
}
function initFocusSwitch() {
  $("fmF").addEventListener("click", () => setMode("focus"));
  $("fmS").addEventListener("click", () => setMode("stress"));
}
