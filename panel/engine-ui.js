/* panel/engine-ui.js
   DOM for the new engine: device selector, New/Legacy switch, profile panel, engine card, Cyton card, help.
   Classic script: top-level names start with eng / Eng. Loaded before panel/engine-link.js. */
"use strict";
const EngUI = { built: false };
function engUiBuild() {
  if (EngUI.built) return; EngUI.built = true;
  const st = $("stage");
  const ds = document.createElement("div"); ds.id = "devSel"; ds.setAttribute("role", "radiogroup"); ds.setAttribute("aria-label", "Device");
  ds.innerHTML = '<button type="button" role="radio" data-dev="muse">MUSE</button><button type="button" role="radio" data-dev="cyton">CYTON</button>';
  st.appendChild(ds);
  ds.querySelectorAll("button").forEach(b => b.addEventListener("click", () => engSetDevice(b.dataset.dev)));
  engUiDevice();
}
function engUiDevice() {
  const ds = $("devSel"); if (!ds) return;
  ds.querySelectorAll("button").forEach(b => { const on = b.dataset.dev === S.dev; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); b.disabled = S.connected || S.connecting; });
  document.documentElement.dataset.dev = S.dev;
}
function engUiHelperMsg(m) {}
engUiBuild();
setInterval(engUiDevice, 500);
