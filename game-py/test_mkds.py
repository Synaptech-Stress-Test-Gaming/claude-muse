"""Deterministic engine tests (port of game/mkds.test.js). Run: py game-py/test_mkds.py"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mkds as M

fails = 0


def ok(c, msg):
    global fails
    print(("PASS " if c else "FAIL ") + msg)
    if not c:
        fails += 1


def near(a, b, tol):
    return abs(a - b) <= tol


def inp(**kw):
    d = dict(steer=0.0, accel=False, brake=False, drift=False, item=False, back=False)
    d.update(kw)
    return d


IDLE = inp()


def straight(pct):
    g = M.Race(seed=7)
    g.set_focus(pct, True)
    g.state, g.t = "racing", 0.0
    P, T = g.player, g.T
    for k in g.karts:
        if not k.is_player:
            k.finished, k.finish_time, k.x, k.y, k.ghost_t = True, 1.0, 99999.0, 99999.0, 1e9
    i0 = T.start + 60
    p = T.pts[i0]
    P.x, P.y, P.h, P.v, P.idx, P.s, P.dist = p.x, p.y, math.atan2(p.ty, p.tx), 0.0, i0, p.s, 1000.0
    return g


def follow(g, k=6):
    P, T = g.player, g.T
    tp = T.pts[(P.idx + k) % T.N]
    return M.clamp(M.wrap(math.atan2(tp.y - P.y, tp.x - P.x) - P.h) * 2.5, -1, 1)


def top_speed(pct):
    g = straight(pct)
    P = g.player
    best = 0
    for f in range(60 * 14):
        g.step(inp(steer=follow(g), accel=True))
        P.coins = 0
        if f > 60 * 10:
            best = max(best, P.v)
    return best


def speed_at(pct, secs):
    g = straight(pct)
    for _ in range(int(60 * secs)):
        g.step(inp(accel=True))
    return g.player.v


def run(g, sec, i=None):
    for _ in range(int(60 * sec)):
        g.step(i or IDLE)


def place(g, cid, ahead, lat=0.0):
    k = next(q for q in g.karts if q.id == cid)
    T, P = g.T, g.player
    i = (P.idx + ahead) % T.N
    p = T.pts[i]
    k.x, k.y = p.x + p.nx * lat, p.y + p.ny * lat
    k.h, k.v, k.idx, k.s = math.atan2(p.ty, p.tx), 0.0, i, p.s
    k.dist = P.dist + ahead * 15
    k.finished, k.finish_time, k.ghost_t, k.stall_t, k.spin_t, k.hits, k.item = False, None, 0.0, 99.0, 0.0, 0, None
    return k


v0, v50, v100 = top_speed(0), top_speed(50), top_speed(100)
print("top speeds", v0, v50, v100)
ok(near(v0 / v50, 0.5, 0.03), "focus 0 gives 0.5x top speed (%.3f)" % (v0 / v50))
ok(near(v100 / v50, 1.5, 0.05), "focus 100 gives 1.5x top speed (%.3f)" % (v100 / v50))
ok(near(v50, M.MAXV, 8), "focus 50 gives base top speed %.1f" % v50)
a0, a50, a100 = speed_at(0, 1), speed_at(50, 1), speed_at(100, 1)
ok(near(a0 / a50, 0.5, 0.03) and near(a100 / a50, 1.5, 0.03), "acceleration scales 0.5x/1x/1.5x")

g = M.Race(seed=1)
g.set_focus(50, True)
g.set_focus(100)
g.step(IDLE)
ok(1 < g.m < 1.05, "multiplier eases instead of jumping (%.3f)" % g.m)
g.set_focus(None)
ok(g.focus_pct == 100, "None focus holds the last value")


def mush_add(pct):
    g = straight(pct)
    P = g.player
    for _ in range(60 * 8):
        g.step(inp(steer=follow(g), accel=True))
    P.item = {"type": "mush"}
    g.step(inp(accel=True, item=True))
    g.step(inp(accel=True))
    return P.boost_add


ok(near(mush_add(0), mush_add(100), 1e-6) and mush_add(0) > 0, "mushroom boost is the same at focus 0 and 100")

g = straight(50)
P, T = g.player, g.T
p = T.pts[P.idx]
P.x, P.y, P.v = p.x + p.nx * 120, p.y + p.ny * 120, 200.0
for _ in range(40):
    g.step(inp(accel=True))
ok(P.v < 180, "grass slows the kart (v=%.0f)" % P.v)
for _ in range(600):
    g.step(inp(accel=True))
ok(T.glob(P.x, P.y).d <= M.WALLD + 1, "wall keeps kart inside")

g = M.Race(seed=42)
g.set_focus(50, True)
P, T = g.player, g.T
frames = 0
while g.state != "results" and frames < 60 * 400:
    frames += 1
    g.step(inp(steer=follow(g, 7), accel=True))
laps = [e["lap"] for e in g.events if e["type"] == "lap" and e["id"] == "mario"]
ok(laps == [1, 2, 3], "player laps counted 1,2,3 (%s)" % laps)
ok(P.finished and g.state == "results", "race reaches results (t=%.1fs)" % g.t)
ok(sum(k.finished for k in g.karts) >= 6, "AI racers finish")
ok(g.results and len(g.results) == 8, "results list has 8 racers")
ok(all(T.glob(k.x, k.y).d <= M.WALLD + 2 for k in g.karts), "no kart outside the barrier")


def final(seed):
    g = M.Race(seed=seed)
    g.set_focus(50, True)
    for _ in range(60 * 30):
        g.step(inp(accel=True))
    return "|".join("%.3f,%.3f" % (k.x, k.y) for k in g.karts)


ok(final(5) == final(5), "same seed gives identical race")


def drift_test(secs):
    g = straight(50)
    P = g.player
    P.v = 200.0
    g.step(inp(steer=1, accel=True, drift=True))
    for _ in range(int(60 * secs)):
        g.step(inp(steer=1, accel=True, drift=True))
    st, was = P.mt, P.drift
    n0 = len(g.events)
    g.step(inp(steer=1, accel=True))
    return dict(was=was, st=st, boost=P.boost_t > 0, add=P.boost_add, ev=[e["stage"] for e in g.events[n0:] if e["type"] == "miniturbo"])


a, b, c, d = drift_test(0.3), drift_test(0.9), drift_test(1.6), drift_test(2.5)
ok(a["was"] == 1 and not a["boost"], "short drift gives no mini-turbo")
ok(b["st"] == 1 and b["boost"] and b["ev"][:1] == [1], "stage 1 mini-turbo")
ok(c["st"] == 2 and c["add"] > b["add"], "stage 2 stronger")
ok(d["st"] == 3 and d["add"] > c["add"], "stage 3 strongest")

g = M.Race(seed=3)
g.set_focus(50, True)
for _ in range(int(60 * 3.7)):
    g.step(inp())
while g.t < 0:
    g.step(inp(accel=True))
ok(g.player.rocket and g.player.boost_t > 0, "rocket start")
h = M.Race(seed=3)
h.set_focus(50, True)
while h.t < 0:
    h.step(inp(accel=True))
ok(h.player.stall_t > 0 and not h.player.rocket, "burnout when too early")

rows = list(M.ITEM_TABLE.values())
ok(all(sum(r[i] for r in rows) == 200 for i in range(8)), "item table columns total 100 percent")

g = straight(50)
P = g.player
v = place(g, "luigi", 200 // 15 + 1)
v.x, v.y = P.x + 200, P.y
g.objs.append(M.NS(t="banana", x=v.x, y=v.y, owner="mario", born=-9.0, life=9.0, dead=False, vx=0, vy=0))
g.step(IDLE)
ok(v.spin_t > 0, "banana spins the kart that hits it")

g = straight(50)
P = g.player
t = place(g, "luigi", 22)
P.item = {"type": "red"}
g.step(inp(item=True))
run(g, 3)
ok(t.hits > 0, "red shell hits the kart ahead")
g = straight(50)
P = g.player
t = place(g, "yoshi", 70)
P.item = {"type": "red"}
g.step(inp(item=True))
run(g, 6)
ok(t.hits > 0, "red shell follows the road around a bend")

g = straight(50)
P = g.player
t = place(g, "toad", 12)
P.item = {"type": "bomb"}
g.step(inp(item=True))
run(g, 4)
ok(t.hits > 0 and any(e["type"] == "explode" for e in g.events), "Bob-omb explodes and hits")

g = straight(50)
P = g.player
t = place(g, "wario", 60)
for k in g.karts:
    if not k.is_player and k is not t:
        k.finished, k.dist = False, -9999.0
P.item = {"type": "spiny"}
g.step(inp(item=True))
run(g, 5)
ok(t.hits > 0, "Spiny Shell hits the leader")

g = straight(50)
P = g.player
a1, b1 = place(g, "peach", 20), place(g, "dk", 30)
a1.stall_t = b1.stall_t = 0.0
P.item = {"type": "thunder"}
g.step(inp(item=True))
ok(a1.shrink_t > 5 and b1.shrink_t > 5 and P.shrink_t == 0 and a1.spin_t > 0, "Thunderbolt shrinks the others only")

g = straight(50)
P = g.player
a1 = place(g, "peach", 20)
P.item = {"type": "blooper"}
g.step(inp(item=True))
ok(a1.ink_t > 5 and P.ink_t == 0, "Blooper inks the others")

g = straight(50)
P = g.player
a1 = place(g, "peach", 8)
a1.item = {"type": "star"}
a1.ai.item_wait = 99
P.item = {"type": "boo"}
g.step(inp(item=True))
ok(P.ghost_t > 5 and P.item and P.item["type"] == "star" and a1.item is None, "Boo steals an item")
ok(g.hit_kart(P, "banana") is False and P.spin_t == 0, "ghost is immune")


def bullet(f):
    g = straight(f)
    P = g.player
    P.item = {"type": "bullet"}
    g.step(inp(item=True))
    run(g, 3)
    return P.v


b0, b1 = bullet(0), bullet(100)
ok(near(b0, b1, 1) and b0 > M.MAXV * 1.3, "Bullet Bill speed not scaled by focus (%.0f / %.0f)" % (b0, b1))

g = straight(50)
P = g.player
P.item = {"type": "gold"}
g.step(inp(item=True))
g.step(IDLE)
run(g, 0.3)
g.step(inp(item=True))
g.step(IDLE)
ok(P.boost_t > 0 and P.item and P.item["type"] == "gold", "Golden Mushroom boosts repeatedly")
run(g, 7.5)
ok(P.item is None, "Golden Mushroom runs out")

g = straight(50)
P = g.player
a1 = place(g, "bowser", 1)
P.star_t = 5
a1.x, a1.y = P.x + math.cos(P.h) * 20, P.y + math.sin(P.h) * 20
g.step(inp(accel=True))
ok(a1.spin_t > 0, "star kart spins what it touches")


def coin_top(n):
    g = straight(50)
    P = g.player
    best = 0
    for f in range(60 * 12):
        P.coins = n
        g.step(inp(steer=follow(g), accel=True))
        if f > 60 * 10:
            best = max(best, P.v)
    return best


ok(coin_top(10) > coin_top(0) * 1.04, "ten coins raise top speed")

g = M.Race(seed=9)
ai = g.karts[0]
ai.dist = g.player.dist + 3000
slow = g.rubber(ai)
ai.dist = g.player.dist - 3000
fast = g.rubber(ai)
ok(slow < 1 < fast, "rubber banding")
g = M.Race(seed=1)
ids = [k.id for k in g.karts]
ok(len(set(ids)) == 8 and g.player.id == "mario", "8 racers, player is Mario")

# the Python engine must agree with the JavaScript one
if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "game", "mkds.js")):
    import json
    import shutil
    import subprocess
    node = shutil.which("node")
    if node:
        code = ("const M=require('./game/mkds.js');const g=M.createRace({seed:5});g.setFocus(50,true);"
                "for(let f=0;f<1800;f++)g.step({steer:0,accel:true});"
                "console.log(JSON.stringify(g.karts.map(k=>[k.x,k.y,k.v])))")
        root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
        js = json.loads(subprocess.run([node, "-e", code], cwd=root, capture_output=True, text=True).stdout)
        g = M.Race(seed=5)
        g.set_focus(50, True)
        for _ in range(1800):
            g.step(inp(accel=True))
        diff = max(max(abs(a - b) for a, b in zip(j, [k.x, k.y, k.v])) for j, k in zip(js, g.karts))
        ok(diff < 1e-6, "Python engine matches the JavaScript engine (max diff %.2e)" % diff)

print("\n%d FAILED" % fails if fails else "\nall passed")
sys.exit(1 if fails else 0)
