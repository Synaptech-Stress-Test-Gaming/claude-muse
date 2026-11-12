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
.bz-bomb{position:absolute;left:0;top:0;width:1264px;height:640px;transform-origin:0 0}
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
.btnbay .btip{position:absolute;left:8px;right:8px;bottom:6px;min-height:30px;display:flex;align-items:center;justify-content:center;text-align:center;font:700 11px/1.25 "Segoe UI",Arial;letter-spacing:.04em;color:#1c2630;background:rgba(255,255,255,.72);border-radius:6px;padding:3px 6px;opacity:0;transition:opacity .15s;pointer-events:none}
.btnbay .btip.show{opacity:1}.btnbay .btip.bad{background:#ffd9d4;color:#8d140d}
.sh-strips div.lit{outline:3px solid #b3302a;outline-offset:4px;border-radius:6px;animation:shlit .6s infinite alternate}@keyframes shlit{from{outline-color:#b3302a}to{outline-color:transparent}}
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
.bz-glitch .bz-case{animation:bzg .12s steps(2) infinite}@keyframes bzg{0%{filter:hue-rotate(0)}50%{filter:hue-rotate(60deg) brightness(1.25)}100%{filter:hue-rotate(-40deg)}}
.bz-flash{position:absolute;inset:0;pointer-events:none;background:#ff2a1a;opacity:0;z-index:4}
.bz-man{position:absolute;left:14px;right:14px;top:38px;bottom:14px;background:linear-gradient(90deg,rgba(0,0,0,.06),transparent 6%,transparent 94%,rgba(0,0,0,.07)),repeating-linear-gradient(0deg,rgba(120,100,60,.035) 0 1px,transparent 1px 3px),linear-gradient(180deg,#f4eedb,#ebe3cb);color:#22201a;border-radius:3px;box-shadow:0 3px 8px rgba(0,0,0,.45),inset 0 0 30px rgba(120,95,50,.18);overflow:hidden;font-family:"Segoe UI",-apple-system,Arial,sans-serif}
.bz-clip{position:absolute;left:50%;top:6px;width:150px;height:44px;margin-left:-75px;border-radius:8px 8px 4px 4px;background:linear-gradient(180deg,#e3e8ee,#8e9aa8);box-shadow:0 3px 5px rgba(0,0,0,.5),inset 0 2px 0 #fff;z-index:2}
.bz-clip::after{content:"";position:absolute;left:55px;top:8px;width:40px;height:14px;border-radius:7px;background:#3a4450;box-shadow:inset 0 2px 3px rgba(0,0,0,.6)}
.sh-tabs{display:flex;gap:4px;padding:22px 10px 0}.sh-tab{flex:1;height:36px;border-radius:7px 7px 0 0;background:#d5cbb0;color:#6a5f42;font:700 12px/36px "Segoe UI",Arial;letter-spacing:.14em;text-align:center;border:1.5px solid #a89c78;border-bottom:none}
.sh-tab.on{background:#fbf7ea;color:#22201a;box-shadow:0 -2px 0 #b3302a inset}.sh-tab.ok::after{content:" ✓";color:#1f8f4e}
.sh-page{position:absolute;left:10px;right:10px;top:58px;bottom:8px;background:#fbf7ea;border:1.5px solid #a89c78;border-radius:0 0 4px 4px;padding:8px 10px}
.sh-sn{display:flex;align-items:center;justify-content:space-between;font:700 11px "Segoe UI",Arial;letter-spacing:.2em;color:#6a5f42;border-bottom:1.5px dashed #b9ae8c;padding-bottom:6px;margin-bottom:6px}
.sh-sn b{font:700 22px Menlo,Consolas,monospace;letter-spacing:.14em;color:#22201a}.sh-sn b u{color:#b3302a;text-underline-offset:4px}
.sh-h{font:600 12.5px/1.35 "Segoe UI",Arial;color:#3a3120;margin:2px 0 6px}
.sh-row{display:flex;align-items:center;gap:6px;padding:6px 2px;border-bottom:1px solid #d9d0b6;min-height:86px}.sh-row:last-child{border-bottom:none}
.sh-n{flex:none;width:24px;height:24px;border-radius:50%;background:#22201a;color:#fbf7ea;font:700 13px/24px "Segoe UI",Arial;text-align:center}
.sh-if{flex:1;display:flex;align-items:center;gap:6px;min-width:0}.sh-do{flex:none;display:flex;align-items:center;gap:4px}
.sh-t{font:600 12.5px/1.4 "Segoe UI",Arial;color:#22201a}.sh-t small{font:600 10.5px "Segoe UI",Arial;color:#7a6b43;letter-spacing:.06em}.sh-t b{color:#b3302a}
.sh-ar{flex:none;font-size:20px;color:#7a6b43}.sh-ord{font:800 20px "Segoe UI",Arial;color:#b3302a;min-width:38px;text-align:center}
.sh-dot{display:inline-block;width:15px;height:15px;border-radius:50%;border:1.5px solid #222;vertical-align:-3px}
.sh-btn{flex:none;width:58px;height:58px;border-radius:50%;border:2px solid #222;display:flex;align-items:center;justify-content:center;font:800 10px "Segoe UI",Arial;letter-spacing:.04em;box-shadow:0 3px 0 rgba(0,0,0,.35)}.sh-btn.any{background:repeating-linear-gradient(45deg,#e6dfc8 0 5px,#d3cab0 5px 10px);color:#22201a;border-style:dashed}
.sh-act{font:800 13px "Segoe UI",Arial;letter-spacing:.1em;border-radius:18px;padding:7px 12px;display:inline-flex;align-items:center;gap:6px;color:#fff;min-width:84px;justify-content:center}.sh-act.tap{background:#2f7d4f}.sh-act.hold{background:#b3302a}
.sh-act i{width:12px;height:12px;border-radius:50%;background:#fff}.sh-act.hold i{box-shadow:0 0 0 3px rgba(255,255,255,.45)}
.sh-strips{display:flex;justify-content:space-around;margin-top:6px}.sh-strips div{display:flex;flex-direction:column;align-items:center;gap:2px}.sh-strips span{width:18px;height:40px;border-radius:4px;border:1.5px solid #222}.sh-strips b{font:800 24px "Segoe UI",Arial;color:#22201a}
.sh-cols{display:flex;gap:10px;margin-top:8px}.sh-cols>div{flex:1;border:1.5px solid #5a4f33;border-radius:8px;background:#f3ecd6;padding:6px 0;text-align:center;font:30px/1.6 "Segoe UI Symbol","Apple Symbols",serif;color:#22201a}.sh-cols small{display:block;font:800 16px "Segoe UI",Arial;color:#7a6b43;line-height:1.1}
.sh-blots{position:absolute;inset:0;pointer-events:none;z-index:3}
.bz .bz-man p,.bz .bz-man li,.bz .bz-man b,.bz .bz-man i,.bz .bz-man h2,.bz .bz-man h3{color:#2a2418}.bz .bz-man .cols small{color:#5a4f33}
.bz-man .paper{position:relative;min-height:100%}
.bz .bz-man .sec{font:700 11px Georgia,serif;letter-spacing:.3em;color:#7a6b43;margin:16px 0 2px;border-bottom:2px solid #9a8f6c;padding-bottom:3px}
.bz-man .serialbox{display:flex;align-items:center;justify-content:center;gap:10px;margin:6px 0 2px}.bz-man .serialbox .sn{font:700 30px Menlo,Consolas,monospace;letter-spacing:.14em;border:2px solid #3a3120;border-radius:6px;padding:4px 12px;background:#f6efd8}
.bz-man .serialbox .sn u{color:#b3302a;text-decoration:underline;text-underline-offset:5px}
.bz-man .mrow{display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px dashed #b9ae8c}.bz-man .cond{flex:1;display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-height:36px}.bz-man .arrow{font-size:22px;color:#7a6b43}
.bz-man .chip{border:1.5px solid #5a4f33;border-radius:14px;padding:2px 9px;font:700 13px Georgia,serif;display:inline-flex;align-items:center;gap:5px;background:#f6efd8;color:#2a2418}
.bz-man .dot{display:inline-block;width:15px;height:15px;border-radius:50%;border:1.5px solid #222}.bz-man .num{font:700 26px Georgia,serif;color:#b3302a;min-width:20px;text-align:center}
.bz-man .act{font:700 12px Georgia,serif;letter-spacing:.1em;border-radius:16px;padding:5px 10px;display:inline-flex;align-items:center;gap:6px;color:#fff}.bz-man .act.tap{background:#2f7d4f}.bz-man .act.hold{background:#b3302a}
.bz-man .act i{width:12px;height:12px;border-radius:50%;background:#fff;display:inline-block}.bz-man .act.hold i{box-shadow:0 0 0 3px rgba(255,255,255,.45)}
.bz-man .strips{display:flex;gap:10px;justify-content:space-around;margin-top:8px}.bz-man .strips div{display:flex;flex-direction:column;align-items:center;gap:3px}.bz-man .strips span{width:16px;height:46px;border-radius:4px;border:1.5px solid #222}.bz-man .strips b{font:700 24px Georgia,serif;color:#2a2418}
.bz-man .kcols{display:flex;gap:10px;margin-top:8px}.bz-man .kcols>div{flex:1;border:1.5px solid #5a4f33;border-radius:8px;background:#f6efd8;padding:6px 0;text-align:center;font:24px/1.55 "Segoe UI Symbol","Apple Symbols",serif;color:#2a2418}.bz-man .kcols small{display:block;font:700 18px Georgia,serif;color:#7a6b43;line-height:1}
.bz-man .foot{margin-top:16px;text-align:center;font:13px Georgia,serif;color:#5a4f33}
.bz-manwrap{display:none;position:absolute;left:424px;top:14px;width:416px;height:612px;z-index:7;transform-origin:50% 100%;border-radius:10px;background:linear-gradient(160deg,#9a6a3f,#6d4526);box-shadow:0 8px 0 #4a2f19,0 14px 18px rgba(0,0,0,.55),inset 0 2px 0 rgba(255,255,255,.2)}
.bz-manwrap.open{display:block}
.bz-mandim{display:none;position:absolute;left:138px;top:0;width:984px;height:640px;z-index:6;border-radius:20px;background:rgba(6,8,12,.74);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.bz-mandim.open{display:block}
.bz-manput{position:absolute;left:50%;bottom:-11px;transform:translateX(-50%);z-index:5;white-space:nowrap;background:#2a2418;color:#f1e7c6;border-radius:14px;padding:5px 14px;font:700 11px "Segoe UI",Arial;letter-spacing:.12em;box-shadow:0 3px 6px rgba(0,0,0,.5)}
.bz-manhand{position:absolute;right:-92px;bottom:-196px;width:200px;height:270px;pointer-events:none;z-index:4;filter:drop-shadow(0 12px 10px rgba(0,0,0,.5))}
.bz-man .mclose{position:sticky;top:0;float:right;z-index:3;background:#d9cfae;border:1px solid #9a8f6c;color:#2a2418;border-radius:5px;padding:4px 10px;font:12px Georgia,serif;cursor:pointer}
.sh-blots .blot{position:absolute;transform:translate(-50%,-50%);pointer-events:none}
.sh-blots .blot .bg{position:absolute;inset:0;transition:backdrop-filter .8s;border-radius:50%;-webkit-mask-image:radial-gradient(closest-side,#000 62%,rgba(0,0,0,0) 100%);mask-image:radial-gradient(closest-side,#000 62%,rgba(0,0,0,0) 100%)}
.sh-blots .blot.wet .bg{backdrop-filter:blur(2.6px) brightness(.96);-webkit-backdrop-filter:blur(2.6px) brightness(.96)}
.sh-blots .blot.dry .bg{backdrop-filter:blur(1.1px);-webkit-backdrop-filter:blur(1.1px)}
.sh-blots .blot svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.sh-blots .blot .tide{stroke-linejoin:round;vector-effect:non-scaling-stroke}
.sh-blots .blot.wet .tide{stroke:rgba(60,85,120,.4);stroke-width:1}.sh-blots .blot.wet .s0{stop-color:rgba(100,130,170,.16)}.sh-blots .blot.wet .s1{stop-color:rgba(100,130,170,.12)}.sh-blots .blot.wet .s2{stop-color:rgba(75,100,140,.20)}.sh-blots .blot.wet .s3{stop-color:rgba(60,85,120,.38)}
.sh-blots .blot.dry .tide{stroke:rgba(140,100,45,.7);stroke-width:2.2}.sh-blots .blot.dry .s0{stop-color:rgba(170,135,80,.05)}.sh-blots .blot.dry .s1{stop-color:rgba(170,135,80,.10)}.sh-blots .blot.dry .s2{stop-color:rgba(150,110,55,.35)}.sh-blots .blot.dry .s3{stop-color:rgba(130,90,40,.55)}
.sh-blots .blot .shine{fill:rgba(255,255,255,.4)}.sh-blots .blot.dry .shine{display:none}
.sh-blots .blot .runs{position:absolute;inset:0}.sh-blots .blot .run{position:absolute;width:2.5px;border-radius:2px;height:0;background:linear-gradient(rgba(40,55,100,.5),rgba(40,55,100,0))}.sh-blots .blot.dry .run{background:linear-gradient(rgba(110,80,40,.45),rgba(110,80,40,0))}
.sh-blots .rip{position:absolute;width:90px;height:90px;border-radius:50%;border:2px solid rgba(80,110,150,.5);pointer-events:none}
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
.bz-phone .feed{flex:1;overflow:auto}.bz-phone .vid{position:relative;height:250px;overflow:hidden;border-bottom:1px solid #1d232b}
.bz-phone .vid .cap{position:absolute;left:0;right:0;bottom:0;padding:26px 10px 8px;background:linear-gradient(transparent,rgba(0,0,0,.75));color:#fff;font:600 12px/1.35 "Segoe UI",Arial}
.bz-phone .vid .tm{position:absolute;left:0;bottom:0;height:3px;background:#fff;animation:vtm 6s linear infinite}@keyframes vtm{from{width:0}to{width:100%}}
.bz-phone .vid .lk{position:absolute;right:8px;top:8px;font-size:11px;color:#fff;background:rgba(0,0,0,.35);border-radius:10px;padding:2px 8px}
.bz-phone .vid .an{position:absolute;left:50%;top:44%;font-size:92px;line-height:1;transform:translate(-50%,-50%)}
.bz-phone .vid .ht{position:absolute;font-size:18px;opacity:0;animation:vht 2.4s ease-in infinite}@keyframes vht{0%{opacity:0;transform:translateY(0)}20%{opacity:.9}100%{opacity:0;transform:translateY(-120px) scale(1.4)}}
.va-bounce{animation:vab .7s ease-in-out infinite alternate}@keyframes vab{from{transform:translate(-50%,-30%) rotate(-6deg)}to{transform:translate(-50%,-70%) rotate(6deg)}}
.va-wiggle{animation:vaw .35s ease-in-out infinite alternate}@keyframes vaw{from{transform:translate(-50%,-50%) rotate(-14deg) scale(1)}to{transform:translate(-50%,-50%) rotate(14deg) scale(1.1)}}
.va-peek{animation:vap 2.2s ease-in-out infinite}@keyframes vap{0%,100%{transform:translate(-50%,40%)}40%,60%{transform:translate(-50%,-55%)}}
.va-spin{animation:vas 2.6s linear infinite}@keyframes vas{to{transform:translate(-50%,-50%) rotate(360deg)}}
.vb{animation:vbc .6s steps(4) infinite}@keyframes vbc{0%{background:#ff2bd6}25%{background:#18f0ff}50%{background:#b6ff1a}75%{background:#ff6a00}100%{background:#ff2bd6}}
.vb .w{position:absolute;left:0;right:0;top:36%;text-align:center;font:900 34px/1 Impact,"Arial Black",sans-serif;color:#fff;text-shadow:3px 3px 0 #000;opacity:0;animation:vbw 1.8s steps(1) infinite}
@keyframes vbw{0%{opacity:1}33%{opacity:0}100%{opacity:0}}.vb .e{position:absolute;font-size:44px;animation:vbe .5s linear infinite}@keyframes vbe{to{transform:rotate(360deg) scale(1.3)}}
.bz-phone .endcard{padding:30px 16px 40px;text-align:center;color:#9bd3ff;font:600 13px/1.6 "Segoe UI",Arial}.bz-phone .endcard b{display:block;font-size:18px;color:#7be8ff;margin-bottom:6px}
.bz-calmbadge{position:absolute;left:50%;top:56px;transform:translateX(-50%);z-index:5;display:none;align-items:center;gap:12px;background:rgba(10,40,30,.88);border:2px solid #43f2a8;border-radius:40px;padding:8px 18px 8px 10px;color:#c9ffe8;font:700 13px/1.3 "Segoe UI",Arial;letter-spacing:.14em;box-shadow:0 0 26px rgba(67,242,168,.55);pointer-events:none}
.bz-calmbadge svg{width:38px;height:38px;animation:vbr 3s ease-in-out infinite}@keyframes vbr{0%,100%{transform:scale(.85)}50%{transform:scale(1.15)}}.bz-calmbadge small{display:block;font:400 10px/1.3 "Segoe UI",Arial;letter-spacing:.06em;color:#8fe9c4}
.bz-hand{position:fixed;left:0;top:0;width:44px;height:56px;margin:-4px 0 0 -14px;pointer-events:none;z-index:100003;display:none;filter:drop-shadow(0 4px 4px rgba(0,0,0,.45));transform-origin:14px 4px}
.bz-hand svg{width:100%;height:100%;overflow:visible;transition:transform .05s}.bz-hand.dn svg{transform:translateY(3px) scale(.96)}.bz-hand.slip svg{filter:drop-shadow(0 0 7px #7fc4ff)}
.bz-calmfx{position:absolute;inset:0;z-index:3;pointer-events:none;opacity:0;box-shadow:inset 0 0 160px rgba(67,242,168,.5);transition:opacity .6s}
.bz-phone .post{display:flex;gap:10px;padding:12px;border-bottom:1px solid #1d232b;color:#dfe8f0}
.bz-phone .post>i{flex:none;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 14px Arial;color:#fff;font-style:normal}
.bz-phone .post p{font-size:13px;line-height:1.45;margin:2px 0 5px;color:#e6edf3}.bz-phone .post small{color:#7f93a5}.bz-phone .post b{font-size:12px;color:#9bd3ff}
.bz-sweat{position:absolute;inset:0;pointer-events:none;z-index:3}
.bz-sweat .drop{position:absolute;left:0;top:0;border-radius:50% 50% 50% 50%/70% 70% 30% 30%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.95),rgba(170,215,255,.7) 55%,rgba(90,150,220,.55));box-shadow:0 0 6px rgba(150,200,255,.6)}
.bz-sweat .smudge{position:absolute;border-radius:50% 50% 50% 50%/58% 58% 42% 42%;backdrop-filter:blur(3px) saturate(1.3);-webkit-backdrop-filter:blur(3px) saturate(1.3);background:radial-gradient(circle at 34% 28%,rgba(255,255,255,.7),rgba(190,225,255,.2) 38%,rgba(120,175,230,.14) 72%);box-shadow:inset 0 -4px 6px rgba(0,0,0,.3),inset 2px 3px 4px rgba(255,255,255,.55),0 3px 5px rgba(0,0,0,.35)}
.bz-sweat .sp{position:absolute;width:6px;height:6px;border-radius:50%;background:rgba(190,225,255,.85)}
.bz-sweat .streak{position:absolute;width:5px;border-radius:3px;background:linear-gradient(rgba(190,225,255,.7),rgba(190,225,255,0))}
.bz-vig{position:absolute;inset:0;pointer-events:none;z-index:3;opacity:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 42%,rgba(150,0,0,.9) 100%)}
.bay.shorted{animation:bzflick .14s steps(2) infinite}@keyframes bzflick{0%{box-shadow:inset 0 0 0 2px #7fd6ff,0 0 14px 2px rgba(90,200,255,.9),0 3px 8px rgba(0,0,0,.5)}50%{box-shadow:inset 0 0 0 2px #fff6a8,0 0 22px 5px rgba(255,235,120,.9),0 3px 8px rgba(0,0,0,.5)}}
.bay.shorted>*:not(.zap):not(.spark){animation:bzdim .16s steps(2) infinite}@keyframes bzdim{0%{filter:brightness(1)}50%{filter:brightness(.55) saturate(.6)}}
.bay .zap{position:absolute;left:50%;top:-2px;transform:translateX(-50%);z-index:5;display:none;pointer-events:none;width:30px;height:40px;filter:drop-shadow(0 0 6px #ffe14d);animation:bzbolt .3s ease-in-out infinite alternate}
.bay .zap svg{width:100%;height:100%}.bay.shorted .zap{display:block}@keyframes bzbolt{from{transform:translateX(-50%) scale(.9)}to{transform:translateX(-50%) scale(1.25)}}
.bz-arcs{position:absolute;left:0;top:0;width:1264px;height:640px;pointer-events:none;z-index:4;overflow:visible}
.bz-arcs polyline{fill:none;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 3px #6fd0ff) drop-shadow(0 0 8px #3aa8ff)}
.smudge.hot{animation:bzhot .2s steps(2) infinite}@keyframes bzhot{0%{box-shadow:inset 0 -4px 6px rgba(0,0,0,.3),0 0 16px 6px rgba(110,210,255,.95)}50%{box-shadow:inset 0 -4px 6px rgba(0,0,0,.3),0 0 26px 10px rgba(255,245,170,.95)}}
.bay .spark{position:absolute;width:3px;height:3px;border-radius:50%;background:#fff6c2;box-shadow:0 0 8px 3px #ffb52e;z-index:5;pointer-events:none}
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
  const b = el("div", "bay " + cls, '<i class="bolt a"></i><i class="bolt b"></i><i class="bolt c"></i><i class="bolt d"></i><div class="zap"><svg viewBox="0 0 24 32"><path d="M14 0 L3 18 H11 L8 32 L21 12 H13 Z" fill="#ffe14d" stroke="#fff" stroke-width="1.2"/></svg></div>', parent);
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
  const clothEl = el("div", "bz-item cloth", "CLOTH<br>HOLD + DRAG<br>TO WIPE", bomb);
  const phoneEl = el("div", "bz-item phone", "<i>NEW<br>NOTIFICATIONS<br>(tap to scroll)</i>", bomb);
  const sweat = el("div", "bz-sweat", null, bomb);
  const arcSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); arcSvg.setAttribute("class", "bz-arcs"); arcSvg.setAttribute("viewBox", "0 0 1264 640"); bomb.appendChild(arcSvg);
  const vig = el("div", "bz-vig", null, root);
  const flash = el("div", "bz-flash", null, root);
  const hand = el("div", "bz-hand", `<svg viewBox="0 0 44 56" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="fsk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d2b2"/><stop offset="1" stop-color="#d79e76"/></linearGradient></defs>
<g stroke="#a86f4c" stroke-width="1.4" stroke-linejoin="round"><path d="M6 34 C4 28 10 27 13 30 L40 30 C44 31 44 36 43 41 L41 54 L12 54 C7 50 7 40 6 34Z" fill="url(#fsk)"/>
<rect x="13" y="3" width="11" height="34" rx="5.5" fill="url(#fsk)"/><path d="M24 31 C30 29 34 31 36 34 M24 38 C30 36 35 38 37 41 M22 45 C28 43 34 45 36 48" fill="none" opacity=".55"/>
<path d="M13 36 C6 34 2 38 3 43 C4 47 9 48 13 46Z" fill="url(#fsk)"/></g><ellipse cx="18.5" cy="8" rx="3.2" ry="4.2" fill="#f9e6d8" stroke="#c68e6b" stroke-width=".9"/><circle cx="18.5" cy="4" r="1.6" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1"/></svg>`, root);
  const clothHeld = el("div", "bz-clothheld", null, root);
  const calmFx = el("div", "bz-calmfx", null, root);
  const calmBadge = el("div", "bz-calmbadge", `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="none" stroke="#43f2a8" stroke-width="2" opacity=".5"/><path d="M20 30 C12 28 8 21 10 14 C16 15 20 19 20 24 C20 19 24 15 30 14 C32 21 28 28 20 30Z" fill="#43f2a8"/></svg><div>CALM MODE<small id="cmT">shaking and sweat paused</small></div>`, root);

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
  const cap = el("div", "cap", "", bBtn), strip = el("div", "strip", null, bBtn), btip = el("div", "btip", "", bBtn);
  let tipTimer = 0;
  function tip(text, bad, ms) { clearTimeout(tipTimer); btip.textContent = text || ""; btip.className = "btip" + (text ? " show" : "") + (bad ? " bad" : ""); if (text && ms) tipTimer = setTimeout(() => tip(""), ms); }

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
  const rowS = el("div", "row s", '<label><span>AROUSAL (BODY)</span><b>--</b></label><div class="bar"><i></i></div>', bVit); rowS.style.top = "44px";
  const rowM = el("div", "row f", '<label><span>MIND CLEAR (PHONE)</span><b>0%</b></label><div class="bar"><i style="background:linear-gradient(90deg,#3fd6a0,#7be8ff)"></i></div>', bVit); rowM.style.top = "90px";
  const vNote = el("div", "note", "", bVit);
  const effect = el("div", "row", '<label><span>HAND TREMOR</span><b id="bzT">0 px</b></label><label style="margin-top:5px"><span>CLOCK SPEED</span><b id="bzC">x1.00</b></label><label style="margin-top:5px"><span>HEART RATE</span><b id="bzH">64 bpm</b></label><label style="margin-top:4px"><span>SWEAT ON BOMB</span><b id="bzW">0</b></label><label style="margin-top:4px"><span>CALM MODE</span><b id="bzK">ready</b></label>', bVit); effect.style.top = "138px";

  /* manual */
  /* the sheet lies on the table as a booklet. Picking it up holds it in front of the bomb, so you cannot read and work at once */
  const bookEl = el("div", "bz-item book", "<i></i>SERVICE SHEET<small>CLICK TO READ (M)</small>", bomb);
  const manDim = el("div", "bz-mandim", null, bomb);
  const manWrap = el("div", "bz-manwrap", null, bomb);
  const manPut = el("div", "bz-manput", "PUT DOWN (M)", manWrap);
  el("div", "bz-clip", null, manWrap);
  const man = el("div", "bz-man", "", manWrap);
  const manHand = el("div", "bz-manhand", `<svg viewBox="0 0 230 310" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="hsk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3cfae"/><stop offset="1" stop-color="#d49a72"/></linearGradient><linearGradient id="hsl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b4b6d"/><stop offset="1" stop-color="#202a40"/></linearGradient></defs>
<ellipse cx="98" cy="150" rx="24" ry="48" fill="rgba(0,0,0,.2)" transform="rotate(-18 98 150)"/>
<path d="M112 196 L170 204 L218 310 L124 310 Z" fill="url(#hsk)" stroke="#b27a58" stroke-width="1.5"/>
<path d="M120 258 L208 262 L220 310 L126 310 Z" fill="url(#hsl)"/><path d="M118 252 L210 256 L212 266 L120 262 Z" fill="#5a6f9a"/>
<g fill="url(#hsk)" stroke="#b27a58" stroke-width="1.6"><rect x="138" y="96" width="80" height="21" rx="10.5" transform="rotate(6 178 106)"/><rect x="138" y="119" width="84" height="22" rx="11" transform="rotate(4 180 130)"/><rect x="138" y="143" width="82" height="22" rx="11" transform="rotate(2 180 154)"/><rect x="140" y="167" width="74" height="21" rx="10.5" transform="rotate(0 177 177)"/></g>
<path d="M98 122 C116 104 152 106 164 134 L172 204 C150 226 108 222 96 198 Z" fill="url(#hsk)" stroke="#b27a58" stroke-width="1.5"/>
<path d="M104 202 C86 178 56 148 60 118 C62 100 88 98 94 114 C104 138 130 168 138 192 Z" fill="url(#hsk)" stroke="#b27a58" stroke-width="1.6"/>
<ellipse cx="75" cy="111" rx="8" ry="11" fill="#f8e2d2" stroke="#c68e6b" stroke-width="1.2" transform="rotate(-20 75 111)"/>
<path d="M112 168 C122 176 132 186 138 196" fill="none" stroke="#b27a58" stroke-width="1.4" opacity=".6"/></svg>`, manWrap);
  let manKick = 0, blotId = 0;
  man.innerHTML = `<div class="sh-tabs"><div class="sh-tab" data-t="wires">WIRES</div><div class="sh-tab" data-t="button">BUTTON</div><div class="sh-tab" data-t="keypad">KEYPAD</div></div><div class="sh-page"></div><div class="sh-blots"></div>`;
  man.style.display = "block";
  const paper = man.querySelector(".sh-page"), blotLayer = man.querySelector(".sh-blots"), tabEls = [...man.querySelectorAll(".sh-tab")]; let blots = [], pdrops = [], pAcc = 0, tab = "wires";

  /* test tools */
  const tools = el("div", "bz-tools", `<b style="letter-spacing:.2em;color:#e6c46a">MANUAL TEST MODE</b><label>Arousal <input type="range" id="bzSl" min="0" max="100" value="0"><b id="bzSv">0</b></label><small>0 = at rest, 100 = fully worked up</small><label><input type="checkbox" id="bzNo"> simulate "no reading"</label>`, root);
  const sl = tools.querySelector("#bzSl"), sv = tools.querySelector("#bzSv"), no = tools.querySelector("#bzNo");
  sl.addEventListener("input", () => { sv.textContent = sl.value; });

  const phoneUi = el("div", "bz-phone", `<div class="ph"><span>SCROLL TO CLEAR YOUR HEAD</span><b id="phClock">--:--</b></div><div class="mc"><i></i></div><div class="feed"></div><div class="ph"><span id="phMc">MIND CLEAR 0%</span><button class="bz-btn" id="phDown">PUT DOWN</button></div>`, root);
  const feed = phoneUi.querySelector(".feed"), phClock = phoneUi.querySelector("#phClock"), phMc = phoneUi.querySelector("#phMc"), phBar = phoneUi.querySelector(".mc i");
  let lastScroll = 0;
  feed.addEventListener("scroll", () => {
    const dy = Math.abs(feed.scrollTop - lastScroll); lastScroll = feed.scrollTop;
    if (S && S.phone && S.state === "running" && !S.feedDone) S.calm = Math.min(T.calmMax, S.calm + dy / T.calmPerPx);
    if (S && S.phone) { S.atEnd = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 12; if (S.atEnd) tryCalmMode(); }
  });
  phoneUi.querySelector("#phDown").onclick = () => togglePhone(false);
  const endEl = el("div", "bz-end", "", root);
  const introEl = el("div", "bz-end", `<div class="card" style="max-width:600px;text-align:left"><h1 style="text-align:center;color:#ffd166;font-size:26px">BRIEFING</h1>
    <p style="text-align:left"><b style="color:#fff">1. Pick up the service sheet</b> (click the booklet on the right, or press M). It is written for this bomb only. While you read it you cannot see or touch the bomb, and the clock keeps running, so remember what you need and put it down (M, or click anywhere else).</p>
    <p style="text-align:left"><b style="color:#fff">2. Stay calm.</b> The more worked up your body gets, the more your finger shakes and the more you sweat. Three drops on one module short it out: hold the <b style="color:#9cc9f5">cloth</b> and drag it over the drops. Drops also soak the sheet.</p>
    <p style="text-align:left"><b style="color:#fff">3. One lifeline.</b> Scroll the <b style="color:#b79cff">phone</b> to the end for a short calm mode. The clock keeps running while you scroll.</p>
    <p style="color:#ff9a8f">Three strikes or 00:00 and it goes off.</p>
    <div class="row"><button class="bz-btn" id="bzGo" style="background:#2a5bd6;font-weight:700;padding:10px 26px">START (Enter)</button></div></div>`, root);
  introEl.querySelector("#bzGo").onclick = () => begin();
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
  function setTab(t) { tab = t; beep(700, .03, "triangle", .03); renderManual(); }
  function renderManual() {
    const lv = level, HEX = { red: "#e0281c", blue: "#2f78ff", yellow: "#f4cf1a", white: "#eef1f4", black: "#23272b", green: "#2fb37a" };
    const dot = c => `<span class="sh-dot" style="background:${HEX[c]}"></span>`;
    tabEls.forEach(e => { e.classList.toggle("on", e.dataset.t === tab); e.classList.toggle("ok", !!(S && S.solved[e.dataset.t])); });
    /* a tiny five-wire panel: coloured wires are the ones that matter, dashes are "any"; the red tag marks the wire to cut */
    const panel = (colors, cut) => {
      let h = `<svg width="84" height="66" viewBox="0 0 84 66">`;
      for (let i = 0; i < 5; i++) {
        const y = 9 + i * 12, c = colors[i];
        h += c ? `<line x1="6" y1="${y}" x2="58" y2="${y}" stroke="#222" stroke-width="8" stroke-linecap="round"/><line x1="6" y1="${y}" x2="58" y2="${y}" stroke="${HEX[c]}" stroke-width="5" stroke-linecap="round"/>`
               : `<line x1="6" y1="${y}" x2="58" y2="${y}" stroke="${cut === i ? "#8a7f5e" : "#c9c0a3"}" stroke-width="3" stroke-linecap="round" stroke-dasharray="3 5"/>`;
      }
      if (cut >= 0) h += `<circle cx="70" cy="${9 + cut * 12}" r="10" fill="#b3302a"/><text x="70" y="${9 + cut * 12 + 5}" font-size="13" text-anchor="middle" fill="#fff">✂</text>`;
      return h + `</svg>`;
    };
    const none5 = [null, null, null, null, null];
    const sn = `<div class="sh-sn"><span>SERIAL</span><b>${lv.serial.slice(0, -1)}<u>${lv.serial.slice(-1)}</u></b></div>`;
    let body;
    if (tab === "wires") {
      const row = (r, i) => {
        let cond, act;
        switch (r.type) {
          case "lastParity": cond = panel([null, null, null, null, r.color], -1) + `<span class="sh-t">bottom wire is ${dot(r.color)}<br>and serial ends <b>${r.parity.toUpperCase()}</b><br><small>${r.parity === "odd" ? "1 3 5 7 9" : "0 2 4 6 8"}</small></span>`; break;
          case "oneAndMore": cond = `<span class="sh-t">exactly <b>1</b> ${dot(r.a)}<br>and <b>2 or more</b> ${dot(r.b)}</span>`; break;
          case "none": cond = `<span class="sh-t"><b>no</b> ${dot(r.color)} wire at all</span>`; break;
          case "atLeast": cond = `<span class="sh-t"><b>${r.n} or more</b> ${dot(r.color)}</span>`; break;
          case "firstIs": cond = panel([r.color, null, null, null, null], -1) + `<span class="sh-t">top wire is ${dot(r.color)}</span>`; break;
          default: cond = `<span class="sh-t">anything else</span>`;
        }
        act = r.type === "atLeast" ? `<span class="sh-t" style="text-align:center">✂ the <b>lowest</b><br>${dot(r.color)} wire</span>` : panel(none5, r.cut) + `<span class="sh-ord">${L.ORD[r.cut]}</span>`;
        return `<div class="sh-row"><span class="sh-n">${i + 1}</span><div class="sh-if">${cond}</div><span class="sh-ar">➜</span><div class="sh-do">${act}</div></div>`;
      };
      body = `<div class="sh-h">Cut ONE wire. Read down and use the <u>first</u> line that fits. Wires count from the top.</div>${lv.wires.rules.map(row).join("")}`;
    } else if (tab === "button") {
      const btn = r => r.type === "otherwise" ? `<span class="sh-t">anything else</span>` :
        `<span class="sh-btn ${r.color ? "" : "any"}" style="${r.color ? `background:${HEX[r.color]};color:${r.color === "white" || r.color === "yellow" ? "#222" : "#fff"}` : ""}">${r.label || "any"}</span><span class="sh-t">${r.color ? `<b>${r.color}</b> button` : "any colour"}${r.label ? `<br>that says <b>${r.label}</b>` : "<br>any word"}</span>`;
      const row = (r, i) => `<div class="sh-row" style="min-height:66px"><span class="sh-n">${i + 1}</span><div class="sh-if">${btn(r)}</div><span class="sh-ar">➜</span><div class="sh-do"><span class="sh-act ${r.action}"><i></i>${r.action.toUpperCase()}</span></div></div>`;
      body = `<div class="sh-h">Tap or hold? Use the <u>first</u> line that fits. A tap is a quick press.</div>${lv.button.rules.map(row).join("")}
        <div class="sh-h" style="margin-top:8px">If you HOLD: a strip lights up. Let go when the clock shows that strip's digit anywhere <small style="color:#7a6b43">(02:41 has a 4)</small>.</div>
        <div class="sh-strips">${L.STRIP_COLORS.map(c => `<div class="${S && S.stripLit && c === lv.button.strip ? "lit" : ""}"><span style="background:${HEX[c]}"></span><b>${lv.button.stripDigits[c]}</b></div>`).join("")}</div>`;
    } else {
      body = `<div class="sh-h">One column has all 4 of your symbols. Press them in that column's order, top to bottom.</div>
        <div class="sh-cols">${lv.keypad.columns.map(c => `<div><small>↓</small>${c.map(x => `<div>${x}</div>`).join("")}</div>`).join("")}</div>`;
    }
    paper.innerHTML = sn + body;
  }

  /* ---------- level setup ---------- */
  function build(seed, withIntro) {
    level = L.makeLevel(seed); level.timeLimit = T.timeLimit; level.maxStrikes = T.maxStrikes;
    S = { remaining: level.timeLimit, strikes: 0, state: withIntro ? "intro" : "running", solved: { wires: false, button: false, keypad: false }, cut: [false, false, false, false, false],
      pressAt: null, pressItem: null, progress: 0, stressSm: 0, stressSum: 0, stressHi: 0, calm: 0, calmPeak: 0, phoneSec: 0, feedDone: false, atEnd: false, calmUntil: null, calmAt: null, phone: false, cloth: false, t: 0, nextGlitch: 6, glitchUntil: 0, lastSec: -1, events: [], slips: 0, drops: 0, wipes: 0, blocked: 0, blots: 0, nextSpike: 4, spikeUntil: 0, beat: 0, lastBeat: 0 };
    manWrap.classList.remove("open"); manDim.classList.remove("open"); bookEl.classList.remove("lifted");
    pdrops.forEach(d => d.e.remove()); pdrops = []; blots.forEach(b => b.e.remove()); blots = []; pAcc = 0;
    drops.forEach(d => d.e.remove()); drops = []; smudges.forEach(m => m.e.remove()); smudges = []; sweat.innerHTML = ""; spawnAcc = 0;
    items.length = 0; togglePhone(false); clothUp(); tab = "wires"; bWire.querySelectorAll('.hit').forEach(x => x.remove());
    plate.lastChild.textContent = level.serial;
    ledB.className = ledW.className = ledK.className = "led";
    feed.innerHTML = ""; calmBadge.style.display = "none"; calmFx.style.opacity = 0; phoneEl.innerHTML = "<i>NEW<br>NOTIFICATIONS<br>(tap to scroll)</i>";
    tabEls.forEach(e => reg(e, () => setTab(e.dataset.t))); reg(bookEl, () => toggleManual(true)); reg(manPut, () => toggleManual(false)); reg(man, () => {}); reg(phoneEl, () => togglePhone(true)); reg(clothEl, clothDown, clothUp);
    /* wires */
    wsvg.innerHTML = "";
    level.wires.colors.forEach((c, i) => drawWire(i, false));
    for (let i = 0; i < 5; i++) {
      const h = el("div", "hit", "", bWire); h.style.top = (34 + 22 + i * 44 - 15) + "px";
      reg(h, () => cutWire(i));
    }
    /* button */
    cap.className = "cap c-" + level.button.color; cap.textContent = level.button.label;
    strip.className = "strip"; strip.style.color = ""; tip("");
    reg(cap, pressButton, releaseButton);
    /* keypad */
    kGrid.innerHTML = ""; [...kLeds.children].forEach(i => i.className = "");
    level.keypad.shown.forEach(sym => { const k = el("div", "key", sym, kGrid); reg(k, () => pressKey(k, sym), () => k.classList.remove("dn")); });
    strikeBox.querySelectorAll("i").forEach(i => i.className = "");
    updMods(); endEl.style.display = "none"; root.classList.remove("bz-glitch");
    renderManual();
    introEl.style.display = withIntro ? "flex" : "none";
    if (!withIntro) emit("start", { seed: level.seed, serial: level.serial, mode });
  }
  function begin() { if (S.state !== "intro") return; S.state = "running"; introEl.style.display = "none"; if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (x) { /* no sound */ } } emit("start", { seed: level.seed, serial: level.serial, mode }); }
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
    emit("module_solved", { module: name }); updMods(); renderManual();
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
    S.pressAt = performance.now(); cap.classList.add("dn"); beep(300, .05, "square", .05); tip("");
  }
  function releaseButton() {
    if (S.pressAt == null) return;
    const held = (performance.now() - S.pressAt) / 1000; S.pressAt = null; cap.classList.remove("dn"); strip.className = "strip"; strip.style.color = "";
    if (S.state !== "running") return;
    const wasLit = S.stripLit; S.stripLit = false; if (wasLit) renderManual();
    const r = L.judgeButton(level, held, clockDigits());
    if (r === "solved") { tip(""); solveModule("button", ledB); }
    else {
      /* say what went wrong so a strike teaches something */
      const tapped = held < L.TAP_MAX;
      tip(level.button.action === "tap" ? "Held too long. Check the sheet: tap or hold?" : tapped ? "Too quick. Check the sheet: tap or hold?" : "Let go at the wrong moment. The clock must show the strip's number.", true, 4500);
      strike("button");
    }
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
    d.e.remove(); beep(1300 + Math.random() * 500, .04, "sine", .02); manKick = Math.min(10, manKick + 4);
    const pr = blotLayer.getBoundingClientRect(), R = 22 + Math.random() * 26, W = R * 2, H = R * 1.8, id = ++blotId, n = 14, pts = [];
    const ph1 = Math.random() * 6.28, ph2 = Math.random() * 6.28, ph3 = Math.random() * 6.28;
    for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2, r = 0.8 + 0.1 * Math.sin(2 * a + ph1) + 0.07 * Math.sin(3 * a + ph2) + 0.04 * Math.sin(5 * a + ph3); pts.push([50 + Math.cos(a) * r * 50, 50 + Math.sin(a) * r * 50]); }
    const poly = "polygon(" + pts.map(p => p[0].toFixed(1) + "% " + p[1].toFixed(1) + "%").join(",") + ")", path = "M" + pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L") + " Z";
    const x = (d.x - pr.left) / k, y = (d.ty - pr.top) / k, e = el("div", "blot wet", null, blotLayer);
    e.style.cssText = `left:${x}px;top:${y}px;width:${W}px;height:${H}px`;
    e.innerHTML = `<div class="bg"></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><defs><radialGradient id="rg${id}"><stop class="s0" offset="0"/><stop class="s1" offset=".7"/><stop class="s2" offset=".94"/><stop class="s3" offset="1"/></radialGradient></defs><path d="${path}" fill="url(#rg${id})" class="tide"/><ellipse class="shine" cx="38" cy="32" rx="14" ry="8" transform="rotate(-25 38 32)"/></svg><div class="runs"></div>`;
    const runs = e.querySelector(".runs");
    for (let i = 0, nr = 3 + Math.floor(Math.random() * 3); i < nr; i++) {   /* ink runs down the page */
      const r = el("i", "run", null, runs); r.style.left = 22 + Math.random() * 56 + "%"; r.style.top = 58 + Math.random() * 20 + "%";
      r.animate([{ height: "0px", opacity: 0 }, { height: 30 + Math.random() * 60 + "px", opacity: 1 }], { duration: 4000 + Math.random() * 5000, easing: "ease-out", fill: "forwards" });
    }
    const rp = el("i", "rip", null, blotLayer); rp.style.left = x + "px"; rp.style.top = y + "px";
    rp.animate([{ transform: "translate(-50%,-50%) scale(.2)", opacity: .6 }, { transform: "translate(-50%,-50%) scale(1.6)", opacity: 0 }], { duration: 700 }).onfinish = () => rp.remove();
    blots.push({ e, wet: true, born: S.t }); S.blots++; if (blots.length > 10) blots.shift().e.remove();
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
  let arcT = 0;
  function sparks() {
    ["wires", "button", "keypad", "timer"].forEach(key => {
      if (!shorted(key)) return;
      const bz = bayOf[key], br = bz.getBoundingClientRect();
      smudges.forEach(m => {
        if (m.mod !== key || Math.random() > 0.35) return;
        const mr = m.e.getBoundingClientRect(), sp = el("i", "spark", null, bz);
        sp.style.left = (mr.left + mr.width / 2 - br.left) / k + "px"; sp.style.top = (mr.top + mr.height / 2 - br.top) / k + "px";
        sp.animate([{ transform: "scale(2)", opacity: 1 }, { transform: `translate(${(Math.random() - .5) * 46}px,${(Math.random() - .5) * 46}px) scale(.2)`, opacity: 0 }], { duration: 300 }).onfinish = () => sp.remove();
        if (Math.random() < 0.25) beep(1800 + Math.random() * 1400, .03, "sawtooth", .02);
      });
    });
  }
  /* lightning arcs jump between the wet patches of a shorted module and to the module's edge: the water is the cause, wipe it off */
  function drawArcs() {
    if (S.t - arcT < 0.05) return; arcT = S.t;
    while (arcSvg.firstChild) arcSvg.removeChild(arcSvg.firstChild);
    const ns = "http://www.w3.org/2000/svg", b0 = bomb.getBoundingClientRect();
    smudges.forEach(m => m.e.classList.remove("hot"));
    ["wires", "button", "keypad", "timer"].forEach(key => {
      if (!shorted(key)) return;
      const pts = smudges.filter(m => m.mod === key); pts.forEach(m => m.e.classList.add("hot"));
      const br = bayOf[key].getBoundingClientRect(), E = { l: (br.left - b0.left) / k, r: (br.right - b0.left) / k, t: (br.top - b0.top) / k, b: (br.bottom - b0.top) / k };
      const bolt = (x1, y1, x2, y2) => {
        const n = 9, d = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / (d || 1), ny = (x2 - x1) / (d || 1), arr = [];
        for (let i = 0; i <= n; i++) { const f = i / n, j = (i === 0 || i === n) ? 0 : (Math.random() - .5) * Math.min(26, d * .35); arr.push(`${(x1 + (x2 - x1) * f + nx * j).toFixed(1)},${(y1 + (y2 - y1) * f + ny * j).toFixed(1)}`); }
        [["#7fd6ff", 5, .55], ["#ffffff", 2, 1]].forEach(([c, w, o]) => { const pl = document.createElementNS(ns, "polyline"); pl.setAttribute("points", arr.join(" ")); pl.setAttribute("stroke", c); pl.setAttribute("stroke-width", w); pl.setAttribute("opacity", o); arcSvg.appendChild(pl); });
      };
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length]; if (pts.length > 1 && Math.random() < 0.8) bolt(a.x, a.y, c.x, c.y);
        if (Math.random() < 0.6) { const side = Math.floor(Math.random() * 4), ex = side === 0 ? E.l : side === 1 ? E.r : a.x, ey = side === 2 ? E.t : side === 3 ? E.b : a.y; bolt(a.x, a.y, Math.max(E.l, Math.min(E.r, ex)), Math.max(E.t, Math.min(E.b, ey))); }
      }
    });
    if (!arcSvg.firstChild) smudges.forEach(m => m.e.classList.remove("hot"));
  }
  /* ---------- table objects: manual, cloth, phone ---------- */
  function toggleManual(open) {
    if (!S) return;
    if (open == null) open = !S.manual;
    if (open && (S.state !== "running" || S.pressAt != null || S.phone)) return;   /* hands are busy */
    S.manual = !!open; manWrap.classList.toggle("open", S.manual); manDim.classList.toggle("open", S.manual); bookEl.classList.toggle("lifted", S.manual);
    if (!S.manual) { pdrops.forEach(d => d.e.remove()); pdrops = []; }
    beep(S.manual ? 620 : 420, .04, "triangle", .04); emit(S.manual ? "manual_open" : "manual_close", {});
  }
  function clothDown() {
    if (!S || S.state !== "running") return;
    S.cloth = true; clothEl.classList.add("lifted"); clothHeld.style.display = "block"; beep(250, .06, "triangle", .04);
  }
  function clothUp() { if (S) S.cloth = false; clothEl.classList.remove("lifted"); clothHeld.style.display = "none"; }
  function wipeWithCloth() {
    if (!handPos) return;
    let n = 0;
    for (let i = blots.length - 1; i >= 0; i--) {
      const r = blots[i].e.getBoundingClientRect();
      if (blots[i].wet && Math.hypot(handPos[0] - (r.left + r.width / 2), handPos[1] - (r.top + r.height / 2)) < Math.max(r.width, r.height) / 2 + 30 * k) { blots[i].e.remove(); blots.splice(i, 1); n++; }
    }
    for (let i = smudges.length - 1; i >= 0; i--) {
      const r = smudges[i].e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (Math.hypot(handPos[0] - cx, handPos[1] - cy) < Math.max(r.width, r.height) / 2 + 36 * k) { smudges[i].e.remove(); smudges.splice(i, 1); n++; }
    }
    if (n) { S.wipes += n; beep(190 + Math.random() * 90, .05, "triangle", .03); emit("wipe", { patches: n }); }
  }
  const FEED_NAMES = ["sam", "juno", "pixel_pal", "mr.toast", "k8", "bean", "moss", "lemon", "dax", "orbit", "nova", "pip"];
  const FEED_TEXT = ["just spilled coffee on my keyboard again", "hot take: cereal is a soup", "my cat has strong opinions about my meetings", "15 reasons to drink more water (number 7 will shock you)", "does anyone else's wifi only work while standing on one leg", "rate my sandwich 9/10", "local pigeon elected mayor of the park", "the moon looks nice tonight", "found $5 in old jeans, we are so back", "why do printers hate me personally", "i have named all my houseplants and they are judging me", "unpopular opinion: socks should come in threes", "this dog wearing sunglasses is the best thing today", "tiny turtle slowly crosses road, internet cheers", "me: i will sleep early. also me at 2am: one more video"];
  const FEED_COL = ["#e0562f", "#2f8de0", "#7a4de0", "#2fb37a", "#d6a21f", "#d9418c"];
  const pick1 = arr => arr[Math.floor(Math.random() * arr.length)];
  const ANIMALS = [["🐱", "cat meets a cardboard box for the first time", "va-peek"], ["🐶", "puppy hears the word 'walk'", "va-wiggle"], ["🦆", "duck parade, 12 ducklings, zero rules", "va-bounce"], ["🐹", "hamster stuffs one (1) whole carrot", "va-wiggle"], ["🐰", "bunny binky of pure joy", "va-bounce"], ["🦦", "otter holds hands with another otter", "va-spin"], ["🐼", "panda falls off a log, tries again", "va-bounce"], ["🐭", "tiny mouse eats a tiny pizza", "va-peek"]];
  const PASTEL = ["#ffd6e0", "#d6f0ff", "#e3ffd6", "#fff3c9", "#e8dcff"];
  const BRAIN = [["SKIBIDI", "RIZZ", "NO CAP"], ["SIGMA", "GYATT", "LOCK IN"], ["AURA +9000", "MOGGED", "BRO WHAT"], ["BRAINROT", "6 7", "CHAT IS THIS REAL"]];
  const BRAIN_CAP = ["POV: you have 40 seconds left and you are watching this", "me explaining the plot to nobody", "this video has no plot and 4 million views", "sound on (there is no sound)"];
  function animalCard() {
    const [em, cap, anim] = pick1(ANIMALS), hearts = [1, 2, 3, 4].map(i => `<span class="ht" style="left:${15 + i * 18}%;bottom:${30 + (i % 2) * 12}%;animation-delay:${i * .5}s">♥</span>`).join("");
    return `<div class="vid" style="background:linear-gradient(160deg,${pick1(PASTEL)},${pick1(PASTEL)})"><span class="lk">♥ ${(Math.random() * 90 + 10).toFixed(0)}k</span><div class="an ${anim}">${em}</div>${hearts}<div class="cap">${cap}</div><div class="tm" style="background:#ff5d8f"></div></div>`;
  }
  function brainCard() {
    const w = pick1(BRAIN), emo = ["💀", "🗿", "🔥", "🤪"], words = w.map((t, i) => `<div class="w" style="animation-delay:${i * .6}s">${t}</div>`).join("");
    const emj = [0, 1, 2].map(i => `<div class="e" style="left:${10 + i * 34}%;top:${12 + (i % 2) * 52}%;animation-duration:${.4 + i * .15}s">${pick1(emo)}</div>`).join("");
    return `<div class="vid vb"><span class="lk">${(Math.random() * 900 + 100).toFixed(0)}k views</span>${emj}${words}<div class="cap">${pick1(BRAIN_CAP)}</div><div class="tm"></div></div>`;
  }
  function textPost() {
    const nm = pick1(FEED_NAMES), c = pick1(FEED_COL);
    return `<div class="post"><i style="background:${c}">${nm[0].toUpperCase()}</i><div><b>@${nm}</b><p>${pick1(FEED_TEXT)}</p><small>♥ ${(Math.random() * 9 + 0.2).toFixed(1)}k &nbsp; ↻ ${Math.floor(Math.random() * 900)}</small></div></div>`;
  }
  /* a FINITE feed: cute animals, brainrot and a few posts. Reaching the end (after watching a while) triggers calm mode, once per bomb. */
  function buildFeed() {
    const kinds = ["t", "a", "b", "a", "t", "b", "a", "t", "a", "b", "a", "t"], html = kinds.map(k => k === "a" ? animalCard() : k === "b" ? brainCard() : textPost()).join("");
    feed.innerHTML = html + `<div class="endcard" id="phEnd"><b>You're all caught up</b><span id="phEndMsg">Scroll to the bottom to clear your head.</span></div>`;
    lastScroll = 0;
  }
  function tryCalmMode() {
    if (!S || S.feedDone || !S.phone || S.state !== "running") return;
    const msgEl = feed.querySelector("#phEndMsg");
    if (S.phoneSec < T.phoneMinSec) { if (msgEl) msgEl.textContent = "Keep watching a little longer..."; return; }
    S.feedDone = true; S.calmUntil = S.t + T.calmModeSec; S.calmAt = +S.t.toFixed(1);
    if (msgEl) msgEl.textContent = "Mind cleared. Back to the bomb!";
    beep(523, .18, "sine", .06); setTimeout(() => beep(659, .18, "sine", .06), 160); setTimeout(() => beep(784, .35, "sine", .06), 320);
    emit("calm_mode", { seconds: T.calmModeSec });
    phoneEl.querySelector("i").innerHTML = "ALL<br>CAUGHT UP<br>(battery low)"; phoneEl.querySelector("i").style.animation = "none"; phoneEl.querySelector("i").style.filter = "grayscale(1) brightness(.6)";
    setTimeout(() => { if (S && S.phone) togglePhone(false); }, 1800);
  }
  function togglePhone(open) {
    if (!S) return; const was = S.phone; S.phone = !!open && S.state === "running"; phoneUi.style.display = S.phone ? "flex" : "none"; phoneEl.style.opacity = S.phone ? ".4" : "";
    if (S.phone) { if (!feed.children.length) buildFeed(); S.atEnd = false; }
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
      phoneSeconds: +S.phoneSec.toFixed(1), calmModeUsed: S.feedDone, calmModeAtSec: S.calmAt, peakMindClear: +S.calmPeak.toFixed(2), events: S.events.slice() };
  }
  function finish(kind, title, msg) {
    if (S && S.manual) toggleManual(false);
    S.state = kind; const sm = summary();
    endEl.innerHTML = `<div class="card ${kind === "won" ? "win" : "lose"}"><h1>${title}</h1><p>${msg}</p><div class="stats">
      <div><span>Time played</span><b>${sm.secondsPlayed} s</b></div><div><span>Clock left</span><b>${sm.clockLeft} s</b></div><div><span>Strikes</span><b>${sm.strikes} / ${level.maxStrikes}</b></div>
      <div><span>Modules solved</span><b>${sm.modulesSolved} / 3</b></div><div><span>Average arousal (0-1)</span><b>${sm.avgStress}</b></div><div><span>Seconds above 50% arousal</span><b>${sm.secondsHighStress}</b></div>
      <div><span>Paper blotches</span><b>${sm.paperBlots}</b></div><div><span>Sweat drops / slips / shorted presses</span><b>${sm.sweatDrops} / ${sm.slips} / ${sm.blockedPresses}</b></div><div><span>Time on the phone / calm mode</span><b>${sm.phoneSeconds} s / ${sm.calmModeUsed ? "used" : "not used"}</b></div><div><span>Mode</span><b>${mode === "test" ? "manual test (not real data)" : "live (Muse)"}</b></div><div><span>Seed</span><b>${sm.seed}</b></div></div>
      <div class="row"><button class="bz-btn" id="bzNew">NEW BOMB</button><button class="bz-btn" id="bzRe">RETRY THIS BOMB</button><button class="bz-btn" id="bzEx">EXIT</button></div></div>`;
    endEl.style.display = "flex";
    endEl.querySelector("#bzNew").onclick = () => build(undefined, false);
    endEl.querySelector("#bzRe").onclick = () => build(level.seed, false);
    endEl.querySelector("#bzEx").onclick = close;
    emit(kind === "won" ? "defused" : "explode", sm); emit("finish", sm);
  }
  function win() { beep(660, .15, "triangle", .06); setTimeout(() => beep(880, .15, "triangle", .06), 150); setTimeout(() => beep(1320, .3, "triangle", .06), 300); finish("won", "DEFUSED", "Nice work. The bomb is safe."); }
  function explode(why) {
    if (S && S.manual) toggleManual(false);
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
    const it = hit(handPos[0], handPos[1]);
    if (S.manual && !(it && (manWrap.contains(it.el) || it.el === clothEl))) { toggleManual(false); downItem = null; return; }   /* any click off the sheet puts it down */
    downItem = it; if (it && it.down) it.down();
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
    const forced = L.calmModeFactor(S.t, S.calmUntil, T), calmNow = forced === 0, s = L.effectiveStress(S.stressSm, S.calm, forced), rate = L.clockRate(s, S.strikes, T), shake = L.handShake(s, T);
    if (S.state === "running") {
      S.t += dt; S.remaining -= dt * rate; S.stressSum += S.stressSm * dt; if (S.stressSm > 0.5) S.stressHi += dt; if (S.phone) { S.phoneSec += dt; if (S.atEnd && !S.feedDone) tryCalmMode(); }
      const sec = Math.ceil(S.remaining);
      if (sec !== S.lastSec) { S.lastSec = sec; beep(rate > 1.3 ? 1000 : 800, .04, "square", .03); }
      if (S.remaining <= 0) { S.remaining = 0; explode("time"); }
      if (s > T.glitchStress && S.t > S.nextGlitch) { S.glitchUntil = S.t + 0.7; S.nextGlitch = S.t + 6 + Math.random() * 6; beep(70, .5, "sawtooth", .05); root.classList.add("bz-glitch"); setTimeout(() => root.classList.remove("bz-glitch"), 700); }
      spawnAcc += L.sweatRate(s, T) * dt; while (spawnAcc >= 1) { spawnAcc -= 1; spawnDrop(); }
      if (S.manual) { pAcc += L.sweatRate(s, T) * 0.45 * dt; while (pAcc >= 1) { pAcc -= 1; spawnPaperDrop(); } }
      if (s > 0.5 && S.t > S.nextSpike) { S.spikeUntil = S.t + 0.45; S.nextSpike = S.t + 3 + Math.random() * 3; }
      S.beat += dt * L.heartBpm(s) / 60;
      if (Math.floor(S.beat) > S.lastBeat) { S.lastBeat = Math.floor(S.beat); if (s > 0.25) { beep(60, .12, "sine", .09); setTimeout(() => beep(52, .1, "sine", .06), 210); } }
      if (S.pressAt != null && (performance.now() - S.pressAt) / 1000 > 0.4) {
        strip.className = "strip on stripc-" + level.button.strip;
        if (!S.stripLit) { S.stripLit = true; tip(level.button.strip.toUpperCase() + " strip. Keep holding. Let go when the clock shows its number (see sheet)."); tab = "button"; renderManual(); }
      }
    }
    if (S.state === "running" || S.state === "won") {
      let str = clockDigits(); if (S.state === "running" && (S.t < S.glitchUntil || shorted("timer"))) str = String(Math.floor(Math.random() * 9000 + 1000));
      setDigits(str);
    }
    ["timer", "button", "wires", "keypad"].forEach(key => bayOf[key].classList.toggle("shorted", shorted(key)));
    sparks(); drawArcs();
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
    const step = Math.floor(tt * 40), nz = (i, sd) => { const x = Math.sin((i + sd * 17.3) * 127.1 + sd * 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };   /* 40 Hz hash noise: fast jumps, not a smooth wobble */
    {
      manKick *= Math.exp(-dt * 6);
      const a = (shake * 0.16 + 0.1) * (sp > 1 ? 1.6 : 1), rot = nz(step, 7) * (s * 0.45 + 0.03);
      manWrap.style.transform = `translate(${(nz(step, 5) * a).toFixed(2)}px,${(nz(step, 6) * a + manKick * 0.5).toFixed(2)}px) rotate(${rot.toFixed(3)}deg)`;
    }
    const f60 = Math.floor(tt * 60);
    jit = [shake * sp * k * (0.7 * nz(f60, 1) + 0.3 * Math.sin(tt * 75)), shake * sp * k * (0.7 * nz(f60, 3) + 0.3 * Math.sin(tt * 66 + 2))];
    if (raw) { handPos = [raw[0] + jit[0], raw[1] + jit[1]]; if (overView) { hand.style.display = "block"; hand.style.transform = `translate(${handPos[0].toFixed(1)}px,${handPos[1].toFixed(1)}px) rotate(${(nz(f60, 9) * (1 + s * 7)).toFixed(2)}deg)`; } }
    { const amp = (0.25 + 2.9 * s) * k * (sp > 1 ? 1.7 : 1); bomb.style.transform = `translate(${(nz(step, 2) * amp).toFixed(2)}px,${(nz(step, 4) * amp * 0.7).toFixed(2)}px) scale(${k}) rotate(${(nz(step, 8) * 0.16 * s).toFixed(3)}deg)`; }
    /* vitals */
    rowS.querySelector("b").textContent = noRead ? "--" : Math.round(S.stressSm * 100) + "%"; rowS.querySelector(".bar i").style.width = (S.stressSm * 100) + "%";
    rowM.querySelector("b").textContent = Math.round(S.calm / T.calmMax * 100) + "%"; rowM.querySelector(".bar i").style.width = (S.calm / T.calmMax * 100) + "%";
    phMc.textContent = "MIND CLEAR " + Math.round(S.calm / T.calmMax * 100) + "%"; phBar.style.width = (S.calm / T.calmMax * 100) + "%"; phClock.textContent = clockDigits().replace(/^(..)(..)$/, "$1:$2");
    effect.querySelector("#bzT").textContent = shake.toFixed(1) + " px"; effect.querySelector("#bzC").textContent = "x" + rate.toFixed(2); effect.querySelector("#bzH").textContent = Math.round(L.heartBpm(s)) + " bpm"; effect.querySelector("#bzW").textContent = smudges.length;
    effect.querySelector("#bzK").textContent = calmNow ? Math.ceil(S.calmUntil - S.t) + " s" : S.feedDone ? "used" : "ready";
    calmBadge.style.display = calmNow && S.state === "running" ? "flex" : "none"; calmFx.style.opacity = calmNow && S.state === "running" ? 1 : 0; if (calmNow) calmBadge.querySelector("#cmT").textContent = Math.ceil(S.calmUntil - S.t) + " s left: shaking and sweat paused";
    vNote.textContent = mode === "test" ? "MANUAL TEST MODE: arousal is set by the slider. Results are not real data." : noRead ? "LIVE MODE: no arousal reading yet. Connect the headband and sit still for 15 s. Until then nothing shakes." : "LIVE MODE: driven by your arousal meter (heart rate, muscle tension, movement) compared with your rest.";
    stEl.textContent = (mode === "test" ? "MANUAL TEST" : "LIVE") + (opts.status ? "  |  " + opts.status() : "");
  }

  /* ---------- layout, keys ---------- */
  function fit() {
    const w = view.clientWidth, h = view.clientHeight; k = Math.max(0.3, Math.min((w - 40) / 1264, (h - 24) / 640));
    wrap.style.width = 1264 * k + "px"; wrap.style.height = 640 * k + "px";
  }
  function onKey(e) {
    if (e.key === "Enter" && S && S.state === "intro") { begin(); return; }
    if (e.key === "Escape") { if (S && S.manual) toggleManual(false); else if (S && S.phone) togglePhone(false); else close(); }
    else if (S && S.state === "running" && (e.key === "m" || e.key === "M")) toggleManual();
    else if (S && S.state === "running" && S.manual && (e.key === "1" || e.key === "2" || e.key === "3")) setTab(["wires", "button", "keypad"][+e.key - 1]);
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
  fit(); build(opts.seed, opts.intro !== false); setMode(mode); raf = requestAnimationFrame(frame);
}

root.BombUI = { open, close: () => ui && ui.close(), isOpen: () => !!ui, _ui: () => ui };
})(typeof window !== "undefined" ? window : globalThis);
