/* Game menu for the Muse panel. Games register themselves here; the panel only supplies live signals.

   Add a game with one call (before or after the panel loads):

     GameMenu.register({
       id: "my-game",                       // unique
       title: "My Game",
       blurb: "One line about it.",
       input: "arousal",                    // what drives it: "arousal" | "focus" | "none" (shown as a badge)
       kind: "inline",                      // "inline" runs in this page; "external" is a separate app (shows `howto`)
       scripts: ["game/my-game.js"],        // optional: loaded the first time the game is played
       needs: ctx => ({ ok: true, msg: "" }),   // optional: say why it cannot start yet
       launch: (ctx, done) => MyGame.open({ stress: ctx.stress, onClose: done }),
       howto: "Run game-x/Run.bat"          // for kind "external"
     });

   ctx (built by the panel on every call): stage, connected, focusReady, stressLive, focus(), stress() [0..1], sensors(), status() */
"use strict";
(function (root) {

const games = [];
let cfg = null, overlay = null;
const loaded = {};

function register(g) {
  const i = games.findIndex(x => x.id === g.id);
  if (i >= 0) games[i] = g; else games.push(g);
  if (overlay) render();
}
function load(src) {
  if (loaded[src]) return loaded[src];
  return loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("could not load " + src)); document.head.appendChild(s); });
}

const CSS = `
#gmOverlay{position:fixed;inset:0;z-index:99990;background:rgba(2,4,24,.82);display:none;align-items:center;justify-content:center;font-family:"Segoe UI",system-ui,sans-serif;color:#e9f1ff}
#gmOverlay .box{width:min(880px,92vw);max-height:88vh;overflow:auto;background:linear-gradient(180deg,#0a1260,#050a34);border:1.5px solid rgba(90,174,255,.85);border-radius:12px;padding:22px 26px;box-shadow:0 0 40px rgba(60,120,255,.35)}
#gmOverlay h2{font-weight:300;letter-spacing:.4em;font-size:22px;margin:0 0 4px}#gmOverlay .sub{color:#9fb2e6;font-size:12px;letter-spacing:.06em;margin-bottom:16px}
#gmOverlay .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
#gmOverlay .card{background:rgba(8,16,80,.7);border:1px solid rgba(110,150,255,.45);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px}
#gmOverlay .card .ic{width:52px;height:52px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:30px;background:rgba(80,120,255,.2)}
#gmOverlay .card h3{margin:0;font-size:16px;font-weight:600;letter-spacing:.06em}#gmOverlay .card p{margin:0;font-size:12px;color:#b9c8f5;line-height:1.45;flex:1}
#gmOverlay .badge{display:inline-block;font-size:10px;letter-spacing:.14em;padding:2px 8px;border-radius:10px;border:1px solid #6a8cff;color:#9fb2e6;align-self:flex-start}
#gmOverlay .badge.stress,#gmOverlay .badge.arousal{border-color:#ff8a5c;color:#ffb08f}#gmOverlay .badge.focus{border-color:#35e6ff;color:#8ff0ff}
#gmOverlay .msg{font-size:11px;color:#ffd166;min-height:14px}#gmOverlay .msg.ok{color:#7fe3a9}
#gmOverlay button{background:#16215a;border:1px solid #4a6adf;color:#e9f1ff;border-radius:6px;padding:8px 14px;font-size:12px;letter-spacing:.14em;cursor:pointer}#gmOverlay button:hover:not(:disabled){border-color:#7fe0ff}#gmOverlay button:disabled{opacity:.4;cursor:not-allowed}
#gmOverlay button.play{background:#2a5bd6;font-weight:700}#gmOverlay .close{float:right}
#gmOverlay .how{font:11px/1.5 "SF Mono",Menlo,monospace;background:rgba(0,0,0,.35);border-radius:6px;padding:8px;color:#cfe0ff}`;

function ctx() { return cfg && cfg.ctx ? cfg.ctx() : {}; }

function render() {
  const c = ctx(), grid = overlay.querySelector(".grid"); grid.innerHTML = "";
  games.forEach(g => {
    const n = g.needs ? g.needs(c) : { ok: true, msg: "" }, ext = g.kind === "external";
    const card = document.createElement("div"); card.className = "card";
    card.innerHTML = `<div class="ic">${g.icon || "🎮"}</div><h3>${g.title}</h3><span class="badge ${g.input || ""}">${ext ? "EXTERNAL APP" : (g.input ? g.input.toUpperCase() + " DRIVEN" : "")}</span><p>${g.blurb || ""}</p>${ext ? `<div class="how">${g.howto || ""}</div>` : ""}<div class="msg ${n.ok ? "ok" : ""}">${n.msg || ""}</div>`;
    if (!ext) {
      const b = document.createElement("button"); b.className = "play"; b.textContent = "PLAY"; b.disabled = !n.ok;
      b.onclick = () => play(g); card.appendChild(b);
    }
    grid.appendChild(card);
  });
}
async function play(g) {
  try {
    close();
    if (g.scripts) for (const s of g.scripts) await load(s);
    await g.launch(ctx(), () => { /* back to the panel */ });
  } catch (e) { console.error(e); alert("Could not start " + g.title + ": " + e.message); }
}
function open() { if (!overlay) build(); render(); overlay.style.display = "flex"; }
function close() { if (overlay) overlay.style.display = "none"; }
function build() {
  if (!document.getElementById("gmCss")) { const s = document.createElement("style"); s.id = "gmCss"; s.textContent = CSS; document.head.appendChild(s); }
  overlay = document.createElement("div"); overlay.id = "gmOverlay";
  overlay.innerHTML = `<div class="box"><button class="close">CLOSE (Esc)</button><h2>GAMES</h2><div class="sub">Pick a game. Games driven by your body signals work best once the headband is connected and calibrated.</div><div class="grid"></div></div>`;
  overlay.addEventListener("pointerdown", e => { if (e.target === overlay) close(); });
  overlay.querySelector(".close").onclick = close;
  addEventListener("keydown", e => { if (e.key === "Escape" && overlay.style.display === "flex") { e.stopPropagation(); close(); } }, true);
  document.body.appendChild(overlay);
}
/* attach to the panel's game button */
function attach(c) {
  cfg = c;
  if (c.note) c.note.textContent = "GAME MENU";
  if (c.button) { c.button.disabled = false; c.button.style.opacity = "1"; c.button.style.cursor = "pointer"; c.button.title = "Open the game menu"; c.button.addEventListener("click", open); }
}

/* ---------- built-in games ---------- */
register({
  id: "defuse", title: "Defuse", icon: "💣", input: "arousal", kind: "inline",
  blurb: "Defuse a bomb using its own service sheet. The more worked up your body is (heart rate, muscle tension, movement), the more your finger shakes and the more you sweat.",
  needs: c => c.stressLive ? { ok: true, msg: "Live: driven by your arousal meter." } : { ok: true, msg: "Test mode (a slider). For live play, connect the headband and sit still for 15 s." },
  launch: c => root.BombUI.open({ mode: c.stressLive ? "live" : "test", stress: c.stress, status: c.status })
});
register({
  id: "mariokart-js", title: "Mario Kart (browser)", icon: "🏎", input: "focus", kind: "inline", scripts: ["game/mkds.js", "game/mkds-render.js"],
  blurb: "Race on Figure-8 Circuit. Your focus score sets your kart's speed (0.5x to 1.5x).",
  needs: c => c.focusReady ? { ok: true, msg: "Focus baselines are set." } : { ok: false, msg: "Connect the headband and press Auto Set Baselines first." },
  launch: c => root.MKDSUI.open({ stage: c.stage, focus: c.focus, sensors: c.sensors, status: c.status, onClose: () => {} })
});
register({
  id: "mariokart-py", title: "Mario Kart (Python)", icon: "🐍", input: "focus", kind: "external",
  blurb: "The same race as a desktop pygame app. It reads the focus score the panel sends to this computer.",
  howto: "Windows: double-click game-py/Run Mario Kart.bat<br>Mac: python3 game-py/mario_kart.py (see game-py/README.md)"
});
register({
  id: "stacker", title: "Animal Stacker", icon: "🦒", input: "focus", kind: "external",
  blurb: "The earlier prototype. Press F for keyboard focus or let the panel drive the focus bar.",
  howto: "Windows: double-click game-link/Run Stacker.bat<br>(see game-link/README.md)"
});

root.GameMenu = { register, attach, open, close, games };
})(typeof window !== "undefined" ? window : globalThis);
