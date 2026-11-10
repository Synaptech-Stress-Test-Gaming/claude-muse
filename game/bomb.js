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
.bz-bomb{position:absolute;left:0;top:0;width:1260px;height:640px;transform-origin:0 0}
.bz-case{position:absolute;left:150px;top:10px;width:960px;height:620px;border-radius:26px;background:linear-gradient(160deg,#c9d6e2,#8397aa 55%,#6a7f93);padding:24px;box-shadow:0 30px 60px rgba(0,0,0,.65),inset 0 2px 0 #eaf2f9,inset 0 -4px 0 rgba(0,0,0,.25)}
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
.bz .bz-man p,.bz .bz-man li,.bz .bz-man b,.bz .bz-man i,.bz .bz-man h2,.bz .bz-man h3{color:#2a2418}.bz .bz-man .cols small{color:#5a4f33}
.bz-man .paper{position:relative;min-height:100%}
.bz-man .mclose{position:sticky;top:0;float:right;z-index:3;background:#d9cfae;border:1px solid #9a8f6c;color:#2a2418;border-radius:5px;padding:4px 10px;font:12px Georgia,serif;cursor:pointer}
.bz-man .blot{position:absolute;border-radius:50% 46% 52% 48%;pointer-events:none;transform:translate(-50%,-50%)}
.bz-man .blot.wet{backdrop-filter:blur(4.5px);-webkit-backdrop-filter:blur(4.5px);background:radial-gradient(rgba(110,140,175,.38),rgba(110,140,175,.12) 70%,rgba(110,140,175,0));box-shadow:inset 0 0 10px rgba(60,90,130,.5)}
.bz-man .blot.dry{backdrop-filter:blur(1.5px);-webkit-backdrop-filter:blur(1.5px);background:radial-gradient(rgba(150,115,60,.34),rgba(150,115,60,.1) 70%,rgba(150,115,60,0))}
.pdrop{position:fixed;left:0;top:0;width:11px;height:15px;border-radius:50% 50% 50% 50%/70% 70% 30% 30%;background:radial-gradient(circle at 35% 30%,#fff,#9cc9f5 60%,#5b95d3);z-index:8;pointer-events:none}
.bz-man h2{font-size:20px;margin-bottom:2px}.bz-man h3{margin:16px 0 4px;font-size:15px;border-bottom:1px solid #b9ae8c}.bz-man ol{padding-left:20px}.bz-man li{margin:3px 0}
.bz-man .cols{display:flex;gap:10px;margin-top:6px}.bz-man .cols div{flex:1;border:1px solid #9a8f6c;padding:6px;text-align:center;font:22px/1.5 "Segoe UI Symbol","Apple Symbols",serif}.bz-man .cols small{display:block;font:11px Georgia}
.bz-tools{position:absolute;left:14px;bottom:12px;z-index:5;background:rgba(0,0,0,.55);border:1px solid #2b3946;border-radius:8px;padding:8px 12px;font-size:11px;color:#9bb0c2;display:flex;flex-direction:column;gap:5px;cursor:auto}
.bz-tools label{display:flex;gap:6px;align-items:center}.bz-tools small{color:#7f93a5}.bz-tools input[type=range]{width:170px}
.bz-table{position:absolute;inset:0;border-radius:22px;background:repeating-linear-gradient(95deg,rgba(0,0,0,.06) 0 3px,rgba(255,255,255,.03) 3px 8px),linear-gradient(180deg,#8d6549,#5a3f2e);box-shadow:0 30px 60px rgba(0,0,0,.6),inset 0 0 0 6px #3f2c20}
.bz-item{position:absolute}
.bz-item.book{left:1132px;top:200px;width:108px;height:150px;background:linear-gradient(135deg,#ece2c6,#cfc19a);border-radius:3px 8px 8px 3px;box-shadow:0 6px 0 #a59870,0 10px 14px rgba(0,0,0,.5),inset 4px 0 0 #b9ab80;transform:rotate(4deg);color:#3a3120;font:700 11px/1.35 Georgia,serif;padding:22px 8px 8px 16px;text-align:center;letter-spacing:.06em}
.bz-item.book small{display:block;margin-top:14px;font-weight:400;font-size:10px;letter-spacing:.14em;color:#7a6b43}.bz-item.book i{position:absolute;left:44px;top:-6px;width:10px;height:70px;background:#b3302a;border-radius:0 0 5px 5px;box-shadow:0 2px 3px rgba(0,0,0,.4)}
.bz-item.cloth{left:22px;top:392px;width:108px;height:82px;background:linear-gradient(135deg,#94b8dc,#6f94bc);border-radius:10px;box-shadow:0 5px 0 #4a6a8d,0 9px 12px rgba(0,0,0,.45);transform:rotate(-5deg);color:#27415c;font:700 10px/1.3 "Segoe UI",Arial;letter-spacing:.12em;display:flex;align-items:center;justify-content:center;text-align:center;border:2px dashed rgba(255,255,255,.55)}
.bz-item.lifted{opacity:.25}
.bz-item.phone{left:26px;top:70px;width:92px;height:172px;background:#0b0c0f;border-radius:14px;box-shadow:0 6px 0 #1b1d22,0 10px 14px rgba(0,0,0,.55);transform:rotate(-7deg);padding:7px}
.bz-item.phone i{display:flex;width:100%;height:100%;border-radius:9px;background:linear-gradient(160deg,#3a7bd5,#7a3fd1);align-items:center;justify-content:center;flex-direction:column;color:#fff;font:700 11px/1.4 "Segoe UI",Arial;text-align:center;animation:bzp 1.6s ease-in-out infinite}
@keyframes bzp{0%,100%{filter:brightness(.9)}50%{filter:brightness(1.35)}}
.bz-clothheld{position:fixed;left:0;top:0;width:100px;height:76px;margin:-38px 0 0 -50px;display:none;z-index:100002;pointer-events:none;background:linear-gradient(135deg,#94b8dc,#6f94bc);border-radius:10px;border:2px dashed rgba(255,255,255,.55);box-shadow:0 8px 14px rgba(0,0,0,.5)}
.bz-phone{position:fixed;left:24px;top:60px;bottom:24px;width:280px;max-height:620px;background:#0d0f12;border:8px solid #1d2128;border-radius:30px;z-index:6;display:none;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.7);cursor:auto}
.bz-phone .ph{padding:10px 12px;background:#14171c;display:flex;justify-content:space-between;align-items:center;font-size:11px;letter-spacing:.1em;color:#9bb0c2;gap:6px}
.bz-phone .ph b{color:#ff5a4d;font:700 13px "SF Mono",Menlo,monospace}.bz-phone .mc{height:5px;background:#1b2128}.bz-phone .mc i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3fd6a0,#7be8ff)}
.bz-phone .feed{flex:1;overflow:auto}.bz-phone .post{display:flex;gap:10px;padding:12px;border-bottom:1px solid #1d232b;color:#dfe8f0}
.bz-phone .post>i{flex:none;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 14px Arial;color:#fff;font-style:normal}
.bz-phone .post p{font-size:13px;line-height:1.45;margin:2px 0 5px;color:#e6edf3}.bz-phone .post small{color:#7f93a5}.bz-phone .post b{font-size:12px;color:#9bd3ff}
.bz-sweat{position:absolute;inset:0;pointer-events:none;z-index:3}
.bz-sweat .drop{position:absolute;left:0;top:0;border-radius:50% 50% 50% 50%/70% 70% 30% 30%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.95),rgba(170,215,255,.7) 55%,rgba(90,150,220,.55));box-shadow:0 0 6px rgba(150,200,255,.6)}
.bz-sweat .smudge{position:absolute;border-radius:50% 50% 50% 50%/58% 58% 42% 42%;backdrop-filter:blur(3px) saturate(1.3);-webkit-backdrop-filter:blur(3px) saturate(1.3);background:radial-gradient(circle at 34% 28%,rgba(255,255,255,.7),rgba(190,225,255,.2) 38%,rgba(120,175,230,.14) 72%);box-shadow:inset 0 -4px 6px rgba(0,0,0,.3),inset 2px 3px 4px rgba(255,255,255,.55),0 3px 5px rgba(0,0,0,.35)}
.bz-sweat .sp{position:absolute;width:6px;height:6px;border-radius:50%;background:rgba(190,225,255,.85)}
.bz-sweat .streak{position:absolute;width:5px;border-radius:3px;background:linear-gradient(rgba(190,225,255,.7),rgba(190,225,255,0))}
.bz-vig{position:absolute;inset:0;pointer-events:none;z-index:3;opacity:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 42%,rgba(150,0,0,.9) 100%)}
.bay.shorted{box-shadow:inset 0 0 0 3px #ff9d2e,0 0 18px rgba(255,160,40,.7),0 3px 8px rgba(0,0,0,.5)}
.bay .zap{position:absolute;inset:0;z-index:4;display:none;align-items:center;justify-content:center;text-align:center;background:rgba(10,14,20,.62);color:#ffcf5a;font:700 13px/1.5 "Segoe UI",Arial;letter-spacing:.18em;pointer-events:none;animation:bzz .18s steps(2) infinite}
.bay.shorted .zap{display:flex}@keyframes bzz{0%{background:rgba(10,14,20,.62)}50%{background:rgba(40,30,8,.72)}}
.bay .spark{position:absolute;width:3px;height:3px;border-radius:50%;background:#fff6c2;box-shadow:0 0 8px 3px #ffb52e;z-index:5;pointer-events:none}
.bz-hand.slip{border-color:#7fc4ff;box-shadow:0 0 0 6px rgba(120,190,255,.45)}
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
  const b = el("div", "bay " + cls, '<i class="bolt a"></i><i class="bolt b"></i><i class="bolt c"></i><i class="bolt d"></i><div class="zap"><div>SHORT CIRCUIT<br><small>WIPE IT WITH THE CLOTH</small></div></div>', parent);
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
  const bMode = el("button", "bz-btn", "", bar), bSnd = el("button", "bz-btn", "SOUND ON", bar), bExit = el("button", "bz-btn", "EXIT (Esc)", bar);
  const stEl = bar.querySelector("#bzSt");

  const view = el("div", "bz-view", null, root);
  el("div", "bz-room", null, view);
  const wrap = el("div", "bz-wrap", null, view);
  const bomb = el("div", "bz-bomb", null, wrap);
  el("div", "bz-table", null, bomb);
  const cs = el("div", "bz-case", null, bomb);
  const inn = el("div", "bz-in", null, cs);
  const bookEl = el("div", "bz-item book", "<i></i>BOMB DEFUSAL<br>HANDBOOK<small>CLICK TO READ</small>", bomb);
  const clothEl = el("div", "bz-item cloth", "CLOTH<br>HOLD + DRAG<br>TO WIPE", bomb);
  const phoneEl = el("div", "bz-item phone", "<i>NEW<br>NOTIFICATIONS<br>(tap to scroll)</i>", bomb);
  const sweat = el("div", "bz-sweat", null, bomb);
  const vig = el("div", "bz-vig", null, root);
  const flash = el("div", "bz-flash", null, root);
  const hand = el("div", "bz-hand", null, root);
  const clothHeld = el("div", "bz-clothheld", null, root);

  /* build modules */
  let level, S;
  let drops = [], smudges = [], spawnAcc = 0;
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
  const rowS = el("div", "row s", '<label><span>STRESS (METER)</span><b>--</b></label><div class="bar"><i></i></div>', bVit); rowS.style.top = "44px";
  const rowM = el("div", "row f", '<label><span>MIND CLEAR (PHONE)</span><b>0%</b></label><div class="bar"><i style="background:linear-gradient(90deg,#3fd6a0,#7be8ff)"></i></div>', bVit); rowM.style.top = "90px";
  const vNote = el("div", "note", "", bVit);
  const effect = el("div", "row", '<label><span>HAND TREMOR</span><b id="bzT">0 px</b></label><label style="margin-top:5px"><span>CLOCK SPEED</span><b id="bzC">x1.00</b></label><label style="margin-top:5px"><span>HEART RATE</span><b id="bzH">64 bpm</b></label><label style="margin-top:5px"><span>SWEAT ON BOMB</span><b id="bzW">0</b></label>', bVit); effect.style.top = "138px";

  /* manual */
  const man = el("div", "bz-man", "", root);
  man.innerHTML = `<div class="paper"></div>`;
  const paper = man.querySelector(".paper"); const mclose = el("button", "mclose", "PUT DOWN", null); man.insertBefore(mclose, man.firstChild); mclose.onclick = () => toggleManual(false); let blots = [], pdrops = [], pAcc = 0;

  /* test tools */
  const tools = el("div", "bz-tools", `<b style="letter-spacing:.2em;color:#e6c46a">MANUAL TEST MODE</b><label>Stress <input type="range" id="bzSl" min="0" max="100" value="0"><b id="bzSv">0</b></label><small>0 = calm, 100 = maximum stress</small><label><input type="checkbox" id="bzNo"> simulate "no reading"</label>`, root);
  const sl = tools.querySelector("#bzSl"), sv = tools.querySelector("#bzSv"), no = tools.querySelector("#bzNo");
  sl.addEventListener("input", () => { sv.textContent = sl.value; });

  const phoneUi = el("div", "bz-phone", `<div class="ph"><span>SCROLL TO CLEAR YOUR HEAD</span><b id="phClock">--:--</b></div><div class="mc"><i></i></div><div class="feed"></div><div class="ph"><span id="phMc">MIND CLEAR 0%</span><button class="bz-btn" id="phDown">PUT DOWN</button></div>`, root);
  const feed = phoneUi.querySelector(".feed"), phClock = phoneUi.querySelector("#phClock"), phMc = phoneUi.querySelector("#phMc"), phBar = phoneUi.querySelector(".mc i");
  let lastScroll = 0;
  feed.addEventListener("scroll", () => {
    const dy = Math.abs(feed.scrollTop - lastScroll); lastScroll = feed.scrollTop;
    if (S && S.phone && S.state === "running") S.calm = Math.min(T.calmMax, S.calm + dy / T.calmPerPx);
    if (feed.scrollTop + feed.clientHeight > feed.scrollHeight - 500) addPosts(8);
  });
  phoneUi.querySelector("#phDown").onclick = () => togglePhone(false);
  const endEl = el("div", "bz-end", "", root);
  const bayOf = { timer: bTimer, info: bInfo, button: bBtn, wires: bWire, keypad: bKey, vitals: bVit };
  let mode = opts.mode || ((opts.stress || opts.focus) ? "live" : "test");
  function setMode(m) {
    mode = m; tools.style.display = m === "test" ? "flex" : "none";
    bMode.textContent = m === "test" ? "MODE: MANUAL TEST" : "MODE: LIVE (MUSE)";
    bMode.style.borderColor = m === "test" ? "#e6c46a" : "#43f28a";
    if (S) emit("mode", { mode: m });
  }
  bMode.onclick = () => { if (S && S.state === "running" && S.t > 1 && !confirm("Switching mode mid-game mixes test and real readings in this run's results. Switch anyway?")) return; setMode(mode === "test" ? "live" : "test"); };

  /* ---------- the service sheet: written for THIS bomb only (rules differ on every bomb) ---------- */
  function renderManual() {
    const lv = level, esc = x => x;
    const wr = lv.wires.rules.map((r, i) => `<li>${L.wireRuleText(r, i === 0)}</li>`).join("");
    const br = lv.button.rules.map((r, i) => `<li>${L.buttonRuleText(r, i === 0)}</li>`).join("");
    const cols = lv.keypad.columns.map((c, i) => `<div><small>Column ${i + 1}</small>${c.map(x => `<div style="border:0;padding:0">${x}</div>`).join("")}</div>`).join("");
    paper.innerHTML = `<h2>Service sheet</h2><p><i>Issued for bomb</i> <b style="letter-spacing:.14em;font-family:Menlo,monospace">${lv.serial}</b>. <i>These instructions are only valid for this bomb. Check the serial number on the plate matches. Keep this paper dry.</i></p>
     <h3>0. Before you start</h3><ol><li>The <b>serial number</b> is on the white plate at the top middle of the bomb. "Odd" or "even" always means its last digit.</li><li>Three strikes or an empty clock and it goes off. Every wrong action is a strike.</li><li>The clock keeps running while you read.</li></ol>
     <h3>1. Wire panel (${lv.wires.colors.length} wires)</h3><p>Wires are numbered top to bottom. Count the colours first. Use the <b>first rule that fits</b>; cut only the wire it names.</p><ol>${wr}</ol>
     <h3>2. The button</h3><p>Note the button's colour and the word on it. Use the <b>first rule that fits</b>.</p><ol>${br}</ol><p>${L.stripRuleText(lv.button.stripDigits)}</p>
     <p><b>Hints:</b> a <i>tap</i> is a quick press and release (under half a second). When holding, the digit can be in any of the four places of the clock, for example 02:41 has a 4.</p>
     <h3>3. Symbol keypad</h3><p>Find the <b>one column</b> below that contains all four symbols on your keypad. Press them in the order they appear in that column, top to bottom.</p><div class="cols">${cols}</div>
     <h3>4. Keep calm</h3><p>This prototype reads your stress. When it rises your hands shake and sweat drips on the bomb: wet patches blur what is under them, a press on one slips, and three on a module short it out until you wipe it. Sweat also soaks <b>this paper</b>: wet blotches blur the words, and a dried blotch leaves a stain that is still hard to read. Wipe the bomb by holding the cloth on the table and dragging it over the wet patches; click the cloth while you read to dab the page dry. If your hands are shaking, pick up the phone on the table and scroll for a while: it clears your head, but the clock keeps running. Stay calm.</p>`;
    bookEl.innerHTML = `<i></i>SERVICE SHEET<br><span style="font-family:Menlo,monospace;letter-spacing:.1em">${lv.serial}</span><small>CLICK TO READ</small>`;
  }

  /* ---------- level setup ---------- */
  function build(seed) {
    level = L.makeLevel(seed); level.timeLimit = T.timeLimit; level.maxStrikes = T.maxStrikes;
    S = { remaining: level.timeLimit, strikes: 0, state: "running", solved: { wires: false, button: false, keypad: false }, cut: [false, false, false, false, false],
      pressAt: null, pressItem: null, progress: 0, stressSm: 0, stressSum: 0, stressHi: 0, calm: 0, calmPeak: 0, phoneSec: 0, phone: false, cloth: false, t: 0, nextGlitch: 6, glitchUntil: 0, lastSec: -1, events: [], slips: 0, drops: 0, wipes: 0, blocked: 0, blots: 0, nextSpike: 4, spikeUntil: 0, beat: 0, lastBeat: 0 };
    pdrops.forEach(d => d.e.remove()); pdrops = []; blots.forEach(b => b.e.remove()); blots = []; pAcc = 0;
    drops.forEach(d => d.e.remove()); drops = []; smudges.forEach(m => m.e.remove()); smudges = []; sweat.innerHTML = ""; spawnAcc = 0;
    items.length = 0; toggleManual(false); togglePhone(false); clothUp(); bWire.querySelectorAll('.hit').forEach(x => x.remove());
    plate.lastChild.textContent = level.serial;
    ledB.className = ledW.className = ledK.className = "led";
    reg(bookEl, () => toggleManual()); reg(phoneEl, () => togglePhone(true)); reg(clothEl, clothDown, clothUp);
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
    renderManual();
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
    if (shorted("wires")) return zapBlocked("wires");
    S.cut[i] = true; drawWire(i, true); beep(1500, .05, "triangle", .06);
    const r = L.judgeWire(level, i);
    if (r === "solved") solveModule("wires", ledW); else strike("wrong wire");
  }
  function pressButton() {
    if (S.state !== "running" || S.solved.button) return;
    if (shorted("button")) return zapBlocked("button");
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
    if (shorted("keypad")) return zapBlocked("keypad");
    k.classList.add("dn"); beep(520, .05, "square", .05);
    if (L.judgeKey(level, S.progress, sym) === "ok") {
      k.classList.add("ok"); kLeds.children[S.progress].classList.add("on"); S.progress++;
      if (S.progress === 4) solveModule("keypad", ledK);
    } else { k.classList.add("bad"); setTimeout(() => k.classList.remove("bad"), 450); strike("wrong key"); }
  }

  /* ---------- sweat ---------- */
  function spawnDrop() {
    const r = 5 + Math.random() * 4, d = el("div", "drop", null, sweat);
    d.style.width = r * 2 + "px"; d.style.height = r * 2.6 + "px";
    drops.push({ e: d, x: 190 + Math.random() * 880, y: -50, vy: 30 + Math.random() * 60, target: 80 + Math.random() * 510, r });
  }
  function splat(d) {
    d.e.remove(); S.drops++; beep(1500 + Math.random() * 700, .05, "sine", .03);
    const R = 16 + Math.random() * 20, m = el("div", "smudge", null, sweat);
    m.style.cssText = `width:${R * 2}px;height:${R * 2.2}px;left:${d.x - R}px;top:${d.target - R}px`;
    smudges.push({ e: m, x: d.x, y: d.target, R, born: S.t, mod: moduleAt(d.x, d.target) });
    while (smudges.length > T.maxSmudges) smudges.shift().e.remove();
    for (let i = 0; i < 6; i++) {
      const p = el("i", "sp", null, sweat), a = Math.random() * Math.PI * 2, dist = 14 + Math.random() * 26;
      p.style.left = d.x + "px"; p.style.top = d.target + "px";
      p.animate([{ transform: "translate(0,0) scale(1)", opacity: .9 }, { transform: `translate(${Math.cos(a) * dist}px,${Math.sin(a) * dist - 8}px) scale(.3)`, opacity: 0 }], { duration: 450 + Math.random() * 300, easing: "ease-out" }).onfinish = () => p.remove();
    }
    if (Math.random() < 0.6) {
      const st = el("div", "streak", null, sweat); st.style.left = d.x - 2 + "px"; st.style.top = d.target + R * 0.6 + "px";
      st.animate([{ height: "0px", opacity: .6 }, { height: 50 + Math.random() * 90 + "px", opacity: 0 }], { duration: 1800 + Math.random() * 800, easing: "ease-in" }).onfinish = () => st.remove();
    }
  }
  /* ---------- sweat on the manual: wet blotches blur the words, dried ones leave a stain ---------- */
  function spawnPaperDrop() {
    const r = man.getBoundingClientRect(), d = el("div", "pdrop", null, root);
    d.style.display = "block"; const x = r.left + 24 + Math.random() * (r.width - 48);
    pdrops.push({ e: d, x, y: r.top - 10, vy: 40 + Math.random() * 60, ty: r.top + 24 + Math.random() * (r.height - 48) });
  }
  function paperSplat(d) {
    d.e.remove(); beep(1300 + Math.random() * 500, .04, "sine", .02);
    const pr = paper.getBoundingClientRect(), R = 22 + Math.random() * 30, e = el("div", "blot wet", null, paper);
    e.style.cssText = `width:${R * 2}px;height:${R * 1.7}px;left:${d.x - pr.left}px;top:${d.ty - pr.top}px`;
    blots.push({ e, wet: true, born: S.t }); S.blots++; if (blots.length > 14) blots.shift().e.remove();
    emit("paper_wet", {});
  }
  function dryBlot(bl) { if (!bl.wet) return; bl.wet = false; bl.e.className = "blot dry"; }

  /* which module a point on the bomb (design pixels) falls on */
  function moduleAt(x, y) {
    const b = bomb.getBoundingClientRect(), px = b.left + x * k, py = b.top + y * k;
    for (const key of Object.keys(bayOf)) { const r = bayOf[key].getBoundingClientRect(); if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return key; }
    return null;
  }
  const wetCount = key => smudges.filter(m => m.mod === key).length;
  const shorted = key => S.state === "running" && L.isShorted(wetCount(key), T);
  function zapBlocked(key) {
    S.blocked++; beep(90, .15, "sawtooth", .07); const z = bayOf[key]; if (z) { z.animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 160 }); }
    emit("blocked", { module: key });
  }
  function sparks() {
    ["wires", "button", "keypad", "timer"].forEach(key => {
      if (!shorted(key) || Math.random() > 0.35) return; const bz = bayOf[key], sp = el("i", "spark", null, bz);
      sp.style.left = 20 + Math.random() * (bz.clientWidth - 40) + "px"; sp.style.top = 20 + Math.random() * (bz.clientHeight - 40) + "px";
      sp.animate([{ transform: "scale(1.8)", opacity: 1 }, { transform: `translate(${(Math.random() - .5) * 30}px,${(Math.random() - .5) * 30}px) scale(.2)`, opacity: 0 }], { duration: 260 }).onfinish = () => sp.remove();
      if (Math.random() < 0.3) beep(1800 + Math.random() * 1200, .03, "sawtooth", .02);
    });
  }
  /* ---------- table objects: manual, cloth, phone ---------- */
  function toggleManual(open) {
    const want = open == null ? man.style.display !== "block" : open;
    man.style.display = want ? "block" : "none"; bookEl.style.opacity = want ? ".55" : "";
    if (want) togglePhone(false);
  }
  function clothDown() {
    if (!S || S.state !== "running") return;
    if (man.style.display === "block") { const n = blots.filter(b => b.wet).length; blots.forEach(dryBlot); if (n) { beep(260, .1, "triangle", .04); emit("dab", { blotches: n }); } return; }
    S.cloth = true; clothEl.classList.add("lifted"); clothHeld.style.display = "block"; beep(250, .06, "triangle", .04);
  }
  function clothUp() { if (S) S.cloth = false; clothEl.classList.remove("lifted"); clothHeld.style.display = "none"; }
  function wipeWithCloth() {
    if (!handPos || !smudges.length) return;
    let n = 0;
    for (let i = smudges.length - 1; i >= 0; i--) {
      const r = smudges[i].e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (Math.hypot(handPos[0] - cx, handPos[1] - cy) < Math.max(r.width, r.height) / 2 + 36 * k) { smudges[i].e.remove(); smudges.splice(i, 1); n++; }
    }
    if (n) { S.wipes += n; beep(190 + Math.random() * 90, .05, "triangle", .03); emit("wipe", { patches: n }); }
  }
  const FEED_NAMES = ["sam", "juno", "pixel_pal", "mr.toast", "k8", "bean", "moss", "lemon", "dax", "orbit", "nova", "pip"];
  const FEED_TEXT = ["just spilled coffee on my keyboard again", "hot take: cereal is a soup", "my cat has strong opinions about my meetings", "15 reasons to drink more water (number 7 will shock you)", "does anyone else's wifi only work while standing on one leg", "rate my sandwich 9/10", "local pigeon elected mayor of the park", "the moon looks nice tonight", "found $5 in old jeans, we are so back", "why do printers hate me personally", "i have named all my houseplants and they are judging me", "unpopular opinion: socks should come in threes", "this dog wearing sunglasses is the best thing today", "tiny turtle slowly crosses road, internet cheers", "me: i will sleep early. also me at 2am: one more video"];
  const FEED_COL = ["#e0562f", "#2f8de0", "#7a4de0", "#2fb37a", "#d6a21f", "#d9418c"];
  function addPosts(n) {
    for (let i = 0; i < n; i++) {
      const nm = FEED_NAMES[Math.floor(Math.random() * FEED_NAMES.length)], c = FEED_COL[Math.floor(Math.random() * FEED_COL.length)];
      el("div", "post", `<i style="background:${c}">${nm[0].toUpperCase()}</i><div><b>@${nm}</b><p>${FEED_TEXT[Math.floor(Math.random() * FEED_TEXT.length)]}</p><small>\u2665 ${(Math.random() * 9 + 0.2).toFixed(1)}k &nbsp; \u21BB ${Math.floor(Math.random() * 900)}</small></div>`, feed);
    }
  }
  function togglePhone(open) {
    if (!S) return; const was = S.phone; S.phone = !!open && S.state === "running"; phoneUi.style.display = S.phone ? "flex" : "none"; phoneEl.style.opacity = S.phone ? ".4" : "";
    if (S.phone) { toggleManual(false); if (!feed.children.length) addPosts(12); }
    if (S.phone !== was) emit(S.phone ? "phone_up" : "phone_down", { calm: +S.calm.toFixed(2) });
  }
  function slipAt(x, y) { /* a press on a wet patch slides mostly downward */
    for (const m of smudges) {
      const r = m.e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (Math.hypot(x - cx, y - cy) < Math.max(r.width, r.height) / 2) {
        S.slips++; hand.classList.add("slip"); setTimeout(() => hand.classList.remove("slip"), 250); beep(220, .08, "sine", .04); emit("slip", {});
        return [x + (Math.random() - .5) * T.slipPx * k * .6, y + T.slipPx * k * (.6 + Math.random() * .8)];
      }
    }
    return [x, y];
  }

  /* ---------- end states ---------- */
  function summary() {
    const dur = Math.max(S.t, 0.001);
    return { seed: level.seed, mode, result: S.state, secondsPlayed: +S.t.toFixed(1), clockLeft: +Math.max(S.remaining, 0).toFixed(1), strikes: S.strikes,
      modulesSolved: nSolved(), sweatDrops: S.drops, slips: S.slips, wipes: S.wipes, blockedPresses: S.blocked, paperBlots: S.blots, avgStress: +(S.stressSum / dur).toFixed(3), secondsHighStress: +S.stressHi.toFixed(1),
      phoneSeconds: +S.phoneSec.toFixed(1), peakMindClear: +S.calmPeak.toFixed(2), events: S.events.slice() };
  }
  function finish(kind, title, msg) {
    S.state = kind; const sm = summary();
    endEl.innerHTML = `<div class="card ${kind === "won" ? "win" : "lose"}"><h1>${title}</h1><p>${msg}</p><div class="stats">
      <div><span>Time played</span><b>${sm.secondsPlayed} s</b></div><div><span>Clock left</span><b>${sm.clockLeft} s</b></div><div><span>Strikes</span><b>${sm.strikes} / ${level.maxStrikes}</b></div>
      <div><span>Modules solved</span><b>${sm.modulesSolved} / 3</b></div><div><span>Average stress (0-1)</span><b>${sm.avgStress}</b></div><div><span>Seconds under high stress</span><b>${sm.secondsHighStress}</b></div>
      <div><span>Paper blotches</span><b>${sm.paperBlots}</b></div><div><span>Sweat drops / slips / shorted presses</span><b>${sm.sweatDrops} / ${sm.slips} / ${sm.blockedPresses}</b></div><div><span>Time on the phone</span><b>${sm.phoneSeconds} s</b></div><div><span>Mode</span><b>${mode === "test" ? "manual test (not real data)" : "live (Muse)"}</b></div><div><span>Seed</span><b>${sm.seed}</b></div></div>
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
    if (S.state === "running") handPos = slipAt(handPos[0], handPos[1]);
    if (S.state !== "running") return;
    hand.classList.add("dn");
    const it = hit(handPos[0], handPos[1]); downItem = it; if (it && it.down) it.down();
  });
  function up() { hand.classList.remove("dn"); if (downItem && downItem.up) downItem.up(); downItem = null; }
  window.addEventListener("pointerup", up);

  /* ---------- main loop ---------- */
  let raf = 0, last = performance.now();
  function frame(now) { raf = requestAnimationFrame(frame); update(now); }
  function update(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    let target = 0, noRead = false;
    if (mode === "test") { noRead = no.checked; target = noRead ? 0 : +sl.value / 100; }
    else if (opts.stress) { const v = opts.stress(); noRead = v == null || !isFinite(v); target = noRead ? 0 : v; }
    else if (opts.focus) { const f = opts.focus(); noRead = f == null; target = L.stressFromFocus(f, T); }
    else noRead = true;
    S.stressSm += (target - S.stressSm) * (1 - Math.exp(-dt / T.smoothingSec));
    if (S.state === "running" && !S.phone) S.calm = Math.max(0, S.calm - T.calmDecay * dt);
    S.calmPeak = Math.max(S.calmPeak, S.calm);
    const s = L.effectiveStress(S.stressSm, S.calm), rate = L.clockRate(s, S.strikes, T), shake = L.handShake(s, T);
    if (S.state === "running") {
      S.t += dt; S.remaining -= dt * rate; S.stressSum += S.stressSm * dt; if (S.stressSm > 0.5) S.stressHi += dt; if (S.phone) S.phoneSec += dt;
      const sec = Math.ceil(S.remaining);
      if (sec !== S.lastSec) { S.lastSec = sec; beep(rate > 1.3 ? 1000 : 800, .04, "square", .03); }
      if (S.remaining <= 0) { S.remaining = 0; explode("time"); }
      if (s > T.glitchStress && S.t > S.nextGlitch) { S.glitchUntil = S.t + 0.7; S.nextGlitch = S.t + 6 + Math.random() * 6; beep(70, .5, "sawtooth", .05); root.classList.add("bz-glitch"); setTimeout(() => root.classList.remove("bz-glitch"), 700); }
      spawnAcc += L.sweatRate(s, T) * dt; while (spawnAcc >= 1) { spawnAcc -= 1; spawnDrop(); }
      if (man.style.display === "block") { pAcc += L.sweatRate(s, T) * 0.7 * dt; while (pAcc >= 1) { pAcc -= 1; spawnPaperDrop(); } }
      if (s > 0.5 && S.t > S.nextSpike) { S.spikeUntil = S.t + 0.45; S.nextSpike = S.t + 3 + Math.random() * 3; }
      S.beat += dt * L.heartBpm(s) / 60;
      if (Math.floor(S.beat) > S.lastBeat) { S.lastBeat = Math.floor(S.beat); if (s > 0.25) { beep(60, .12, "sine", .09); setTimeout(() => beep(52, .1, "sine", .06), 210); } }
      if (S.pressAt != null && (performance.now() - S.pressAt) / 1000 > 0.4) { strip.className = "strip on stripc-" + level.button.strip; }
    }
    if (S.state === "running" || S.state === "won") {
      let str = clockDigits(); if (S.state === "running" && (S.t < S.glitchUntil || shorted("timer"))) str = String(Math.floor(Math.random() * 9000 + 1000));
      setDigits(str);
    }
    ["timer", "button", "wires", "keypad"].forEach(key => bayOf[key].classList.toggle("shorted", shorted(key)));
    sparks();
    for (let i = pdrops.length - 1; i >= 0; i--) { const d = pdrops[i]; d.vy += 1100 * dt; d.y += d.vy * dt; d.e.style.transform = `translate(${d.x}px,${d.y}px)`; if (d.y >= d.ty) { pdrops.splice(i, 1); paperSplat(d); } }
    blots.forEach(bl => { if (bl.wet && S.t - bl.born > T.smudgeLife) dryBlot(bl); });
    /* falling sweat, wet patches, heartbeat vignette */
    for (let i = drops.length - 1; i >= 0; i--) { const d = drops[i]; d.vy += 1100 * dt; d.y += d.vy * dt; d.e.style.transform = `translate(${d.x}px,${d.y}px)`; if (d.y >= d.target) { drops.splice(i, 1); splat(d); } }
    for (let i = smudges.length - 1; i >= 0; i--) { const m = smudges[i], age = S.t - m.born; if (age > T.smudgeLife) { m.e.remove(); smudges.splice(i, 1); } else m.e.style.opacity = Math.min(1, (T.smudgeLife - age) / 4); }
    const ph = S.beat % 1, env = Math.exp(-ph * 7) + 0.6 * Math.exp(-Math.abs(ph - 0.22) * 25);
    vig.style.opacity = s > 0.12 ? Math.min(1, s * (0.25 + 0.55 * env)) : 0;
    if (S.state === "running") bomb.style.filter = s > 0.6 ? `blur(${((s - 0.6) / 0.4 * 1.1 * (0.4 + env * 0.6)).toFixed(2)}px)` : "";
    if (S.cloth && handPos && S.state === "running") { clothHeld.style.transform = `translate(${handPos[0]}px,${handPos[1]}px) rotate(-6deg)`; wipeWithCloth(); }
    if (S.state !== "running" && S.cloth) clothUp();
    /* hand shake */
    const tt = now / 1000;
    const sp = S.t < S.spikeUntil ? 1 + 1.2 * Math.sin(Math.PI * (1 - (S.spikeUntil - S.t) / 0.45)) : 1;
    jit = [shake * sp * k * (Math.sin(tt * 6.3 + 1) + 0.6 * Math.sin(tt * 11.7 + 2)) / 1.6, shake * sp * k * (Math.sin(tt * 5.1 + 3) + 0.6 * Math.sin(tt * 13.1)) / 1.6];
    if (raw) { handPos = [raw[0] + jit[0], raw[1] + jit[1]]; if (overView) { hand.style.display = "block"; hand.style.transform = `translate(${handPos[0]}px,${handPos[1]}px)`; } }
    bomb.style.transform = `scale(${k}) rotate(${(s * 0.5 * Math.sin(tt * 1.7)).toFixed(3)}deg)`;
    /* vitals */
    rowS.querySelector("b").textContent = noRead ? "--" : Math.round(S.stressSm * 100) + "%"; rowS.querySelector(".bar i").style.width = (S.stressSm * 100) + "%";
    rowM.querySelector("b").textContent = Math.round(S.calm / T.calmMax * 100) + "%"; rowM.querySelector(".bar i").style.width = (S.calm / T.calmMax * 100) + "%";
    phMc.textContent = "MIND CLEAR " + Math.round(S.calm / T.calmMax * 100) + "%"; phBar.style.width = (S.calm / T.calmMax * 100) + "%"; phClock.textContent = clockDigits().replace(/^(..)(..)$/, "$1:$2");
    effect.querySelector("#bzT").textContent = shake.toFixed(1) + " px"; effect.querySelector("#bzC").textContent = "x" + rate.toFixed(2); effect.querySelector("#bzH").textContent = Math.round(L.heartBpm(s)) + " bpm"; effect.querySelector("#bzW").textContent = smudges.length;
    vNote.textContent = mode === "test" ? "MANUAL TEST MODE: stress is set by the slider. Results are not real data." : noRead ? "LIVE MODE: no stress reading yet. Connect the headband and calibrate the stress meter in the panel. Until then there are no stress effects." : "LIVE MODE: driven by the experimental stress meter (heart rate, frontal beta/alpha, face tension). Not a validated stress measure.";
    stEl.textContent = (mode === "test" ? "MANUAL TEST" : "LIVE") + (opts.status ? "  |  " + opts.status() : "");
  }

  /* ---------- layout, keys ---------- */
  function fit() {
    const w = view.clientWidth, h = view.clientHeight; k = Math.max(0.3, Math.min((w - 40) / 1260, (h - 24) / 640));
    wrap.style.width = 1260 * k + "px"; wrap.style.height = 640 * k + "px";
  }
  function onKey(e) {
    if (e.key === "Escape") { if (man.style.display === "block") toggleManual(false); else if (S && S.phone) togglePhone(false); else close(); }
  }
  bSnd.onclick = () => { muted = !muted; bSnd.textContent = muted ? "SOUND OFF" : "SOUND ON"; };
  bExit.onclick = () => close();
  window.addEventListener("keydown", onKey); window.addEventListener("resize", fit);

  function close() {
    if (!ui) return;
    cancelAnimationFrame(raf); window.removeEventListener("keydown", onKey); window.removeEventListener("resize", fit); window.removeEventListener("pointerup", up);
    root.remove(); ui = null; try { opts.onClose && opts.onClose(); } catch (e) { console.error(e); }
  }

  /* advance(seconds): run the simulation faster than real time (used by tests and screenshots) */
  function advance(sec) { let n = last; for (let i = 0; i < Math.round(sec * 60); i++) { n += 1000 / 60; update(n); } last = performance.now(); }
  ui = { close, restart: build, state: () => S, level: () => level, el: root, advance };
  fit(); build(opts.seed); setMode(mode); raf = requestAnimationFrame(frame);
}

root.BombUI = { open, close: () => ui && ui.close(), isOpen: () => !!ui, _ui: () => ui };
})(typeof window !== "undefined" ? window : globalThis);
