/* engine/gamebody.js
   The v2 game-link body (POSTed to http://127.0.0.1:8765/) and the button-event queue. Pure functions.
   The first five fields keep their exact old meaning and types: focus (the number games use: New focus when New is selected, Legacy focus
   when Legacy is selected; null when stale/unavailable, never 0), mode, sensors (4 numbers), motion (legacy strings), stale.
   New fields: v, session, seq, device, engine, profile {label, conf}, metrics {focus, stress, drowsiness}, events (button events only), legacy.
   Events are never dropped between posts: each has an increasing id; the panel resends until the server replies {"ok":true,"ack":<id>}
   (a reply without ack, an old server, acknowledges everything that was sent); at most 32 per post. No templates or statistics are ever sent.
   UMD: MuseEngine.GameBody. Tested by engine/gamebody.test.js. */
"use strict";
(function (root) {
  const E = root.MuseEngine = root.MuseEngine || {};
  const r1 = v => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
  const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
  function metric(m) { if (!m) return null; const o = { value: r1(m.value), conf: r2(m.conf) || 0, state: m.state }; if (m.reason) o.reason = m.reason; if (o.state === "stale" || o.state === "unavailable") o.value = null; return o; }
  /* st: {engine, device, mode, sensors, motion, legacyFocus, legacyStale, out (EngineOut), session, seq, events} */
  function build(st) {
    const out = st.out || null, isNew = st.engine !== "legacy";
    let focus = null, stale = false;
    if (isNew) { const f = out && out.focus; focus = f && (f.state === "live" || f.state === "held" || f.state === "learning") ? r1(f.value) : null; stale = !f || f.state === "held" || f.state === "stale" || f.state === "unavailable"; }
    else { focus = r1(st.legacyFocus); stale = !!st.legacyStale; }
    const sensors = (st.sensors || []).slice(0, 4).map(v => v == null || !isFinite(v) ? null : Math.round(v)); while (sensors.length < 4) sensors.push(null);
    const body = { focus, mode: st.mode || "focus", sensors, motion: st.motion == null ? null : st.motion, stale,
      v: 2, session: st.session, seq: st.seq, device: st.device, engine: isNew ? "new" : "legacy",
      profile: out && out.profile && out.profile.label ? { label: String(out.profile.label), conf: r2(out.profile.confidence) } : null,
      metrics: out ? { focus: metric(out.focus), stress: metric(out.stress), drowsiness: out.drowsiness ? metric(out.drowsiness) : null } : null,
      events: (st.events || []).slice(0, 32).map(e => ({ id: e.id, type: e.type, t: r2(e.t), conf: r2(e.conf) })),
      legacy: { focus: r1(out && out.legacy ? out.legacy.focus : st.legacyFocus), stress: r1(out && out.legacy ? out.legacy.stress : null) } };
    return body;
  }
  /* the resend queue */
  function queue(max) {
    max = max || 256; const Q = { items: [], lastSent: [] };
    Q.push = e => { if (e.type !== "double_blink" && e.type !== "clench_tap") return; Q.items.push({ id: e.id, type: e.type, t: e.t, conf: e.conf }); if (Q.items.length > max) Q.items.shift(); };
    Q.batch = () => { Q.lastSent = Q.items.slice(0, 32); return Q.lastSent; };
    /* reply: parsed JSON or null. With "ack": drop id <= ack. Without (old server): drop what was sent. */
    Q.reply = r => { if (r && typeof r.ack === "number") Q.items = Q.items.filter(e => e.id > r.ack); else if (r && r.ok) { const s = new Set(Q.lastSent.map(e => e.id)); Q.items = Q.items.filter(e => !s.has(e.id)); } Q.lastSent = []; };
    return Q;
  }
  const API = { build, queue };
  E.GameBody = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
