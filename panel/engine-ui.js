/* panel/engine-ui.js
   DOM for the new engine: device selector (#devSel), New/Legacy switch (#engSw), profile panel (#engProf, in the Auto-baselines slot),
   engine card (#engCard, bottom left), the "?" help with the honest limits, and the Cyton versions of the panel's own places:
   the header contact strip (#cySens: 16 tiles), the raw view (#cyRaw: the 16 channel slots with contact and RMS, Check contact; the F7 slot carries the ECG, which is shown only in the Heart Rate box),
   the status line under the status pill (helper state, button flashes), the rate line and the heart-rate card (ECG).
   Classic script: top-level names start with eng / Eng. Loaded before panel/engine-link.js. */
"use strict";
const EngUI = { built: false, flash: {}, lastHelperMsg: null };
const ENG_LIMITS = [
  "The scores are relative to your own usual level (50 = usual for you). They are not absolute and cannot be compared between people.",
  "Focus and stress are not validated measures.",
  "Muse focus is weak: 4 sensors, none over the top of the head.",
  "STRESS measures physiological arousal. Excitement, effort and caffeine look the same.",
  "While you move, talk, chew or tense your face, the score is held and then shown as --. Those moments are not measured.",
  "Drowsiness is a slow trend with minutes of lag and needs 10 minutes of history.",
  "Person detection is a guess, and on the Muse it is unreliable. Use ✗ to correct it.",
  "The Cyton's dry electrodes on this headset have no published validation.",
  "OpenBCI retired the WiFi Shield for reliability problems. If data drops, use the USB dongle.",
  "Nothing here is a medical device."
];
const ENG_PADS = "No ECG. Stick two gel pads on your chest: one under the right collarbone, one on the lower left ribs. Clip the two leads of channel 9 (the F7 pins on the Daisy board) to them. Tape the cables so they do not pull. Do not use wrist leads.";
const ENG_WIFI = "Data is dropping on WiFi. OpenBCI retired the WiFi Shield for reliability problems. Plug in the USB dongle and restart the helper with --link dongle.";
/* front to back; left column = left hemisphere, right column = right hemisphere */
const ENG_ORDER = ["Fp1", "Fp2", "F7", "F8", "F3", "F4", "T7", "T8", "C3", "C4", "P7", "P8", "P3", "P4", "O1", "O2"];
const ENG_REGION = { Fp1: "left frontal pole", Fp2: "right frontal pole", F7: "left frontal, side", F8: "right frontal, side", F3: "left frontal", F4: "right frontal",
  T7: "left temporal", T8: "right temporal", C3: "left central", C4: "right central", P7: "left parietal, side", P8: "right parietal, side",
  P3: "left parietal", P4: "right parietal", O1: "left occipital", O2: "right occipital" };
const engEl = (tag, attrs, html, parent) => { const e = document.createElement(tag); for (const k in attrs || {}) { if (k === "cls") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); } if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
const engEsc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function engUiBuild() {
  if (EngUI.built) return; EngUI.built = true;
  const st = $("stage");
  // device selector next to Connect
  const ds = engEl("div", { id: "devSel", role: "radiogroup", "aria-label": "Device" }, '<button type="button" role="radio" data-dev="muse">MUSE</button><button type="button" role="radio" data-dev="cyton">CYTON</button>', st);
  ds.querySelectorAll("button").forEach(b => b.addEventListener("click", () => engSetDevice(b.dataset.dev)));
  // New / Legacy switch in the focus card
  const sw = engEl("div", { id: "engSw", role: "radiogroup", "aria-label": "Engine" }, '<button type="button" role="radio" data-eng="new" title="New engine: artifact-robust, learns your usual level, no calibration">NEW</button><button type="button" role="radio" data-eng="legacy" title="Legacy: the old formulas (beta/alpha, 10 s baselines)">LEGACY</button>', $("gFocus") || st);
  sw.querySelectorAll("button").forEach(b => b.addEventListener("click", () => setEngMode(b.dataset.eng)));
  // profile panel in the Auto-baselines slot
  const pf = engEl("div", { id: "engProf" }, '<div class="l1"><span id="engId">Identifying…</span><button type="button" id="engOk" title="Yes, this is me">✓</button><button type="button" id="engNo" title="Not me: choose who it is">✗</button></div><div class="l2" id="engBadge">Population norms</div><div id="engPick" hidden></div>', $("gCal") || st);
  $("engOk").addEventListener("click", () => { if (typeof engProfileConfirm === "function") engProfileConfirm(); });
  $("engNo").addEventListener("click", () => engUiPicker());
  // engine card (bottom left)
  const ec = engEl("div", { id: "engCard", cls: "min" }, '<div class="hd"><b>ENGINE</b><span id="engCardSt"></span><button type="button" id="engHelpBtn" title="What these numbers mean">?</button><button type="button" id="engTg" title="Open / close">▴</button></div><div class="bd" id="engCardBd"></div>', document.body);
  $("engTg").addEventListener("click", () => { ec.classList.toggle("min"); $("engTg").textContent = ec.classList.contains("min") ? "▴" : "▾"; });
  $("engHelpBtn").addEventListener("click", engUiHelp);
  // Cyton: the raw view holds all 16 channels; the header holds a 16-tile contact strip
  const raw = engEl("div", { id: "cyRaw" }, '<div class="tb"><b>16 CHANNELS</b><span id="cyInfo">offset removed, no other filtering · \u00b1100 \u00b5V</span><button type="button" id="cyCheck">Check contact</button></div><div class="grid" id="cyGrid"></div>', $("rawov"));
  ENG_ORDER.forEach(n => engEl("div", { cls: "cyr", id: "cyr_" + n }, '<div class="lb"><b>' + n + '</b><i>' + ENG_REGION[n] + '</i></div><canvas class="cyw" id="cyw_' + n + '"></canvas><div class="st"><span class="q">--</span><span class="r">--</span></div>', $("cyGrid")));
  $("cyCheck").addEventListener("click", engUiCheckContact);
  const strip = engEl("div", { id: "cySens", cls: "t" }, "", $("sensors"));
  ENG_ORDER.forEach(n => engEl("div", { cls: "cyt", id: "cyt_" + n }, '<i></i>' + n, strip));
  void raw;
  // help overlay
  engEl("div", { id: "engHelp", hidden: "" }, "", document.body);
  engUiCyConnectBuild();
  // the selftest box (?selftest=1)
  if (params.get("selftest") === "1") engEl("pre", { id: "engSelfTest", hidden: "" }, "", document.body);
  engUiDevice();
}
function engUiDevice() {
  const ds = $("devSel"); if (!ds) return;
  ds.querySelectorAll("button").forEach(b => { const on = b.dataset.dev === S.dev; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); b.disabled = false; b.title = b.dataset.dev === "cyton" ? "OpenBCI Cyton + Daisy (needs the helper: Open Cyton Panel.bat starts it)" : "Muse 2 (Bluetooth)"; });
  document.documentElement.dataset.dev = S.dev;
  document.documentElement.classList.toggle("eng-new", typeof engIsNew === "function" ? engIsNew() : true);
  const sw = $("engSw"); if (sw) sw.querySelectorAll("button").forEach(b => { const on = b.dataset.eng === engMode; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  const fsD = S.dev === "cyton" && typeof engState !== "undefined" && engState.fsDisp ? engState.fsDisp : S.dev === "cyton" ? 125 : FS, span = (BUF_LEN / fsD).toFixed(1);
  document.querySelectorAll("canvas.wave, canvas.cyw").forEach(c => { c.title = "Visible span: " + span + " s"; });
  $("hrName").textContent = S.dev === "cyton" ? "HEART RATE (ECG)" : "HEART RATE";
}
function engUiHelperMsg(m) { EngUI.lastHelperMsg = m; if (m.type === "impedance_done") { EngUI.checking = false; engUiCyton(); } if (m.type === "impedance" && engState.eng) engState.eng.setImpedance(m.channel, m.kohm); }
function engUiCheckContact() {
  if (!engState.cy || EngUI.checking) return;
  if (engState.cy.send("impedance_sweep")) { EngUI.checking = true; toast("Checking contact: scores are paused for about 30 seconds.", "info", 5000); }
  engUiCyton();
}
/* ---------- the Cyton connect sheet (opens from Connect when nothing is set up yet, or after a failed attempt) ----------
   USB dongle: the browser's own device picker (Web Serial), then the panel reads the board itself.
   WiFi Shield: needs the helper; "Start helper" opens musecyton:wifi, a link Open Cyton Panel.bat / Open Cyton Helper.bat register
   for this Windows user (tools/start_cyton_helper.bat); the sheet watches for the helper and connects as soon as it answers. */
const ENG_ICON_USB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v14"/><path d="m9 5 3-3 3 3"/><path d="M7 10v2.5a2 2 0 0 0 1 1.7l4 2.3"/><path d="M17 8v3.5a2 2 0 0 1-1 1.7l-4 2.3"/><rect x="5.5" y="7.5" width="3" height="3" rx=".5"/><circle cx="17" cy="7" r="1.5"/><circle cx="12" cy="19.5" r="2.5"/></svg>';
const ENG_ICON_WIFI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.8a14 14 0 0 1 19 0"/><path d="M5.8 12.2a9.2 9.2 0 0 1 12.4 0"/><path d="M9.1 15.6a4.6 4.6 0 0 1 5.8 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/></svg>';
const ENG_USB_HINT = "Plug the dongle in. Your browser asks which device to use, once.";
function engUiCyConnectBuild() {
  const d = engEl("div", { id: "cyConn", hidden: "", role: "dialog", "aria-modal": "true", "aria-labelledby": "cyConnT" },
    '<div class="card"><div class="hd"><div><b id="cyConnT">Connect the Cyton</b><span>Switch the board on (PC position) and pick how it talks to this computer.</span></div><button type="button" class="x" id="cyConnX" aria-label="Close">×</button></div>' +
    '<div class="err" id="cyConnErr" hidden></div>' +
    '<div class="opt" id="cyOptUsb"><div class="ic">' + ENG_ICON_USB + '</div><div class="tx"><b>USB dongle</b><span id="cyUsbSt">' + ENG_USB_HINT + '</span></div><button type="button" class="pri" id="cyUsbBtn">Choose dongle</button></div>' +
    '<div class="opt" id="cyOptWifi"><div class="ic">' + ENG_ICON_WIFI + '</div><div class="tx"><b>WiFi Shield</b><span id="cyWifiSt">Runs through the Cyton helper on this computer.</span></div><button type="button" id="cyWifiBtn">Start helper</button></div>' +
    '<div class="ft"><span>Close the OpenBCI GUI first; it holds the board.</span><button type="button" class="lnk" id="cyConnSim">No board? Try a simulated one</button></div></div>', document.body);
  const close = () => engUiCyConnectClose();
  $("cyConnX").addEventListener("click", close);
  d.addEventListener("mousedown", e => { if (e.target === d) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !d.hidden) close(); });
  $("cyUsbBtn").addEventListener("click", async () => {
    const A = engM().Adapters.CytonSerial;
    if (!A.supported()) return;
    $("cyUsbSt").textContent = "Pick the dongle (“FT231X” or “USB Serial Port”) in the browser’s list…";
    const port = await A.choosePort();                       // must run inside this click: the browser shows its device picker
    if (!port) { $("cyUsbSt").textContent = "No dongle chosen. Plug it in and try again."; return; }
    close(); engStartCyDongle(port);
  });
  $("cyWifiBtn").addEventListener("click", () => {
    if (EngUI.cyHelperUp) { close(); engStartCyHelper(); return; }
    EngUI.cyHelperAsked = Date.now();
    const a = document.createElement("a"); a.href = "musecyton:wifi"; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove();
    engUiCyConnectWifi(); engUiCyConnectPoll();
  });
  $("cyConnSim").addEventListener("click", () => { close(); engStartCySim(); });
}
function engUiCyConnect(err) {
  const d = $("cyConn"); if (!d) return;
  const e = $("cyConnErr"); e.hidden = !err; e.textContent = err || "";
  const A = engM().Adapters.CytonSerial, ok = !!(A && A.supported());
  $("cyUsbBtn").disabled = !ok;
  $("cyUsbSt").textContent = ok ? ENG_USB_HINT : "Needs Chrome or Edge (this browser cannot open USB serial devices).";
  EngUI.cyHelperAsked = 0; EngUI.cyHelperUp = false; engUiCyConnectWifi();
  d.hidden = false; document.documentElement.classList.add("cy-conn-open");
  setTimeout(() => { const b = ok ? $("cyUsbBtn") : $("cyWifiBtn"); if (b) b.focus(); }, 0);
  clearInterval(EngUI.cyPollT); EngUI.cyPollT = setInterval(engUiCyConnectPoll, 1500); engUiCyConnectPoll();
}
function engUiCyConnectClose() { const d = $("cyConn"); if (d) d.hidden = true; document.documentElement.classList.remove("cy-conn-open"); clearInterval(EngUI.cyPollT); }
function engUiCyConnectWifi() {
  const st = $("cyWifiSt"), b = $("cyWifiBtn"); if (!st || !b) return;
  b.classList.toggle("pri", !!EngUI.cyHelperUp);
  if (EngUI.cyHelperUp) { st.textContent = "The helper is running."; b.textContent = "Connect"; return; }
  b.textContent = "Start helper";
  const t = EngUI.cyHelperAsked ? Date.now() - EngUI.cyHelperAsked : 0;
  st.textContent = !EngUI.cyHelperAsked ? "Runs through the Cyton helper on this computer."
    : t < 9000 ? "Starting the helper… allow the browser’s prompt if it asks."
    : "The helper did not start. Open Cyton Panel.bat sets this button up the first time it runs.";
}
async function engUiCyConnectPoll() {
  const d = $("cyConn"); if (!d || d.hidden) return;
  const up = await engProbeHelper(700);
  EngUI.cyHelperUp = up; engUiCyConnectWifi();
  if (up && EngUI.cyHelperAsked && !S.connected && !S.connecting) { engUiCyConnectClose(); engStartCyHelper(); }   // started from here: connect at once
}
/* a button event flashes in the status line under the status pill for 600 ms */
function engUiButton(ev) {
  if (ev.type !== "double_blink" && ev.type !== "clench_tap") return;
  EngUI.flashText = ev.type === "double_blink" ? "DOUBLE BLINK" : "CLENCH"; EngUI.flashUntil = Date.now() + 600; engUiStatusLine();
  clearTimeout(EngUI.flashT); EngUI.flashT = setTimeout(engUiStatusLine, 620);
}
function engUiHelp() {
  const h = $("engHelp"); if (!h.hidden) { h.hidden = true; return; }
  let html = '<div class="box"><h3>What the numbers mean</h3><ul>' + ENG_LIMITS.map(x => "<li>" + engEsc(x) + "</li>").join("") + "</ul>";
  html += "<p><b>Chips:</b> LIVE = measured now; HELD = the last clean value while an artifact passes (confidence fades over 3 s); LEARNING = still learning your usual level; -- = not measured (the reason is shown).</p>";
  html += "<p><b>Badges:</b> Population norms (under 3 min of your data), Learning you (N min), Personal medium (15-60 min), Personal high (over 60 min or 3 sessions).</p>";
  if (S.dev === "cyton") html += "<h3>Cyton</h3><p>" + engEsc(ENG_PADS.replace(/^No ECG\. /, "")) + " The code flips the ECG polarity itself.</p><p>WiFi: join the shield's own network (192.168.4.1); eduroam and other WPA2-Enterprise networks do not work. " + engEsc(ENG_WIFI.replace(/^Data is dropping on WiFi\. /, "")) + "</p>";
  html += '<p class="r"><button type="button" id="engHelpClose">Close</button></p></div>';
  h.innerHTML = html; h.hidden = false; $("engHelpClose").addEventListener("click", () => { h.hidden = true; });
}
/* ---------- profile picker (relabel, rename, merge, forget, export/import) ---------- */
function engUiPicker() {
  const p = $("engPick"); if (!p.hidden) { p.hidden = true; return; }
  const store = window.engStore; let html = "";
  if (store) {
    const list = store.listProfiles();
    html += '<div class="pk">This session belongs to:</div>' + list.map(x => '<div class="row"><button type="button" data-rel="' + engEsc(x.id) + '">' + engEsc(x.label) + '</button>' +
      '<button type="button" class="sm" data-ren="' + engEsc(x.id) + '" title="Rename">Rename</button><button type="button" class="sm" data-mrg="' + engEsc(x.id) + '" title="Merge into another profile">Merge into…</button>' +
      '<button type="button" class="sm" data-del="' + engEsc(x.id) + '" title="Delete this profile and all its sessions">Forget me</button></div>').join("") +
      '<div class="row"><button type="button" data-rel="new">New guest</button></div><div class="row"><button type="button" id="engExp">Export</button><button type="button" id="engImp">Import</button><button type="button" id="engPickClose">Close</button></div>';
    if (store.notSaved) html += '<div class="pk">Profiles are not saved in this browser (storage is blocked).</div>';
  } else html = '<div class="pk">Profiles are not available.</div><div class="row"><button type="button" id="engPickClose">Close</button></div>';
  p.innerHTML = html; p.hidden = false;
  p.querySelectorAll("[data-rel]").forEach(b => b.addEventListener("click", () => { if (typeof engProfileRelabel === "function") engProfileRelabel(b.dataset.rel); p.hidden = true; }));
  p.querySelectorAll("[data-ren]").forEach(b => b.addEventListener("click", () => { const n = prompt("New name:"); if (n && store) { store.rename(b.dataset.ren, n.slice(0, 40)); engUiPicker(); engUiPicker(); } }));
  p.querySelectorAll("[data-mrg]").forEach(b => b.addEventListener("click", () => { const others = store.listProfiles().filter(x => x.id !== b.dataset.mrg); const n = prompt("Merge into which profile? Type its name:\n" + others.map(x => x.label).join(", ")); const t = others.find(x => n && x.label.toLowerCase() === n.trim().toLowerCase()); if (t) { store.merge(b.dataset.mrg, t.id); p.hidden = true; } }));
  p.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { const x = store.listProfiles().find(q => q.id === b.dataset.del); if (x && confirm("Forget " + x.label + "? This deletes the profile and all its sessions from this browser.")) { store.remove(x.id); p.hidden = true; } }));
  if ($("engExp")) $("engExp").addEventListener("click", () => { try { download("museengine_profiles_" + stamp(new Date()) + ".json", store.exportJSON(), "application/json"); } catch (e) { toast("Export failed.", "error"); } });
  if ($("engImp")) $("engImp").addEventListener("click", () => { const i = document.createElement("input"); i.type = "file"; i.accept = ".json,application/json";
    i.onchange = () => { const f = i.files[0]; if (!f) return; f.text().then(t => { try { store.importJSON(t); toast("Profiles imported.", "info"); } catch (e) { toast("Could not import: " + e.message, "error"); } }); }; i.click(); });
  if ($("engPickClose")) $("engPickClose").addEventListener("click", () => { p.hidden = true; });
}
/* ---------- the engine card ---------- */
function engChipCls(m) { return !m ? "na" : m.state === "live" ? "live" : m.state === "held" ? "held" : m.state === "learning" ? "learn" : "na"; }
function engUiCard() {
  const o = window.EngineOut, bd = $("engCardBd"); if (!bd) return;
  const rows = [["FOCUS", "focus"], ["STRESS", "stress"]].concat(S.dev === "cyton" ? [["DROWSY", "drowsiness"]] : []);
  const val = m => m && m.value != null ? Math.round(m.value) : "--";
  let html = rows.map(([nm, k]) => { const m = o && o[k]; return '<div class="mrow"><span class="nm">' + nm + '</span><span class="v">' + val(m) + '</span><span class="chip ' + engChipCls(m) + '">' + engEsc(m ? engChipText(m) : "--") + (m && (m.state === "stale" || m.state === "unavailable") && m.reason ? " " + engEsc(m.reason) : "") + '</span><span class="cf"><i style="width:' + Math.round(100 * (m ? m.conf : 0)) + '%"></i></span></div>'; }).join("");
  if (o && o.stress && o.stress.components) { const c = o.stress.components, z = x => x.valid && x.z != null ? (x.z >= 0 ? "+" : "") + x.z.toFixed(1) : "--";
    html += '<div class="comp"><span><i class="' + (c.hr.valid ? "ok" : "") + '"></i>HR z ' + z(c.hr) + '</span><span><i class="' + (c.hrv.valid ? "ok" : "") + '"></i>HRV z ' + z(c.hrv) + '</span><span><i class="' + (c.eeg.valid ? "ok" : "") + '"></i>EEG z ' + z(c.eeg) + '</span></div>'; }
  const ev = (engState.lastEvents || []).slice(-4).reverse().map(e => engEsc(e.type.replace("_", " ") + (e.sub && e.sub !== "start" ? " (" + e.sub + ")" : "")) + " " + e.t.toFixed(1) + "s").join(" · ");
  html += '<div class="evs">' + (ev || "No artifacts yet") + "</div>";
  if (S.dev === "cyton" && EngUI.warnings && EngUI.warnings.length) html += '<div class="evs" style="color:#ffd98a">' + EngUI.warnings.map(engEsc).join("<br>") + "</div>";
  html += '<div class="lim">Scores are relative to your usual (50). Not validated measures. Held moments are not measured. Press ? for more.</div>';
  bd.innerHTML = html;
  $("engCardSt").textContent = o ? (o.quality.motion === "proxy" ? "motion from EEG" : o.quality.motion) : "";
}
/* ---------- profile panel ---------- */
function engUiProfile() {
  const o = window.EngineOut, p = o && o.profile;
  const id = $("engId"); if (!id) return;
  let t = "Identifying…", showBtns = false;
  if (!S.connected) t = "Not connected";
  else if (p) {
    if (p.state === "confirmed") { t = "Looks like " + p.label + " (" + Math.round(100 * p.confidence) + "%)"; showBtns = true; }
    else if (p.state === "tentative") { t = "Probably " + p.label + " (" + Math.round(100 * p.confidence) + "%)"; showBtns = true; }
    else if (p.state === "guest") { t = p.label || "Guest"; showBtns = true; }
    if (p.first && p.state === "confirmed") t = (p.label || "Julian") + " (first session)";
  }
  id.textContent = t; $("engOk").hidden = !showBtns || (p && p.merged); $("engNo").hidden = !showBtns && !(p && p.state === "uncertain");
  const m = o && o.focus, b = p && p.badge ? p.badge : "Population norms";
  $("engBadge").textContent = (window.engStore && window.engStore.notSaved ? "Not saved · " : "") + b;
  void m;
}
/* ---------- Cyton: the panel's own places ---------- */
const engQCls = q => q == null ? "" : q >= 70 ? "good" : q >= 40 ? "fair" : "poor";
function engUiCyIdx(n) { const ch = engState.cyNames || (engState.cfg ? engState.cfg.channels : null); if (!ch) return -1; let i = ch.indexOf(n); if (i < 0 && n === "F7") i = ch.indexOf("ECG"); return i; }
function engUiStatusLine() {
  if (S.dev !== "cyton") return; const el = $("rate"); if (!el) return;
  if (EngUI.flashUntil && Date.now() < EngUI.flashUntil) { el.textContent = EngUI.flashText; el.classList.add("cyflash"); return; }
  el.classList.remove("cyflash");
  const h = engState.helper || {}, cfg = engState.cfg, sc = engState.stats, link = cfg ? ({ wifi: "WiFi", dongle: "USB dongle", sim: "simulated" }[cfg.link] || cfg.link) : "";
  if (h.state === "down" && engState.cyKind === "helper") { el.textContent = "Waiting for the Cyton helper"; el.title = h.text; return; }
  if (EngUI.checking) { el.textContent = "Checking contact\u2026 scores paused"; return; }
  el.title = "";
  el.textContent = S.connected ? [link, (sc && sc.fs ? Math.round(sc.fs) : cfg ? cfg.fs : "--") + " Hz", (sc ? (+sc.lossPct).toFixed(1) : "0.0") + "% lost"].filter(Boolean).join(" \u00b7 ") : "";
}
function engUiCyton() {
  if (S.dev !== "cyton") return;
  const o = window.EngineOut, cfg = engState.cfg, ecgIdx = engState.cyEcg != null ? engState.cyEcg : cfg ? cfg.ecgChannel : 8, e = o && o.quality.ecg, sc = engState.stats;
  const unused = cfg ? cfg.unusedChannels : [];
  let good = 0, nEeg = 0;
  ENG_ORDER.forEach(n => {
    const i = engUiCyIdx(n), isEcg = i >= 0 && i === ecgIdx, q = S.connected && o && i >= 0 && !isEcg ? o.quality.perChannel[i] : null, off = i >= 0 && unused.includes(i);
    if (!isEcg && !off && i >= 0) { nEeg++; if (q != null && q >= 40) good++; }
    const tile = $("cyt_" + n), row = $("cyr_" + n);
    // the ECG is shown only in the Heart Rate box (it replaces the Muse pulse there); its F7 slot here is just marked as used for it
    if (tile) { tile.className = "cyt " + (isEcg ? "off" : off ? "off" : engQCls(q)); tile.lastChild.textContent = n;
      tile.title = isEcg ? "F7: these pins carry the ECG (see the Heart Rate box)" : n + " (" + ENG_REGION[n] + "): " + (off ? "not in use" : q == null ? "--" : "contact " + q + "%"); }
    if (row) { row.className = "cyr " + (isEcg || off ? "off" : engQCls(q));
      row.querySelector(".lb b").textContent = n; row.querySelector(".lb i").textContent = isEcg ? "used for the ECG \u2192 Heart Rate box" : ENG_REGION[n];
      const rms = engState.cyRms && i >= 0 ? engState.cyRms[i] : null;
      row.querySelector(".q").textContent = isEcg ? "" : off ? "off" : q == null ? "--" : q + "%";
      row.querySelector(".r").textContent = isEcg ? "" : S.connected && rms != null ? rms.toFixed(1) + " \u00b5V" : "--"; }
  });
  $("cyCheck").textContent = EngUI.checking ? "Checking\u2026 scores paused" : "Check contact"; $("cyCheck").disabled = !S.connected || EngUI.checking;
  engUiStatusLine();
  // warnings (helper self-check, engine, WiFi) and the ECG pad help appear once each as a message
  if (S.connected) {
    const warns = [].concat(engState.selfcheck && engState.selfcheck.warnings || [], o ? o.quality.warnings : [], engState.wifiBad ? [ENG_WIFI] : []);
    if (o && e && e.state === "none" && engState.firstFrameWall && Date.now() - engState.firstFrameWall > 20000) warns.push(ENG_PADS);
    EngUI.shownWarn = EngUI.shownWarn || {}; for (const w of warns) if (!EngUI.shownWarn[w]) { EngUI.shownWarn[w] = 1; toast(w, "info", 10000); }
    EngUI.warnings = [...new Set(warns)];
  }
  if (S.connected && o) {
    $("stRate").textContent = (sc && sc.fs ? Math.round(sc.fs) : cfg ? cfg.fs : "--") + " Hz"; $("stDrop").textContent = (sc ? (+sc.lossPct).toFixed(1) : o.quality.packetLoss.toFixed(1)) + "% lost";
    $("stUse").textContent = (nEeg - o.quality.excluded.length) + "/" + nEeg + " in use";
    $("stMot").textContent = o.quality.motion === "proxy" ? "motion (from EEG)" : o.quality.motion === "valid" ? "motion ok" : o.quality.motion === "movement" ? "MOVING, scores held" : "motion data missing";
    $("hrNum").textContent = e && e.bpm != null ? String(Math.round(e.bpm)) : "--"; $("hrState").textContent = e ? (e.state === "ok" ? "LIVE" : e.state === "weak" ? "WEAK" : "NO ECG") : "--";
    $("hrState").title = e && e.state === "none" ? ENG_PADS : "";
    $("hrFill").style.width = e && e.bpm != null ? Math.max(2, Math.min(100, (e.bpm - 40) / 140 * 100)) + "%" : "0";
  } else { $("stRate").textContent = "-- Hz"; $("stDrop").textContent = "--% lost"; $("stUse").textContent = "-/16 in use"; $("stMot").textContent = "motion --"; $("hrNum").textContent = "--"; $("hrState").textContent = "--"; }
  $("cySens").title = S.connected ? nEeg + " EEG channels, " + good + " with good or fair contact" : "16 channels (not connected)";
  setBattery(null);
}
/* the Cyton raw view: drawn with the panel's own canvas helpers (prep, grid, trace in panel/ui.js) */
function engUiDrawCy() {
  requestAnimationFrame(engUiDrawCy);
  if (S.dev !== "cyton" || S.view !== "raw" || typeof prep !== "function") return;
  const fsD = engState.fsDisp || 125, span = (BUF_LEN / fsD).toFixed(0) + " s";
  for (const n of ENG_ORDER) {
    const cv = $("cyw_" + n); if (!cv) continue; const { g, w, h } = prep(cv), i = engUiCyIdx(n), isEcg = i >= 0 && i === engState.cyEcg;
    g.strokeStyle = C("rgba(110,150,255,.16)", "grid"); g.lineWidth = 1; g.beginPath(); g.moveTo(0, h / 2 + .5); g.lineTo(w, h / 2 + .5); g.stroke();
    if (!S.connected || i < 0 || isEcg || !engState.cyBuf[i]) continue;
    const buf = engState.cyBuf[i];
    trace(g, w, h, buf, engState.cyPos, (h / 2 - 1) / 100, C("#7fe0ff", "raw"));   // fixed +/-100 uV, so a row can never look exaggerated
  }
  const info = $("cyInfo"); if (info) info.textContent = "offset removed, no other filtering \u00b7 \u00b1100 \u00b5V per row \u00b7 last " + span + " \u00b7 ECG in the Heart Rate box";
}
requestAnimationFrame(engUiDrawCy);
/* ---------- selftest summary (?selftest=1) ---------- */
function engUiSelfTest() {
  const pre = $("engSelfTest"); if (!pre || !engState.firstFrameWall || Date.now() - engState.firstFrameWall < 20000 || pre.textContent) return;
  const o = window.EngineOut, fin = m => m == null || m.value == null || isFinite(m.value);
  pre.textContent = JSON.stringify({ device: S.dev, hops: engState.hops, focus: o ? { state: o.focus.state, finite: fin(o.focus) } : null, stress: o ? { state: o.stress.state, finite: fin(o.stress) } : null,
    drowsiness: o && o.drowsiness ? { state: o.drowsiness.state, finite: fin(o.drowsiness) } : null, events: Object.keys(engState.eventsSeen), errors: engState.errors.concat(EngUI.pageErrors || []) });
}
addEventListener("error", e => { (EngUI.pageErrors = EngUI.pageErrors || []).push(String(e.message || e)); });
engUiBuild();
setInterval(() => { if (typeof engState === "undefined") return; for (const f of [engUiDevice, engUiCard, engUiProfile, engUiCyton, engUiSelfTest]) { try { f(); } catch (e) { (EngUI.pageErrors = EngUI.pageErrors || []).push(f.name + ": " + e.message); } } }, 500);
