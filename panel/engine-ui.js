/* panel/engine-ui.js
   DOM for the new engine: device selector (#devSel), New/Legacy switch (#engSw), profile panel (#engProf, in the Auto-baselines slot),
   engine card (#engCard, bottom left), Cyton card (#cyCard, bottom right), the "?" help with the honest limits, button flashes, and the
   Cyton versions of the sensor strip / rate line / heart-rate card.
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
const ENG_GRID = [["Fp1", "Fp2", "F7", "F8"], ["F3", "F4", "T7", "T8"], ["C3", "C4", "P7", "P8"], ["P3", "P4", "O1", "O2"]];
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
  // engine card (bottom left), Cyton card (bottom right)
  const ec = engEl("div", { id: "engCard", cls: "min" }, '<div class="hd"><b>ENGINE</b><span id="engCardSt"></span><button type="button" id="engHelpBtn" title="What these numbers mean">?</button><button type="button" id="engTg" title="Open / close">▴</button></div><div class="bd" id="engCardBd"></div>', document.body);
  $("engTg").addEventListener("click", () => { ec.classList.toggle("min"); $("engTg").textContent = ec.classList.contains("min") ? "▴" : "▾"; });
  $("engHelpBtn").addEventListener("click", engUiHelp);
  const cy = engEl("div", { id: "cyCard", cls: "min" }, '<div class="hd"><b>CYTON</b><span id="cyFl"><i id="flDb">DOUBLE BLINK</i><i id="flCl">CLENCH</i></span><button type="button" id="cyTg" title="Open / close">▴</button></div><div class="bd"><div id="cyGrid"></div><div id="cyEcg"></div><div id="cyHelper"></div><div id="cyWarn"></div><button type="button" id="cyCheck">Check contact</button></div>', document.body);
  $("cyTg").addEventListener("click", () => { cy.classList.toggle("min"); $("cyTg").textContent = cy.classList.contains("min") ? "▴" : "▾"; });
  $("cyCheck").addEventListener("click", engUiCheckContact);
  ENG_GRID.forEach(row => row.forEach(n => engEl("div", { cls: "cell", id: "cyc_" + n }, '<b>' + n + '</b><span>--</span>', $("cyGrid"))));
  // help overlay
  engEl("div", { id: "engHelp", hidden: "" }, "", document.body);
  // the selftest box (?selftest=1)
  if (params.get("selftest") === "1") engEl("pre", { id: "engSelfTest", hidden: "" }, "", document.body);
  engUiDevice();
}
function engUiDevice() {
  const ds = $("devSel"); if (!ds) return;
  ds.querySelectorAll("button").forEach(b => { const on = b.dataset.dev === S.dev; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); b.disabled = S.connected || S.connecting; });
  document.documentElement.dataset.dev = S.dev;
  document.documentElement.classList.toggle("eng-new", typeof engIsNew === "function" ? engIsNew() : true);
  const sw = $("engSw"); if (sw) sw.querySelectorAll("button").forEach(b => { const on = b.dataset.eng === engMode; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  // raw view labels and the visible span
  const names = S.dev === "cyton" ? ["Fp1", "C3", "P3", "O1"] : SENSORS;
  document.querySelectorAll("#rawov .rawrow").forEach((row, i) => { const nm = row.querySelector(".nm"); if (!nm) return;
    if (i < 4) nm.textContent = names[i]; else { nm.textContent = S.dev === "cyton" ? "ECG" : "HEART"; const sb = row.querySelector(".sb"); if (sb) sb.textContent = S.dev === "cyton" ? "CHEST LEAD (CHANNEL 9)" : "PULSE (INFRARED)"; } });
  const fsD = S.dev === "cyton" && typeof engState !== "undefined" && engState.fsDisp ? engState.fsDisp : S.dev === "cyton" ? 125 : FS, span = (BUF_LEN / fsD).toFixed(1);
  document.querySelectorAll("canvas.wave").forEach(c => { c.title = "Visible span: " + span + " s"; });
  $("hrName").textContent = S.dev === "cyton" ? "HEART RATE (ECG)" : "HEART RATE";
}
function engUiHelperMsg(m) { EngUI.lastHelperMsg = m; if (m.type === "impedance_done") { EngUI.checking = false; engUiCyton(); } if (m.type === "impedance" && engState.eng) engState.eng.setImpedance(m.channel, m.kohm); }
function engUiCheckContact() {
  if (!engState.cy || EngUI.checking) return;
  if (engState.cy.send("impedance_sweep")) { EngUI.checking = true; toast("Checking contact: scores are paused for about 30 seconds.", "info", 5000); }
  engUiCyton();
}
function engUiButton(ev) {
  const id = ev.type === "double_blink" ? "flDb" : ev.type === "clench_tap" ? "flCl" : null; if (!id || !$(id)) return;
  $(id).classList.add("on"); clearTimeout(EngUI.flash[id]); EngUI.flash[id] = setTimeout(() => $(id).classList.remove("on"), 600);
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
/* ---------- Cyton card and the Muse-only DOM in Cyton mode ---------- */
function engUiCyton() {
  if (S.dev !== "cyton") return;
  const o = window.EngineOut, cfg = engState.cfg, chans = cfg ? cfg.channels : (MuseEngine.Adapters.CytonSim ? MuseEngine.Adapters.CytonSim.NAMES : []);
  const ecgIdx = cfg ? cfg.ecgChannel : 8, ecgName = ecgIdx >= 0 ? "F7" : null;
  ENG_GRID.flat().forEach(n => { const cell = $("cyc_" + n); if (!cell) return; let i = chans.indexOf(n); if (n === ecgName && ecgIdx >= 0) i = ecgIdx;
    const isEcg = i === ecgIdx && ecgIdx >= 0, q = o && i >= 0 ? o.quality.perChannel[i] : null;
    let txt = "--", cls = "cell"; if (isEcg) { const bpm = o && o.quality.ecg && o.quality.ecg.bpm; txt = bpm != null ? Math.round(bpm) + " bpm" : "--"; cls += " ecg"; cell.querySelector("b").textContent = "ECG"; }
    else if (S.connected && q != null) { txt = String(q); cls += q >= 70 ? " good" : q >= 40 ? " fair" : " poor"; }
    cell.className = cls; cell.querySelector("span").textContent = txt; });
  const e = o && o.quality.ecg;
  $("cyEcg").textContent = e && e.bpm != null ? Math.round(e.bpm) + " bpm · signal " + (e.sqi || 0).toFixed(2) : (S.connected && (!e || e.state === "none") ? ENG_PADS : "ECG --");
  const h = engState.helper || {}, sc = engState.stats, link = cfg ? (cfg.link === "wifi" ? "WiFi" : cfg.link === "dongle" ? "dongle" : cfg.link === "sim" ? "simulated" : cfg.link) : "";
  $("cyHelper").textContent = h.state === "down" ? h.text : "Helper: " + (EngUI.checking ? "contact check" : h.state === "streaming" ? "streaming" : h.state || "--") + (link ? " · " + link : "") + (sc && sc.fs ? " · " + Math.round(sc.fs) + " Hz" : cfg ? " · " + cfg.fs + " Hz" : "") + (sc ? " · " + (+sc.lossPct).toFixed(1) + "% lost" : "");
  const warns = [].concat(engState.selfcheck && engState.selfcheck.warnings || [], o ? o.quality.warnings : []);
  if (engState.wifiBad) warns.push(ENG_WIFI);
  $("cyWarn").innerHTML = [...new Set(warns)].map(w => "<div>" + engEsc(w) + "</div>").join("");
  $("cyCheck").textContent = EngUI.checking ? "Checking… scores paused" : "Check contact"; $("cyCheck").disabled = !S.connected || EngUI.checking;
  // the panel's Muse-only places
  if (S.connected && o) {
    const good = o.quality.perChannel.filter((q, i) => q != null && q >= 40 && i !== ecgIdx).length, nEeg = chans.filter((n, i) => i !== ecgIdx && !(cfg && cfg.unusedChannels.includes(i))).length;
    engUiSensorStrip(nEeg + " ch · " + good + " good");
    $("stRate").textContent = (sc && sc.fs ? Math.round(sc.fs) : cfg ? cfg.fs : "--") + " Hz"; $("stDrop").textContent = (sc ? (+sc.lossPct).toFixed(1) : o.quality.packetLoss.toFixed(1)) + "% lost";
    $("stUse").textContent = (nEeg - o.quality.excluded.length) + "/" + nEeg + " in use";
    $("stMot").textContent = o.quality.motion === "proxy" ? "motion (from EEG)" : o.quality.motion === "valid" ? "motion ok" : o.quality.motion === "movement" ? "MOVING, scores held" : "motion data missing";
    $("hrNum").textContent = e && e.bpm != null ? String(Math.round(e.bpm)) : "--"; $("hrState").textContent = e ? (e.state === "ok" ? "LIVE" : e.state === "weak" ? "WEAK" : "NO ECG") : "--";
    $("hrFill").style.width = e && e.bpm != null ? Math.max(2, Math.min(100, (e.bpm - 40) / 140 * 100)) + "%" : "0";
    $("rate").textContent = "Live data";
  } else { engUiSensorStrip(S.connected ? "waiting" : "16 ch"); $("stRate").textContent = "-- Hz"; $("stDrop").textContent = "--% lost"; $("stUse").textContent = "-/16 in use"; $("stMot").textContent = "motion --"; $("hrNum").textContent = "--"; $("hrState").textContent = "--"; $("rate").textContent = ""; }
  setBattery(null);
}
function engUiSensorStrip(text) {
  let el = $("cySens"); if (!el) { el = engEl("div", { id: "cySens", cls: "t" }, "", $("sensors")); }
  el.textContent = text;
}
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
