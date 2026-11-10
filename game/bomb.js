/* Bomb defusal prototype: browser view. Needs game/bomb-logic.js.
   Open it with BombUI.open({ focus, stress, status, seed, onEvent, onClose }).
   - mode: "live" (default when focus is given: real headband) or "test" (manual slider). Switchable in the top bar.
   - focus():  0..100 from the panel's focus meter, or null when there is no reading (default: no stress effects)
   - stress(): optional 0..1 stress value from a future algorithm; overrides the focus mapping when it returns a number
   - onEvent(type, data): start | strike | module_solved | explode | defused | finish
   All art is drawn in code. */
"use strict";
(function (root) {
const L = root.BombLogic;
let ui = null;

const CSS = `
.bz{position:fixed;inset:0;z-index:100000;background:radial-gradient(ellipse at 50% 30%,#2b3640 0%,#12181e 70%);color:#e6edf3;font-family:"Segoe UI",-apple-system,"Helvetica Neue",Arial,sans-serif;overflow:hidden;user-select:none}
.bz *{box-sizing:border-box}
.bz-bar{position:absolute;left:0;right:0;top:0;height:46px;display:flex;align-items:center;gap:10px;padding:0 16px;background:rgba(0,0,0,.45);border-bottom:1px solid #2b3946;z-index:5}
.bz-bar b{letter-spacing:.2em;font-weight:600;font-size:13px}.bz-bar .sp{flex:1}.bz-bar .st{font-size:12px;color:#8ea1b3}
.bz-btn{background:#1b2630;border:1px solid #34495c;color:#dbe7f2;border-radius:6px;padding:6px 14px;font-size:12px;letter-spacing:.08em;cursor:pointer}
.bz-btn:hover{border-color:#6fb1ff}
.bz-view{position:absolute;left:0;right:0;top:46px;bottom:0;cursor:none;display:flex;align-items:center;justify-content:center}
.bz-room{position:absolute;left:0;right:0;bottom:0;height:22%;background:linear-gradient(#7d5a46,#4a3328);box-shadow:0 -20px 40px rgba(0,0,0,.5) inset}
.bz-wrap{position:relative}
.bz-bomb{position:absolute;left:0;top:0;width:960px;height:620px;transform-origin:0 0}
.bz-case{position:absolute;inset:0;border-radius:26px;background:linear-gradient(160deg,#c9d6e2,#8397aa 55%,#6a7f93);padding:24px;box-shadow:0 30px 60px rgba(0,0,0,.65),inset 0 2px 0 #eaf2f9,inset 0 -4px 0 rgba(0,0,0,.25)}
.bz-in{position:absolute;inset:24px;border-radius:14px;background:#1a2530;box-shadow:inset 0 0 0 4px #3f5367,inset 0 8px 18px rgba(0,0,0,.7);padding:14px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);gap:12px}
.bay{position:relative;border-radius:10px;background:linear-gradient(160deg,#dbe3ea,#a9b6c2);box-shadow:inset 0 2px 0 #fff,inset 0 -3px 0 rgba(0,0,0,.25),0 3px 8px rgba(0,0,0,.5);overflow:hidden}
.bay .bolt{position:absolute;width:16px;height:16px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,#9eb0bf 45%,#51616f);box-shadow:0 1px 3px rgba(0,0,0,.6)}
.bay .bolt.a{left:8px;top:8px}.bay .bolt.b{right:8px;top:8px}.bay .bolt.c{left:8px;bottom:8px}.bay .bolt.d{right:8px;bottom:8px}
.led{position:absolute;right:30px;top:10px;width:14px;height:14px;border-radius:50%;background:#5b1414;border:2px solid #2a3947;box-shadow:inset 0 1px 2px rgba(255,255,255,.3)}
.led.on{background:#43f28a;box-shadow:0 0 10px #43f28a}
.timer{background:#0d1114;padding:20px 18px}
.timer .well{position:absolute;left:18px;right:18px;top:60px;height:130px;background:#050606;border-radius:8px;box-shadow:inset 0 0 0 3px #39454f;display:flex;align-items:center;justify-content:center;gap:6px}
.timer .lab{position:absolute;left:0;right:0;top:20px;text-align:center;font-size:11px;letter-spacing:.35em;color:#8da0b1}
.dg{width:44px;height:78px}.dg .s{fill:#2a0806}.dg .s.on{fill:#ff2e1a;filter:drop-shadow(0 0 5px #ff2e1a)}
.col{width:12px;height:56px;display:flex;flex-direction:column;justify-content:space-around;align-items:center}.col i{width:8px;height:8px;background:#ff2e1a;box-shadow:0 0 6px #ff2e1a;border-radius:1px}
.timer .sub{position:absolute;left:0;right:0;bottom:18px;text-align:center;font-size:11px;color:#6d7f8f;letter-spacing:.2em}
.info .plate{position:absolute;left:24px;right:24px;top:36px;height:64px;background:linear-gradient(#f4f1e8,#d9d4c4);border-radius:5px;color:#222;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:inset 0 0 0 2px #b9b3a0}
.info .plate small{font-size:10px;letter-spacing:.3em;color:#666}.info .plate span{font:700 26px/1.1 "SF Mono",Menlo,Consolas,monospace;letter-spacing:.14em}
.info .strikes{position:absolute;left:24px;right:24px;top:124px;display:flex;gap:10px;justify-content:center}
.info .strikes i{width:50px;height:50px;border-radius:6px;background:#1a232c;box-shadow:inset 0 0 0 3px #3a4856;display:flex;align-items:center;justify-content:center;font:700 30px/1 Arial;color:#2e3b47;font-style:normal}
.info .strikes i.on{color:#ff3b30;text-shadow:0 0 12px #ff3b30}
.info .lbl{position:absolute;left:0;right:0;top:106px;text-align:center;font-size:10px;letter-spacing:.3em;color:#53626f}
.info .mods{position:absolute;left:0;right:0;bottom:16px;text-align:center;font-size:11px;letter-spacing:.2em;color:#53626f}
.btnbay .hole{position:absolute;left:50px;top:52px;width:150px;height:150px;border-radius:50%;background:#2a3744;box-shadow:inset 0 6px 14px rgba(0,0,0,.7),0 1px 0 #fff}
.btnbay .cap{position:absolute;left:62px;top:60px;width:126px;height:126px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 22px/1 "Segoe UI",Arial;letter-spacing:.06em;box-shadow:0 8px 0 rgba(0,0,0,.35),0 12px 14px rgba(0,0,0,.5),inset 0 4px 6px rgba(255,255,255,.45);transition:transform .06s,box-shadow .06s}
.btnbay .cap.dn{transform:translateY(7px);box-shadow:0 1px 0 rgba(0,0,0,.35),0 3px 6px rgba(0,0,0,.5),inset 0 4px 6px rgba(255,255,255,.35)}
.btnbay .strip{position:absolute;right:26px;top:54px;width:22px;height:146px;border-radius:5px;background:#1a232c;box-shadow:inset 0 0 0 3px #3a4856}
.btnbay .strip.on{box-shadow:inset 0 0 0 3px #3a4856,0 0 16px currentColor;background:currentColor}
.c-red{background:radial-gradient(circle at 40% 30%,#ff8478,#d8261b 60%,#8d140d);color:#fff}.c-blue{background:radial-gradient(circle at 40% 30%,#8fc0ff,#2c6fe0 60%,#1a3f8c);color:#fff}
.c-white{background:radial-gradient(circle at 40% 30%,#fff,#dfe3e8 60%,#a5adb6);color:#222}.c-yellow{background:radial-gradient(circle at 40% 30%,#fff3a0,#f1c40f 60%,#a7840a);color:#222}.c-green{color:#43f28a}
.c-black{background:#15191d;color:#fff}
.stripc-blue{color:#3d8bff}.stripc-white{color:#f4f7fa}.stripc-yellow{color:#f7d21e}.stripc-green{color:#43f28a}
.wirebay svg{position:absolute;left:14px;top:34px}
.wirebay .hit{position:absolute;left:14px;width:262px;height:30px}
.keybay .grid{position:absolute;left:36px;right:36px;top:50px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.key{height:78px;border-radius:9px;background:linear-gradient(#f6efd8,#d4c9a4);box-shadow:0 6px 0 #8f875f,0 9px 10px rgba(0,0,0,.45),inset 0 2px 0 #fff;display:flex;align-items:center;justify-content:center;font:34px/1 "Segoe UI Symbol","Apple Symbols","Arial Unicode MS",serif;color:#2a2a2a;transition:transform .05s,box-shadow .05s}
.key.dn{transform:translateY(5px);box-shadow:0 1px 0 #8f875f,0 3px 6px rgba(0,0,0,.4),inset 0 2px 0 #fff}
.key.ok{background:linear-gradient(#bff5d2,#7fd7a2);color:#0b3a1c}.key.bad{background:linear-gradient(#ffb3ad,#e5645a)}
.keybay .leds{position:absolute;left:0;right:0;top:20px;display:flex;gap:10px;justify-content:center}
.keybay .leds i{width:30px;height:9px;border-radius:2px;background:#3b4b58;box-shadow:inset 0 1px 2px rgba(0,0,0,.6)}.keybay .leds i.on{background:#43f28a;box-shadow:0 0 8px #43f28a}
.vit{background:#111a22;color:#cfe0ee}.vit .h{position:absolute;left:0;right:0;top:16px;text-align:center;font-size:11px;letter-spacing:.3em;color:#8da0b1}
.vit .row{position:absolute;left:26px;right:26px}.vit .row label{font-size:10px;letter-spacing:.22em;color:#8da0b1;display:flex;justify-content:space-between}
.vit .bar{height:16px;border-radius:4px;background:#050a0e;box-shadow:inset 0 0 0 2px #2d3c49;margin-top:5px;overflow:hidden}.vit .bar i{display:block;height:100%;width:0}
.vit .f i{background:linear-gradient(90deg,#2b7fff,#3fe0ff)}.vit .s i{background:linear-gradient(90deg,#ffb020,#ff3b30)}
.vit .note{position:absolute;left:18px;right:18px;bottom:14px;font-size:10px;line-height:1.5;color:#6d8294;text-align:center}
.bz-hand{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:2px solid #fff;background:rgba(255,255,255,.12);box-shadow:0 0 0 1px rgba(0,0,0,.6),0 0 10px rgba(120,200,255,.5);pointer-events:none;z-index:100003;display:none}
.bz-hand::after{content:"";position:absolute;left:10px;top:10px;width:6px;height:6px;border-radius:50%;background:#fff}
.bz-hand.dn{background:rgba(255,255,255,.4);border-color:#7fe0ff}
.bz-glitch .bz-case{animation:bzg .12s steps(2) infinite}@keyframes bzg{0%{filter:hue-rotate(0)}50%{filter:hue-rotate(60deg) brightness(1.25)}100%{filter:hue-rotate(-40deg)}}
.bz-flash{position:absolute;inset:0;pointer-events:none;background:#ff2a1a;opacity:0;z-index:4}
.bz-man{position:absolute;right:16px;top:58px;bottom:16px;width:min(470px,46vw);background:#efe8d3;color:#2a2418;border-radius:6px;box-shadow:0 14px 40px rgba(0,0,0,.7);padding:20px 24px;overflow:auto;z-index:6;display:none;font-family:Georgia,"Times New Roman",serif;line-height:1.45;font-size:14px;cursor:auto}
.bz-man h2{font-size:20px;margin-bottom:2px}.bz-man h3{margin:16px 0 4px;font-size:15px;border-bottom:1px solid #b9ae8c}.bz-man ol{padding-left:20px}.bz-man li{margin:3px 0}
.bz-man .cols{display:flex;gap:10px;margin-top:6px}.bz-man .cols div{flex:1;border:1px solid #9a8f6c;padding:6px;text-align:center;font:22px/1.5 "Segoe UI Symbol","Apple Symbols",serif}.bz-man .cols small{display:block;font:11px Georgia}
.bz-tools{position:absolute;left:14px;bottom:12px;z-index:5;background:rgba(0,0,0,.55);border:1px solid #2b3946;border-radius:8px;padding:8px 12px;font-size:11px;color:#9bb0c2;display:flex;flex-direction:column;gap:5px;cursor:auto}
.bz-tools label{display:flex;gap:6px;align-items:center}.bz-tools small{color:#7f93a5}.bz-tools input[type=range]{width:170px}
.bz-end{position:absolute;inset:0;z-index:7;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);cursor:auto}
.bz-end .card{min-width:360px;max-width:520px;background:#141d26;border:2px solid #3c566d;border-radius:12px;padding:24px 30px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.7)}
.bz-end h1{font-size:34px;letter-spacing:.2em;margin-bottom:8px}.bz-end .win h1{color:#43f28a}.bz-end .lose h1{color:#ff453a}
.bz-end p{font-size:13px;color:#a9bccd;line-height:1.7;margin:6px 0}.bz-end .stats{margin:12px 0;text-align:left;font-size:13px;line-height:1.8}.bz-end .stats div{display:flex;justify-content:space-between;border-bottom:1px solid #223241}
.bz-end .row{display:flex;gap:10px;justify-content:center;margin-top:14px}
`;

const SEG = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
const SEGP = { a: "6,4 10,0 30,0 34,4 30,8 10,8", b: "35,5 39,9 39,31 35,35 31,31 31,9", c: "35,37 39,41 39,63 35,67 31,63 31,41",
  d: "6,66 10,62 30,62 34,66 30,70 10,70", e: "5,37 9,41 9,63 5,67 1,63 1,41", f: "5,5 9,9 9,31 5,35 1,31 1,9", g: "6,35 10,31 30,31 34,35 30,39 10,39" };
const WIRE_HEX = { red: "#e0281c", blue: "#2f78ff", yellow: "#f4cf1a", white: "#eef1f4", black: "#23272b" };

function el(tag, cls, html, parent) {
  const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e); return e;
}
function digitSvg() {
  return `<svg class="dg" viewBox="0 0 40 70">${"abcdefg".split("").map(s => `<polygon class="s" data-s="${s}" points="${SEGP[s]}"/>`).join("")}</svg>`;
}
function bay(cls, parent) {
  const b = el("div", "bay " + cls, '<i class="bolt a"></i><i class="bolt b"></i><i class="bolt c"></i><i class="bolt d"></i>', parent);
  return b;
}

/* ---------- sound (tiny WebAudio beeps; starts after the first click) ---------- */
let actx = null, muted = false;
function beep(f, d, type, vol) {
  if (muted || !actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = type || "square"; o.frequency.value = f; g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d);
  } catch (e) { /* sound is optional */ }
}
function boomSound() {
  if (muted || !actx) return;
  try {
    const n = actx.sampleRate * 1.2, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
    const s = actx.createBufferSource(), g = actx.createGain(); s.buffer = buf; g.gain.value = 0.5; s.connect(g); g.connect(actx.destination); s.start();
  } catch (e) { /* ignore */ }
}

function open(opts) {
  if (ui) return;
  opts = opts || {};
  if (!document.getElementById("bz-css")) { const s = document.createElement("style"); s.id = "bz-css"; s.textContent = CSS; document.head.appendChild(s); }
  const T = Object.assign({}, L.TUNING, opts.tuning || {});
  const root = el("div", "bz", null, opts.parent || document.body);

  /* top bar */
  const bar = el("div", "bz-bar", '<b>DEFUSE</b><span class="st" id="bzSt"></span><span class="sp"></span>', root);
  const bMode = el("button", "bz-btn", "", bar), bMan = el("button", "bz-btn", "MANUAL (M)", bar), bSnd = el("button", "bz-btn", "SOUND ON", bar), bExit = el("button", "bz-btn", "EXIT (Esc)", bar);
  const stEl = bar.querySelector("#bzSt");

  const view = el("div", "bz-view", null, root);
  el("div", "bz-room", null, view);
  const wrap = el("div", "bz-wrap", null, view);
  const bomb = el("div", "bz-bomb", null, wrap);
  const cs = el("div", "bz-case", null, bomb);
  const inn = el("div", "bz-in", null, cs);
  const flash = el("div", "bz-flash", null, root);
  const hand = el("div", "bz-hand", null, root);

  /* build modules */
  let level, S;
  const items = [];   // interactive things: { el, down(), up() }
  const reg = (e, down, up) => items.push({ el: e, down, up });

  const bTimer = bay("timer", inn);
  el("div", "lab", "DETONATION", bTimer);
  const well = el("div", "well", null, bTimer);
  const dgs = [];
  for (let i = 0; i < 4; i++) {
    if (i === 2) el("div", "col", "<i></i><i></i>", well);
    const d = el("div", null, digitSvg(), well); dgs.push(d.firstChild);
  }
  el("div", "sub", "COUNTDOWN", bTimer);

  const bInfo = bay("info", inn);
  const plate = el("div", "plate", "<small>SERIAL</small><span></span>", bInfo);
  el("div", "lbl", "STRIKES", bInfo);
  const strikeBox = el("div", "strikes", "<i>X</i><i>X</i><i>X</i>", bInfo);
  const modsEl = el("div", "mods", "", bInfo);

  const bBtn = bay("btnbay", inn);
  const ledB = el("div", "led", null, bBtn);
  el("div", "hole", null, bBtn);
  const cap = el("div", "cap", "", bBtn), strip = el("div", "strip", null, bBtn);

  const bWire = bay("wirebay", inn);
  const ledW = el("div", "led", null, bWire);
  const wsvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wsvg.setAttribute("width", 262); wsvg.setAttribute("height", 230); wsvg.setAttribute("viewBox", "0 0 262 230");
  bWire.appendChild(wsvg);

  const bKey = bay("keybay", inn);
  const ledK = el("div", "led", null, bKey);
  const kLeds = el("div", "leds", "<i></i><i></i><i></i><i></i>", bKey);
  const kGrid = el("div", "grid", null, bKey);

  const bVit = bay("vit", inn);
  el("div", "h", "OPERATOR MONITOR", bVit);
  const rowF = el("div", "row f", '<label><span>FOCUS</span><b>--</b></label><div class="bar"><i></i></div>', bVit); rowF.style.top = "52px";
  const rowS = el("div", "row s", '<label><span>STRESS</span><b>--</b></label><div class="bar"><i></i></div>', bVit); rowS.style.top = "108px";
  const vNote = el("div", "note", "", bVit);
  const effect = el("div", "row", '<label><span>HAND TREMOR</span><b id="bzT">0 px</b></label><label style="margin-top:8px"><span>CLOCK SPEED</span><b id="bzC">x1.00</b></label>', bVit); effect.style.top = "166px";

  /* manual */
  const man = el("div", "bz-man", "", root);
  man.innerHTML = `<h2>Bomb Defusal Handbook</h2><p>Every bomb has a serial number, a wire panel, a big button and a symbol keypad. Three strikes or an empty clock and it goes off.</p>
   <h3>Wires (5 wires)</h3><ol>${L.WIRE_RULES.map(r => `<li>${r}</li>`).join("")}</ol>
   <h3>The button</h3><ol>${L.BUTTON_RULES.map(r => `<li>${r}</li>`).join("")}</ol><p>${L.STRIP_RULES}</p><p><i>Tap</i> = release within half a second.</p>
   <h3>Symbol keypad</h3><p>Find the one column that contains all four symbols on your keypad. Press the symbols in the order they appear in that column, top to bottom.</p>
   <div class="cols">${L.KEY_COLUMNS.map((c, i) => `<div><small>Column ${i + 1}</small>${c.map(s => `<div style="border:0;padding:0">${s}</div>`).join("")}</div>`).join("")}</div>
   <h3>Stress</h3><p>This is a prototype for the Muse 2 focus meter. When your focus drops, your hands start to shake, the clock runs faster and the display may glitch. Stay calm.</p>`;

  /* test tools */
  const tools = el("div", "bz-tools", `<b style="letter-spacing:.2em;color:#e6c46a">MANUAL TEST MODE</b><label>Focus <input type="range" id="bzSl" min="0" max="100" value="50"><b id="bzSv">50</b></label><small>0 = very stressed, 50+ = calm</small><label><input type="checkbox" id="bzNo"> simulate "no reading"</label>`, root);
  const sl = tools.querySelector("#bzSl"), sv = tools.querySelector("#bzSv"), no = tools.querySelector("#bzNo");
  sl.addEventListener("input", () => { sv.textContent = sl.value; });

  const endEl = el("div", "bz-end", "", root);
  let mode = opts.mode || (opts.focus ? "live" : "test");
  function setMode(m) {
    mode = m; tools.style.display = m === "test" ? "flex" : "none";
    bMode.textContent = m === "test" ? "MODE: MANUAL TEST" : "MODE: LIVE (MUSE)";
    bMode.style.borderColor = m === "test" ? "#e6c46a" : "#43f28a";
    if (S) emit("mode", { mode: m });
  }
  bMode.onclick = () => { if (S && S.state === "running" && S.t > 1 && !confirm("Switching mode mid-game mixes test and real readings in this run's results. Switch anyway?")) return; setMode(mode === "test" ? "live" : "test"); };

  /* ---------- level setup ---------- */
  function build(seed) {
    level = L.makeLevel(seed); level.timeLimit = T.timeLimit; level.maxStrikes = T.maxStrikes;
    S = { remaining: level.timeLimit, strikes: 0, state: "running", solved: { wires: false, button: false, keypad: false }, cut: [false, false, false, false, false],
      pressAt: null, pressItem: null, progress: 0, stressSm: 0, stressSum: 0, stressHi: 0, focusSum: 0, focusN: 0, t: 0, nextGlitch: 6, glitchUntil: 0, lastSec: -1, events: [] };
    items.length = 0; bWire.querySelectorAll('.hit').forEach(x => x.remove());
    plate.lastChild.textContent = level.serial;
    ledB.className = ledW.className = ledK.className = "led";
    /* wires */
    wsvg.innerHTML = "";
    level.wires.colors.forEach((c, i) => drawWire(i, false));
    for (let i = 0; i < 5; i++) {
      const h = el("div", "hit", "", bWire); h.style.top = (34 + 22 + i * 44 - 15) + "px";
      reg(h, () => cutWire(i));
    }
    /* button */
    cap.className = "cap c-" + level.button.color; cap.textContent = level.button.label;
    strip.className = "strip"; strip.style.color = "";
    reg(cap, pressButton, releaseButton);
    /* keypad */
    kGrid.innerHTML = ""; [...kLeds.children].forEach(i => i.className = "");
    level.keypad.shown.forEach(sym => { const k = el("div", "key", sym, kGrid); reg(k, () => pressKey(k, sym), () => k.classList.remove("dn")); });
    strikeBox.querySelectorAll("i").forEach(i => i.className = "");
    updMods(); endEl.style.display = "none"; root.classList.remove("bz-glitch");
    emit("start", { seed: level.seed, serial: level.serial, mode });
  }
  function drawWire(i, cut) {
    const y0 = 22 + i * 44, col = WIRE_HEX[level.wires.colors[i]], pts = [];
    for (let k = 0; k <= 24; k++) pts.push([10 + k * (242 / 24), y0 + 7 * Math.sin(k * 0.55 + i * 1.7)]);
    const ns = "http://www.w3.org/2000/svg";
    const old = wsvg.querySelectorAll(`[data-w="${i}"]`); old.forEach(o => o.remove());
    const g = document.createElementNS(ns, "g"); g.setAttribute("data-w", i);
    const path = (arr, st, w, op) => { const p = document.createElementNS(ns, "polyline"); p.setAttribute("points", arr.map(a => a.join(",")).join(" ")); p.setAttribute("fill", "none"); p.setAttribute("stroke", st); p.setAttribute("stroke-width", w); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round"); if (op) p.setAttribute("opacity", op); g.appendChild(p); };
    const parts = cut ? [pts.slice(0, 12).map(p => p), pts.slice(13).map((p, j) => [p[0] + 6, p[1] + (j * j) * 0.12 + 6])] : [pts];
    parts.forEach(a => { path(a, "#0b0d0f", 10, .8); path(a, col, 7); path(a.map(p => [p[0], p[1] - 1.6]), "#fff", 1.6, .35); });
    wsvg.appendChild(g);
    [[10, y0 + 7 * Math.sin(i * 1.7)], [252, y0 + 7 * Math.sin(24 * .55 + i * 1.7)]].forEach(([x, y]) => {
      if (wsvg.querySelector(`[data-t="${i}-${x}"]`)) return;
      const c = document.createElementNS(ns, "circle"); c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 7); c.setAttribute("fill", "#b79a4a"); c.setAttribute("stroke", "#4a3b12"); c.setAttribute("stroke-width", 2); c.setAttribute("data-t", i + "-" + x); wsvg.appendChild(c);
      g.parentNode.insertBefore(g, c);
    });
  }

  /* ---------- actions ---------- */
  function emit(type, data) {
    S.events.push({ t: +(level.timeLimit - S.remaining).toFixed(2), type, data: (type === "finish" || type === "defused" || type === "explode") ? { result: data.result } : data });
    try { opts.onEvent && opts.onEvent(type, data || {}); } catch (e) { console.error(e); }
    try { root.dispatchEvent && window.dispatchEvent(new CustomEvent("bomb:event", { detail: { type, data } })); } catch (e) { /* ignore */ }
  }
  function strike(why) {
    if (S.state !== "running") return;
    S.strikes++; strikeBox.children[S.strikes - 1].classList.add("on");
    flash.style.transition = "none"; flash.style.opacity = ".55"; requestAnimationFrame(() => { flash.style.transition = "opacity .5s"; flash.style.opacity = "0"; });
    beep(110, .35, "sawtooth", .07); emit("strike", { why, strikes: S.strikes });
    if (S.strikes >= level.maxStrikes) explode("strikes");
  }
  function solveModule(name, led) {
    S.solved[name] = true; led.classList.add("on"); beep(988, .12, "square", .05); setTimeout(() => beep(1320, .18, "square", .05), 110);
    emit("module_solved", { module: name }); updMods();
    if (Object.values(S.solved).every(Boolean)) win();
  }
  const nSolved = () => Object.values(S.solved).filter(Boolean).length;
  function updMods() { modsEl.textContent = "MODULES " + nSolved() + " / 3"; }
  function cutWire(i) {
    if (S.state !== "running" || S.cut[i]) return;
    S.cut[i] = true; drawWire(i, true); beep(1500, .05, "triangle", .06);
    const r = L.judgeWire(level, i);
    if (r === "solved") solveModule("wires", ledW); else strike("wrong wire");
  }
  function pressButton() {
    if (S.state !== "running" || S.solved.button) return;
    S.pressAt = performance.now(); cap.classList.add("dn"); beep(300, .05, "square", .05);
  }
  function releaseButton() {
    if (S.pressAt == null) return;
    const held = (performance.now() - S.pressAt) / 1000; S.pressAt = null; cap.classList.remove("dn"); strip.className = "strip"; strip.style.color = "";
    if (S.state !== "running") return;
    const r = L.judgeButton(level, held, clockDigits());
    if (r === "solved") solveModule("button", ledB); else strike("button");
  }
  function pressKey(k, sym) {
    if (S.state !== "running" || S.solved.keypad) return;
    k.classList.add("dn"); beep(520, .05, "square", .05);
    if (L.judgeKey(level, S.progress, sym) === "ok") {
      k.classList.add("ok"); kLeds.children[S.progress].classList.add("on"); S.progress++;
      if (S.progress === 4) solveModule("keypad", ledK);
    } else { k.classList.add("bad"); setTimeout(() => k.classList.remove("bad"), 450); strike("wrong key"); }
  }

  /* ---------- end states ---------- */
  function summary() {
    const dur = Math.max(S.t, 0.001);
    return { seed: level.seed, mode, result: S.state, secondsPlayed: +S.t.toFixed(1), clockLeft: +Math.max(S.remaining, 0).toFixed(1), strikes: S.strikes,
      modulesSolved: nSolved(), avgStress: +(S.stressSum / dur).toFixed(3), secondsHighStress: +S.stressHi.toFixed(1),
      avgFocus: S.focusN ? +(S.focusSum / S.focusN).toFixed(1) : null, events: S.events.slice() };
  }
  function finish(kind, title, msg) {
    S.state = kind; const sm = summary();
    endEl.innerHTML = `<div class="card ${kind === "won" ? "win" : "lose"}"><h1>${title}</h1><p>${msg}</p><div class="stats">
      <div><span>Time played</span><b>${sm.secondsPlayed} s</b></div><div><span>Clock left</span><b>${sm.clockLeft} s</b></div><div><span>Strikes</span><b>${sm.strikes} / ${level.maxStrikes}</b></div>
      <div><span>Modules solved</span><b>${sm.modulesSolved} / 3</b></div><div><span>Average stress (0-1)</span><b>${sm.avgStress}</b></div><div><span>Seconds under high stress</span><b>${sm.secondsHighStress}</b></div>
      <div><span>Average focus</span><b>${sm.avgFocus == null ? "no reading" : sm.avgFocus}</b></div><div><span>Mode</span><b>${mode === "test" ? "manual test (not real data)" : "live (Muse)"}</b></div><div><span>Seed</span><b>${sm.seed}</b></div></div>
      <div class="row"><button class="bz-btn" id="bzNew">NEW BOMB</button><button class="bz-btn" id="bzRe">RETRY THIS BOMB</button><button class="bz-btn" id="bzEx">EXIT</button></div></div>`;
    endEl.style.display = "flex";
    endEl.querySelector("#bzNew").onclick = () => build();
    endEl.querySelector("#bzRe").onclick = () => build(level.seed);
    endEl.querySelector("#bzEx").onclick = close;
    emit(kind === "won" ? "defused" : "explode", sm); emit("finish", sm);
  }
  function win() { beep(660, .15, "triangle", .06); setTimeout(() => beep(880, .15, "triangle", .06), 150); setTimeout(() => beep(1320, .3, "triangle", .06), 300); finish("won", "DEFUSED", "Nice work. The bomb is safe."); }
  function explode(why) {
    if (S.state !== "running") return; S.state = "lost"; boomSound();
    flash.style.transition = "none"; flash.style.opacity = "1"; requestAnimationFrame(() => { flash.style.transition = "opacity 1.4s"; flash.style.opacity = "0"; });
    bomb.style.filter = "brightness(.35)";
    setTimeout(() => { bomb.style.filter = ""; finish("lost", "DETONATED", why === "time" ? "The clock ran out." : "Too many strikes."); }, 700);
  }

  /* ---------- display ---------- */
  function clockDigits() { const r = Math.max(0, Math.ceil(S.remaining)); return String(Math.floor(r / 60)).padStart(2, "0") + String(r % 60).padStart(2, "0"); }
  function setDigits(str) {
    for (let i = 0; i < 4; i++) { const on = SEG[str[i]] || ""; dgs[i].querySelectorAll(".s").forEach(p => p.classList.toggle("on", on.indexOf(p.dataset.s) >= 0)); }
  }

  /* ---------- pointer: the "hand" ---------- */
  let raw = null, handPos = null, downItem = null, k = 1, jit = [0, 0], overView = false;
  view.addEventListener("pointermove", e => { raw = [e.clientX, e.clientY]; });
  view.addEventListener("pointerenter", () => { overView = true; });
  view.addEventListener("pointerleave", () => { overView = false; hand.style.display = "none"; });
  function hit(x, y) {
    let best = null, area = 1e12;
    for (const it of items) { const r = it.el.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { const a = r.width * r.height; if (a < area) { area = a; best = it; } } }
    return best;
  }
  view.addEventListener("pointerdown", e => {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (x) { /* no sound */ } }
    raw = [e.clientX, e.clientY]; handPos = [raw[0] + jit[0], raw[1] + jit[1]];
    if (S.state !== "running") return;
    hand.classList.add("dn");
    const it = hit(handPos[0], handPos[1]); downItem = it; if (it && it.down) it.down();
  });
  function up() { hand.classList.remove("dn"); if (downItem && downItem.up) downItem.up(); downItem = null; }
  window.addEventListener("pointerup", up);

  /* ---------- main loop ---------- */
  let raf = 0, last = performance.now();
  const focusNow = () => { if (mode === "test") return no.checked ? null : +sl.value; return opts.focus ? opts.focus() : null; };
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const f = focusNow();
    let target = opts.stress ? opts.stress() : null; if (target == null || !isFinite(target)) target = L.stressFromFocus(f, T);
    S.stressSm += (target - S.stressSm) * (1 - Math.exp(-dt / T.smoothingSec));
    const s = S.stressSm, rate = L.clockRate(s, S.strikes, T), shake = L.handShake(s, T);
    if (S.state === "running") {
      S.t += dt; S.remaining -= dt * rate; S.stressSum += s * dt; if (s > 0.5) S.stressHi += dt; if (f != null) { S.focusSum += f; S.focusN++; }
      const sec = Math.ceil(S.remaining);
      if (sec !== S.lastSec) { S.lastSec = sec; beep(rate > 1.3 ? 1000 : 800, .04, "square", .03); }
      if (S.remaining <= 0) { S.remaining = 0; explode("time"); }
      if (s > T.glitchStress && S.t > S.nextGlitch) { S.glitchUntil = S.t + 0.7; S.nextGlitch = S.t + 6 + Math.random() * 6; beep(70, .5, "sawtooth", .05); root.classList.add("bz-glitch"); setTimeout(() => root.classList.remove("bz-glitch"), 700); }
      if (S.pressAt != null && (performance.now() - S.pressAt) / 1000 > 0.4) { strip.className = "strip on stripc-" + level.button.strip; }
    }
    if (S.state === "running" || S.state === "won") {
      let str = clockDigits(); if (S.state === "running" && S.t < S.glitchUntil) str = String(Math.floor(Math.random() * 9000 + 1000));
      setDigits(str);
    }
    /* hand shake */
    const tt = now / 1000;
    jit = [shake * k * (Math.sin(tt * 6.3 + 1) + 0.6 * Math.sin(tt * 11.7 + 2)) / 1.6, shake * k * (Math.sin(tt * 5.1 + 3) + 0.6 * Math.sin(tt * 13.1)) / 1.6];
    if (raw) { handPos = [raw[0] + jit[0], raw[1] + jit[1]]; if (overView) { hand.style.display = "block"; hand.style.transform = `translate(${handPos[0]}px,${handPos[1]}px)`; } }
    bomb.style.transform = `scale(${k}) rotate(${(s * 0.5 * Math.sin(tt * 1.7)).toFixed(3)}deg)`;
    /* vitals */
    const noRead = f == null && !(opts.stress && opts.stress() != null);
    rowF.querySelector("b").textContent = f == null ? "--" : Math.round(f); rowF.querySelector(".bar i").style.width = (f == null ? 0 : f) + "%";
    rowS.querySelector("b").textContent = Math.round(s * 100) + "%"; rowS.querySelector(".bar i").style.width = (s * 100) + "%";
    effect.querySelector("#bzT").textContent = shake.toFixed(1) + " px"; effect.querySelector("#bzC").textContent = "x" + rate.toFixed(2);
    vNote.textContent = mode === "test" ? "MANUAL TEST MODE: focus is set by the slider. Results are not real data." : noRead ? "LIVE MODE: no focus reading yet. Connect the headband and press Auto Set Baselines in the panel. Until then there are no stress effects." : "LIVE MODE: driven by the experimental focus meter. Not a validated stress measure.";
    stEl.textContent = (mode === "test" ? "MANUAL TEST" : "LIVE") + (opts.status ? "  |  " + opts.status() : "");
  }

  /* ---------- layout, keys ---------- */
  function fit() {
    const w = view.clientWidth, h = view.clientHeight; k = Math.max(0.3, Math.min((w - 40) / 960, (h - 24) / 620));
    wrap.style.width = 960 * k + "px"; wrap.style.height = 620 * k + "px";
  }
  function onKey(e) {
    if (e.key === "Escape") { if (man.style.display === "block") man.style.display = "none"; else close(); }
    else if (e.key === "m" || e.key === "M") { man.style.display = man.style.display === "block" ? "none" : "block"; }
  }
  bMan.onclick = () => { man.style.display = man.style.display === "block" ? "none" : "block"; };
  bSnd.onclick = () => { muted = !muted; bSnd.textContent = muted ? "SOUND OFF" : "SOUND ON"; };
  bExit.onclick = () => close();
  window.addEventListener("keydown", onKey); window.addEventListener("resize", fit);

  function close() {
    if (!ui) return;
    cancelAnimationFrame(raf); window.removeEventListener("keydown", onKey); window.removeEventListener("resize", fit); window.removeEventListener("pointerup", up);
    root.remove(); ui = null; try { opts.onClose && opts.onClose(); } catch (e) { console.error(e); }
  }

  ui = { close, restart: build, state: () => S, level: () => level, el: root };
  fit(); build(opts.seed); setMode(mode); raf = requestAnimationFrame(frame);
}

root.BombUI = { open, close: () => ui && ui.close(), isOpen: () => !!ui, _ui: () => ui };
})(typeof window !== "undefined" ? window : globalThis);
