/* engine/holdfade.js
   Hold + fade state machine, one per metric. Input each hop {usable, value, conf, reason, learning, available}; time advances by the hop
   (or by idle(dt) when no data arrives, reason "signal lost").
     available == false          -> unavailable, value null, conf 0
     usable                      -> live (or learning), value = new value, conf = conf, heldFor = 0
     not usable, heldFor < 3 s   -> held, value = last clean value, conf = lastConf x (1 - heldFor/3), reason kept
     not usable, heldFor >= 3 s  -> stale, value null, conf 0, reason kept  (the UI shows "--" and the reason)
     no clean value yet          -> stale, value null
   Returning to live is immediate. After a stale period of more than 30 s the metric's EMA restarts from the new value (restart flag).
   State priority: unavailable > stale > held > learning > live.
   UMD: MuseEngine.HoldFade. Tested by engine/holdfade.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  function create(o) {
    o = Object.assign({ holdS: 3.0, restartS: 30, hop: 0.25 }, o);
    const H = { last: null, lastConf: 0, heldFor: 0, staleFor: 0, reason: null, state: "stale", restart: false };
    function out(state, value, conf, reason) { H.state = state; return { value, conf, state, reason: reason || null }; }
    H.step = function (inp, dt) {
      dt = dt == null ? o.hop : dt; H.restart = false;
      if (inp.available === false) { H.heldFor = 0; return out("unavailable", null, 0, inp.reason); }
      if (inp.usable && inp.value != null && isFinite(inp.value)) {
        if (H.staleFor > o.restartS) H.restart = true;
        H.last = inp.value; H.lastConf = inp.conf; H.heldFor = 0; H.staleFor = 0; H.reason = null;
        return out(inp.learning ? "learning" : "live", inp.value, inp.conf, inp.learning ? "learning" : null);
      }
      if (inp.reason) H.reason = inp.reason;
      if (H.last == null) { H.staleFor += dt; return out("stale", null, 0, H.reason); }
      const hf = H.heldFor; H.heldFor += dt;
      if (hf < o.holdS) return out("held", H.last, H.lastConf * (1 - hf / o.holdS), H.reason);
      H.staleFor += dt;
      return out("stale", null, 0, H.reason);
    };
    H.idle = dt => H.step({ usable: false, reason: "signal lost", available: true }, dt);
    H.reset = () => { H.last = null; H.lastConf = 0; H.heldFor = 0; H.staleFor = 0; H.reason = null; };
    return H;
  }
  const API = { create };
  E.HoldFade = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
