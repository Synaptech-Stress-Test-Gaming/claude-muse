"""Mario Kart DS style race engine (Figure-8 Circuit): Python port of game/mkds.js.
Pure logic, no pygame. Fixed timestep, seeded randomness. Private non-commercial fan recreation.
Values marked (approx) are best guesses, not extracted game data. Item odds are the real MKDS
Grand Prix (player) table as listed on the Super Mario Wiki (percent x 2)."""
import math
import numpy as np
from types import SimpleNamespace as NS

DT = 1 / 60
TAU = math.tau
MAXV = 250.0            # base top speed, units/s at multiplier 1.0 (approx)
ACC = MAXV / 2.4        # base acceleration (approx)
HALF = 85.0             # road half width
WALLD = 175.0           # barrier distance from the centerline
KR = 17.0               # kart radius
LAPS = 3
MT1, MT2, MT3 = 0.55, 1.3, 2.1   # drift seconds for mini-turbo stages 1..3 (approx)
SUB = 24


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def wrap(a):
    while a > math.pi:
        a -= TAU
    while a < -math.pi:
        a += TAU
    return a


def rng(seed):
    """mulberry32, same stream as the JavaScript engine."""
    s = [seed & 0xFFFFFFFF]

    def r():
        s[0] = (s[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = s[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return r


# the 8 default MKDS racers
CHARS = [
    dict(id="mario", name="Mario", skill=1.0, w=1.0, cap="#e52521", skin="#f5c9a0", hair="#5a2d0c", kart="#e52521", kart2="#f5d63d"),
    dict(id="peach", name="Peach", skill=.975, w=.8, cap="#ff8fc7", skin="#f8d7b8", hair="#f2c14e", kart="#ff7fbd", kart2="#fff1f8"),
    dict(id="luigi", name="Luigi", skill=.985, w=1.0, cap="#2e9a2e", skin="#f5c9a0", hair="#5a2d0c", kart="#2fae3f", kart2="#1a5aa8"),
    dict(id="yoshi", name="Yoshi", skill=.97, w=.8, cap="#46c14a", skin="#7ed957", hair="#46c14a", kart="#46c14a", kart2="#ffffff"),
    dict(id="toad", name="Toad", skill=.965, w=.75, cap="#f4f4f4", skin="#f5d9bb", hair="#e52521", kart="#3a73d6", kart2="#f4f4f4"),
    dict(id="dk", name="Donkey Kong", skill=.98, w=1.3, cap="#7a4a1d", skin="#c18a5a", hair="#5b3414", kart="#8a5a2b", kart2="#e52521"),
    dict(id="wario", name="Wario", skill=.99, w=1.25, cap="#f4d11f", skin="#f1bf93", hair="#4b3a2a", kart="#d9b81a", kart2="#7a3ab5"),
    dict(id="bowser", name="Bowser", skill=1.0, w=1.5, cap="#e8761c", skin="#e8b43c", hair="#d8591a", kart="#2f8f3a", kart2="#e8761c"),
]

# MKDS Grand Prix (player) odds by place 1..8, percent x 2
ITEM_TABLE = {
    "green":   [45, 25, 15, 5, 0, 0, 0, 0],
    "red":     [0, 55, 40, 25, 20, 10, 0, 0],
    "banana":  [90, 30, 15, 5, 0, 0, 0, 0],
    "fake":    [35, 20, 10, 0, 0, 0, 0, 0],
    "mush":    [0, 30, 40, 45, 40, 35, 10, 0],
    "tmush":   [0, 0, 10, 30, 55, 60, 70, 30],
    "bomb":    [0, 10, 20, 20, 10, 0, 0, 0],
    "spiny":   [0, 0, 0, 10, 20, 15, 0, 0],
    "thunder": [0, 0, 0, 0, 0, 10, 20, 45],
    "tgreen":  [0, 15, 25, 20, 10, 0, 0, 0],
    "tbanana": [30, 15, 5, 0, 0, 0, 0, 0],
    "tred":    [0, 0, 5, 15, 15, 5, 0, 0],
    "star":    [0, 0, 0, 0, 10, 25, 40, 25],
    "gold":    [0, 0, 0, 0, 0, 15, 35, 55],
    "bullet":  [0, 0, 0, 0, 0, 10, 20, 45],
    "blooper": [0, 0, 10, 15, 10, 5, 0, 0],
    "boo":     [0, 0, 5, 10, 10, 10, 5, 0],
}
ITEM_NAMES = {
    "green": "Green Shell", "red": "Red Shell", "banana": "Banana", "fake": "Fake Item Box", "mush": "Mushroom",
    "tmush": "Triple Mushrooms", "bomb": "Bob-omb", "spiny": "Spiny Shell", "thunder": "Thunderbolt",
    "tgreen": "Triple Green Shells", "tbanana": "Triple Bananas", "tred": "Triple Red Shells", "star": "Star",
    "gold": "Golden Mushroom", "bullet": "Bullet Bill", "blooper": "Blooper", "boo": "Boo",
}
TRIPLE = {"tmush": ("mush", 3), "tgreen": ("green", 3), "tred": ("red", 3), "tbanana": ("banana", 3)}

# Figure-8 Circuit: two loops joined at the origin (the real crossing is a bridge; here it is flat)
CTRL = [
    (0, 0), (400, -280), (780, -440), (1100, -360), (1280, -120), (1280, 160), (1100, 380), (780, 450), (400, 290),
    (0, 0), (-400, -280), (-780, -440), (-1100, -360), (-1280, -120), (-1280, 160), (-1100, 380), (-780, 450), (-400, 290),
]


class Track:
    def __init__(self):
        n = len(CTRL)
        pts = []
        for i in range(n):
            p0, p1, p2, p3 = CTRL[(i - 1) % n], CTRL[i], CTRL[(i + 1) % n], CTRL[(i + 2) % n]
            for j in range(SUB):
                t = j / SUB
                t2, t3 = t * t, t * t * t
                f = lambda k: 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
                pts.append(NS(x=f(0), y=f(1)))
        N = len(pts)
        s = 0.0
        for i in range(N):
            a, b, c = pts[i], pts[(i + 1) % N], pts[(i - 1) % N]
            tx, ty = b.x - c.x, b.y - c.y
            l = math.hypot(tx, ty)
            tx /= l
            ty /= l
            a.tx, a.ty, a.nx, a.ny, a.s = tx, ty, -ty, tx, s
            s += math.hypot(b.x - a.x, b.y - a.y)
        self.L = s
        for i in range(N):
            b = pts[(i + 1) % N]
            pts[i].len = math.hypot(b.x - pts[i].x, b.y - pts[i].y)
        self.pts, self.N = pts, N
        self.start = SUB
        self.half, self.wall = HALF, WALLD
        self._ax = np.array([p.x for p in pts])
        self._ay = np.array([p.y for p in pts])
        self._dx = np.roll(self._ax, -1) - self._ax
        self._dy = np.roll(self._ay, -1) - self._ay
        self._l2 = self._dx * self._dx + self._dy * self._dy

    def seg_dist(self, x, y, i):
        pts, N = self.pts, self.N
        a, b = pts[i], pts[(i + 1) % N]
        dx, dy = b.x - a.x, b.y - a.y
        l2 = dx * dx + dy * dy
        t = ((x - a.x) * dx + (y - a.y) * dy) / l2 if l2 else 0.0
        t = clamp(t, 0, 1)
        px, py = a.x + dx * t, a.y + dy * t
        return NS(d=math.hypot(x - px, y - py), t=t, px=px, py=py, i=i)

    def glob(self, x, y):
        """Nearest point on the whole centerline (vectorised)."""
        l2 = np.where(self._l2 > 0, self._l2, 1.0)
        t = np.clip(((x - self._ax) * self._dx + (y - self._ay) * self._dy) / l2, 0.0, 1.0)
        px, py = self._ax + self._dx * t, self._ay + self._dy * t
        d = np.hypot(x - px, y - py)
        i = int(np.argmin(d))
        return NS(d=float(d[i]), t=float(t[i]), px=float(px[i]), py=float(py[i]), i=i)

    def window(self, x, y, i0, back, fwd):
        best = None
        for k in range(-back, fwd + 1):
            r = self.seg_dist(x, y, (i0 + k + self.N * 4) % self.N)
            if best is None or r.d < best.d:
                best = r
        return best

    def at(self, sf):
        N, pts = self.N, self.pts
        i = int(math.floor(sf)) % N
        t = sf - math.floor(sf)
        a, b = pts[i], pts[(i + 1) % N]
        return NS(x=a.x + (b.x - a.x) * t, y=a.y + (b.y - a.y) * t, tx=a.tx + (b.tx - a.tx) * t, ty=a.ty + (b.ty - a.ty) * t,
                  nx=a.nx + (b.nx - a.nx) * t, ny=a.ny + (b.ny - a.ny) * t)


TRACK = Track()
IDLE = dict(steer=0.0, accel=False, brake=False, drift=False, item=False, back=False)


class Race:
    def __init__(self, seed=1234, laps=LAPS):
        self.T = T = TRACK
        self.laps = laps
        self.rand = rng(seed)
        self.t = -4.0
        self.state = "countdown"
        self.karts, self.objs, self.boxes, self.coins, self.events, self.fx = [], [], [], [], [], []
        self.frame = 0
        self.m = 1.0
        self.m_target = 1.0
        self.focus_pct = 50.0
        self.results_t = 0.0
        self.results = None
        self.prev_item = False
        rand = self.rand
        order = ["peach", "luigi", "yoshi", "toad", "dk", "wario", "bowser", "mario"]
        for gi, cid in enumerate(order):
            c = next(q for q in CHARS if q["id"] == cid)
            sp = T.pts[T.start]
            row, side = gi >> 1, (1 if gi & 1 else -1)
            back = 60 + row * 62 + (gi & 1) * 24
            x = sp.x - sp.tx * back + sp.nx * side * 38
            y = sp.y - sp.ty * back + sp.ny * side * 38
            k = NS(id=cid, c=c, is_player=(cid == "mario"), x=x, y=y, h=math.atan2(sp.ty, sp.tx), v=0.0,
                   drift=0, drift_t=0.0, hop=0.0, boost_t=0.0, boost_add=0.0, spin_t=0.0, spin_ang=0.0, star_t=0.0,
                   shrink_t=0.0, ghost_t=0.0, bullet_t=0.0, gold_t=0.0, gold_cd=0.0, ink_t=0.0, item=None, roulette_t=0.0,
                   coins=0, idx=0, s=0.0, dist=-float(back), lap=0, finished=False, finish_time=None, place=gi + 1,
                   stall_t=0.0, accel_since=None, rocket=False, bo=0.0, hits=0, mt=0, lat=0.0,
                   ai=NS(lane=(rand() - .5) * 90, skill=c["skill"] * (0.99 + rand() * 0.02), item_wait=0.0, drift_on=False, hold=0.0))
            k.idx = (T.start - round(back / 15)) % T.N
            k.s = T.pts[k.idx].s
            self.karts.append(k)
        self.player = next(k for k in self.karts if k.is_player)
        for f in (0.09, 0.27, 0.47, 0.60, 0.78, 0.92):
            sf = (T.start + f * T.N) % T.N
            p = T.at(sf)
            for o in (-66, -22, 22, 66):
                self.boxes.append(NS(x=p.x + p.nx * o, y=p.y + p.ny * o, respawn=0.0))
        for f in (0.04, 0.17, 0.33, 0.55, 0.70, 0.86):
            for q in range(6):
                p = T.at((T.start + f * T.N + q * 2.5) % T.N)
                off = 20 if q % 2 else -20
                self.coins.append(NS(x=p.x + p.nx * off, y=p.y + p.ny * off, got=False, respawn=None))

    # ---- focus ----
    def set_focus(self, pct, instant=False):
        if pct is None or (isinstance(pct, float) and math.isnan(pct)):
            return                       # hold the last value when the signal drops
        self.focus_pct = clamp(float(pct), 0, 100)
        self.m_target = 0.5 + self.focus_pct / 100     # 0 -> 0.5x, 50 -> 1x, 100 -> 1.5x
        if instant:
            self.m = self.m_target

    def ev(self, typ, k=None, **extra):
        self.events.append(dict(type=typ, t=self.t, id=k.id if k else None, **extra))

    def rank(self, k):
        return 1e9 - k.finish_time if k.finished else k.dist

    def place_of(self, k):
        return sum(1 for o in self.karts if self.rank(o) > self.rank(k)) + 1

    def hit_kart(self, k, kind):
        if k.star_t > 0 or k.bullet_t > 0 or k.ghost_t > 0 or k.spin_t > 0.3:
            return False
        k.spin_t = 1.5 if kind == "bomb" else 1.1
        k.spin_ang = 0.0
        k.drift = 0
        k.drift_t = 0.0
        k.boost_t = 0.0
        k.gold_t = 0.0
        k.v *= 0.25
        if k.coins > 0:
            k.coins -= 1
        k.hits += 1
        self.ev("hit", k, kind=kind)
        return True

    def give_boost(self, k, add, secs):
        k.boost_add = max(k.boost_add if k.boost_t > 0 else 0.0, add)
        k.boost_t = max(k.boost_t, secs)

    def pick_item(self, k):
        pl = min(8, max(1, k.place)) - 1
        keys = list(ITEM_TABLE)
        tot = sum(ITEM_TABLE[q][pl] for q in keys)
        r = self.rand() * tot
        for q in keys:
            r -= ITEM_TABLE[q][pl]
            if r < 0:
                return q
        return "mush"

    def use_item(self, k, back=False):
        it = k.item
        if not it or k.roulette_t > 0:
            return False
        typ = it["type"]
        f = (math.cos(k.h), math.sin(k.h))
        sgn = -1 if back else 1
        consumed = True

        def spawn(**o):
            d = dict(owner=k.id, born=self.t, life=20.0, vx=0.0, vy=0.0, dead=False)
            d.update(o)
            self.objs.append(NS(**d))
        if typ in TRIPLE:
            base, n = TRIPLE[typ]
            if "n" not in it:
                it["n"] = n
            typ = base
            it["n"] -= 1
            consumed = it["n"] <= 0
        if typ == "mush":
            self.give_boost(k, MAXV * 0.40, 1.6)
            k.v = max(k.v, MAXV * 0.9)
        elif typ == "green":
            spawn(t="green", x=k.x + f[0] * 30 * sgn, y=k.y + f[1] * 30 * sgn, vx=f[0] * 470 * sgn, vy=f[1] * 470 * sgn, bounces=0, life=12.0)
        elif typ == "red":
            cands = sorted([o for o in self.karts if o is not k and o.dist > k.dist and not o.finished], key=lambda o: o.dist)
            spawn(t="red", x=k.x + f[0] * 30, y=k.y + f[1] * 30, h=k.h, tgt=cands[0].id if cands else None, life=14.0, i=None)
        elif typ == "banana":
            spawn(t="banana", x=k.x - f[0] * 30 * sgn, y=k.y - f[1] * 30 * sgn, life=90.0)
        elif typ == "fake":
            spawn(t="fake", x=k.x - f[0] * 30 * sgn, y=k.y - f[1] * 30 * sgn, life=90.0)
        elif typ == "bomb":
            spawn(t="bomb", x=k.x + f[0] * 26 * sgn, y=k.y + f[1] * 26 * sgn, vx=f[0] * (k.v + 190) * sgn, vy=f[1] * (k.v + 190) * sgn, fuse=2.4, life=6.0)
        elif typ == "spiny":
            lead = sorted([o for o in self.karts if o is not k], key=lambda o: -self.rank(o))[0]
            spawn(t="spiny", sf=float(k.idx + 6), tgt=lead.id, x=k.x, y=k.y, life=30.0)
        elif typ == "thunder":
            for o in self.karts:
                if o is not k and o.star_t <= 0 and o.bullet_t <= 0 and o.ghost_t <= 0:
                    o.shrink_t = 6.0
                    o.spin_t = max(o.spin_t, 0.6)
                    o.v *= 0.5
                    o.drift = 0
            self.ev("thunder", k)
        elif typ == "blooper":
            for o in self.karts:
                if o is not k:
                    o.ink_t = 6.0
        elif typ == "boo":
            k.ghost_t = 6.0
            vics = sorted([o for o in self.karts if o is not k and o.item and o.dist > k.dist - 400], key=lambda o: abs(o.dist - k.dist))
            if vics:
                vic = vics[0]
                k.item = vic.item
                vic.item = None
                self.ev("steal", k, **{"from": vic.id})
                consumed = False
        elif typ == "star":
            k.star_t = 7.0
        elif typ == "gold":
            if k.gold_t <= 0 and not it.get("started"):
                it["started"] = True
                k.gold_t = 7.0
            if k.gold_cd > 0:
                return False
            self.give_boost(k, MAXV * 0.40, 0.9)
            k.gold_cd = 0.25
            k.v = max(k.v, MAXV * 0.9)
            consumed = False
        elif typ == "bullet":
            k.bullet_t = 5.0
            k.v = max(k.v, MAXV)
        if consumed:
            k.item = None
        self.ev("use", k, item=it["type"])
        return True

    # ---- AI ----
    def ai_input(self, k):
        T, a = self.T, k.ai
        N = T.N
        la = round(5 + min(6, k.v / 60))
        tp = T.pts[(k.idx + la) % N]
        tx, ty = tp.x + tp.nx * a.lane, tp.y + tp.ny * a.lane
        diff = wrap(math.atan2(ty - k.y, tx - k.x) - k.h)
        steer = clamp(diff * 2.4, -1, 1)
        ahead, cur = T.pts[(k.idx + 14) % N], T.pts[k.idx]
        curve = abs(wrap(math.atan2(ahead.ty, ahead.tx) - math.atan2(cur.ty, cur.tx)))
        want = abs(diff) > 0.1 if a.drift_on else (abs(diff) > 0.4 and k.v > 140)
        if curve < 0.15:
            want = False
        a.drift_on = bool(want and k.spin_t <= 0)
        if a.drift_on and not k.drift:
            steer = 1 if diff > 0 else -1
        return dict(steer=steer, accel=True, brake=(curve > 0.8 and k.v > 190), drift=a.drift_on)

    def ai_use_item(self, k):
        it = k.item
        if not it or k.roulette_t > 0 or k.is_player:
            return
        ai, T = k.ai, self.T
        if ai.item_wait > 0:
            ai.item_wait -= DT
            return
        base = TRIPLE[it["type"]][0] if it["type"] in TRIPLE else it["type"]
        ahead = [o for o in self.karts if o is not k and o.dist > k.dist and o.dist - k.dist < 500]
        behind = [o for o in self.karts if o is not k and o.dist < k.dist and k.dist - o.dist < 300]
        in_front = any(abs(wrap(math.atan2(o.y - k.y, o.x - k.x) - k.h)) < 0.3 and math.hypot(o.x - k.x, o.y - k.y) < 420 for o in ahead)
        if base == "mush":
            p = T.pts[(k.idx + 10) % T.N]
            use = abs(wrap(math.atan2(p.y - k.y, p.x - k.x) - k.h)) < 0.25
        elif base == "green":
            use = in_front
        elif base in ("red", "bomb"):
            use = len(ahead) > 0
        elif base in ("banana", "fake"):
            use = len(behind) > 0
        elif base == "spiny":
            use = k.place > 1
        elif base == "gold":
            use = k.gold_t <= 0 or k.gold_cd <= 0
        else:
            use = True
        if not use:
            ai.hold += DT
            if ai.hold < 9:
                return
        ai.hold = 0.0
        ai.item_wait = 0.5 + self.rand() * 1.5
        self.use_item(k, False)

    def rubber(self, k):
        gap = k.dist - self.player.dist
        return clamp(1 - gap / 6000, 0.92, 1.07)

    # ---- kart physics ----
    def step_kart(self, k, inp, dt):
        T = self.T
        is_p = k.is_player
        gl = T.glob(k.x, k.y)
        off = gl.d > HALF
        if k.boost_t > 0:
            k.boost_t -= dt
            if k.boost_t <= 0:
                k.boost_add = 0.0
        for nm in ("star_t", "shrink_t", "ghost_t", "ink_t", "gold_cd", "hop", "stall_t"):
            if getattr(k, nm) > 0:
                setattr(k, nm, getattr(k, nm) - dt)
        if k.gold_t > 0:
            k.gold_t -= dt
            if k.gold_t <= 0 and k.item and k.item["type"] == "gold":
                k.item = None
        steer = clamp(float(inp.get("steer") or 0), -1, 1)
        acc, brk, drift = bool(inp.get("accel")), bool(inp.get("brake")), bool(inp.get("drift"))
        if k.bullet_t > 0:
            k.bullet_t -= dt
            tp = T.pts[(k.idx + 8) % T.N]
            diff = wrap(math.atan2(tp.y - k.y, tp.x - k.x) - k.h)
            steer, acc, brk, drift, k.drift = clamp(diff * 3, -1, 1), True, False, False, 0
        if k.spin_t > 0:
            k.spin_t -= dt
            steer, acc, brk, drift, k.drift = 0.0, False, False, False, 0
            k.spin_ang += dt * 9
            if k.spin_t <= 0:
                k.spin_ang = 0.0
        if self.state != "racing" and not k.finished:
            acc, steer, drift = False, 0.0, False

        # Only the base top speed and base acceleration use the focus multiplier; boosts keep their own values.
        m = self.m if is_p else 1.0
        cap = MAXV * m * (1 + 0.006 * k.coins)
        if not is_p:
            cap = MAXV * k.ai.skill * self.rubber(k)
        if k.shrink_t > 0:
            cap *= 0.7
        if off and k.star_t <= 0 and k.bullet_t <= 0 and k.boost_t <= 0:
            cap *= 0.45
        add = k.boost_add if k.boost_t > 0 else 0.0
        if k.star_t > 0:
            add = max(add, MAXV * 0.12)
        if k.bullet_t > 0:
            cap, add = MAXV, MAXV * 0.5
        top = cap + add
        accel = max(ACC * (self.m if is_p else 1.0), ACC * 2.5 if (k.boost_t > 0 or k.bullet_t > 0) else 0.0)
        if k.stall_t > 0:
            acc = False
        if acc and not brk:
            if k.v < top:
                k.v = min(top, k.v + accel * dt)
            else:
                k.v += (top - k.v) * min(1, dt * 2.2)
        elif brk:
            if k.v > 0:
                k.v = max(0.0, k.v - 460 * dt)
            else:
                k.v = max(-0.25 * MAXV * m, k.v - ACC * 0.5 * dt)
        else:
            k.v -= math.copysign(min(abs(k.v), 75 * dt), k.v) if k.v else 0
        if k.v > top and not acc:
            k.v += (top - k.v) * min(1, dt * 1.2)

        # drift
        if drift and not k.drift and abs(steer) > 0.25 and k.v > 105 and not off:
            k.drift = 1 if steer > 0 else -1
            k.drift_t = 0.0
            k.hop = 0.22
            self.ev("driftstart", k)
        if k.drift:
            if not drift or k.v < 85 or k.spin_t > 0:
                st = 3 if k.drift_t >= MT3 else 2 if k.drift_t >= MT2 else 1 if k.drift_t >= MT1 else 0
                if st == 1:
                    self.give_boost(k, MAXV * 0.22, 0.65)
                if st == 2:
                    self.give_boost(k, MAXV * 0.30, 1.1)
                if st == 3:
                    self.give_boost(k, MAXV * 0.36, 1.5)
                if st:
                    self.ev("miniturbo", k, stage=st)
                k.drift = 0
                k.drift_t = 0.0
            else:
                k.drift_t += dt
        k.mt = (3 if k.drift_t >= MT3 else 2 if k.drift_t >= MT2 else 1 if k.drift_t >= MT1 else 0) if k.drift else 0

        # steering
        spd_f = clamp(abs(k.v) / (0.25 * MAXV), 0, 1) * (-1 if k.v < 0 else 1)
        hi_f = 1 - 0.22 * clamp(abs(k.v) / (MAXV * 1.2), 0, 1)
        if k.drift:
            w = 2.5 * (k.drift * 0.8 + steer * 0.6) * hi_f
        else:
            w = 2.5 * steer * spd_f * hi_f
        k.h += w * dt
        k.bo += ((k.drift * 0.5 if k.drift else steer * 0.12 * abs(spd_f)) - k.bo) * min(1, dt * 10)
        k.x += math.cos(k.h) * k.v * dt
        k.y += math.sin(k.h) * k.v * dt

        # walls
        g2 = T.glob(k.x, k.y)
        if g2.d > WALLD:
            nx, ny = (k.x - g2.px) / g2.d, (k.y - g2.py) / g2.d
            k.x, k.y = g2.px + nx * WALLD, g2.py + ny * WALLD
            fx, fy = math.cos(k.h), math.sin(k.h)
            dn = fx * nx + fy * ny
            if dn > 0:
                tx, ty = fx - nx * dn, fy - ny * dn
                tl = math.hypot(tx, ty) or 1
                k.h = math.atan2(ty / tl, tx / tl)
                k.v *= 1 - 0.45 * dn
                k.drift = 0
                k.drift_t = 0.0
                if dn > 0.35:
                    self.ev("wall", k)
        # progress
        w2 = T.window(k.x, k.y, k.idx, 8, 18)
        s_new = T.pts[w2.i].s + w2.t * T.pts[w2.i].len
        ds = s_new - k.s
        if ds > T.L / 2:
            ds -= T.L
        elif ds < -T.L / 2:
            ds += T.L
        k.s, k.idx = s_new, w2.i
        k.dist += ds
        pw = T.pts[w2.i]
        k.lat = (k.x - w2.px) * pw.nx + (k.y - w2.py) * pw.ny
        while k.dist >= (k.lap + 1) * T.L and not k.finished:
            k.lap += 1
            self.ev("lap", k, lap=k.lap)
            if k.lap >= self.laps:
                k.finished = True
                k.finish_time = self.t
                k.place = self.place_of(k)
                self.ev("finish", k, place=k.place, time=self.t)

    # ---- items in the world ----
    def explode(self, o, r):
        o.dead = True
        self.ev("explode", None, x=o.x, y=o.y, kind=o.t, r=r)
        self.fx.append(NS(x=o.x, y=o.y, r=r, t=0.0))
        for k in self.karts:
            if math.hypot(k.x - o.x, k.y - o.y) < r:
                self.hit_kart(k, "bomb")

    def update_objs(self, dt):
        T = self.T
        for o in self.objs:
            o.life -= dt
            if o.life <= 0:
                o.dead = True
                continue
            grace = self.t - o.born < 0.35
            if o.t == "green":
                o.x += o.vx * dt
                o.y += o.vy * dt
                q = T.glob(o.x, o.y)
                if q.d > WALLD - 6:
                    nx, ny = (o.x - q.px) / q.d, (o.y - q.py) / q.d
                    dn = o.vx * nx + o.vy * ny
                    if dn > 0:
                        o.vx -= 2 * dn * nx
                        o.vy -= 2 * dn * ny
                        o.bounces += 1
                        o.x, o.y = q.px + nx * (WALLD - 8), q.py + ny * (WALLD - 8)
                        if o.bounces > 4:
                            o.dead = True
            elif o.t == "red":
                tk = next((q for q in self.karts if q.id == o.tgt), None) if o.tgt else None
                start_i = o.i if o.i is not None else next(q for q in self.karts if q.id == o.owner).idx
                cur = T.window(o.x, o.y, start_i, 6, 14)
                o.i = cur.i
                if tk and math.hypot(tk.x - o.x, tk.y - o.y) < 200:
                    ax, ay = tk.x, tk.y
                else:
                    tp = T.pts[(cur.i + 5) % T.N]
                    lat = tk.lat if tk else 0.0
                    ax, ay = tp.x + tp.nx * lat, tp.y + tp.ny * lat
                want = math.atan2(ay - o.y, ax - o.x)
                o.h += clamp(wrap(want - o.h), -7 * dt, 7 * dt)
                o.x += math.cos(o.h) * 460 * dt
                o.y += math.sin(o.h) * 460 * dt
                if T.glob(o.x, o.y).d > WALLD:
                    o.dead = True
            elif o.t == "bomb":
                o.x += o.vx * dt
                o.y += o.vy * dt
                dr = 0.35 ** dt
                o.vx *= dr
                o.vy *= dr
                q = T.glob(o.x, o.y)
                if q.d > WALLD:
                    o.vx *= -0.3
                    o.vy *= -0.3
                    o.x = q.px + (o.x - q.px) / q.d * (WALLD - 4)
                    o.y = q.py + (o.y - q.py) / q.d * (WALLD - 4)
                o.fuse -= dt
                if o.fuse <= 0:
                    self.explode(o, 125)
            elif o.t == "spiny":
                o.sf += (680 / 15) * dt
                p = T.at(o.sf)
                o.x, o.y = p.x, p.y
                tk = next((q for q in self.karts if q.id == o.tgt), None)
                if tk and math.hypot(tk.x - o.x, tk.y - o.y) < 60:
                    self.explode(o, 150)
                if tk and not o.dead and math.hypot(tk.x - o.x, tk.y - o.y) < 400:
                    d = math.hypot(tk.x - o.x, tk.y - o.y) or 1
                    o.x += (tk.x - o.x) / d * 680 * dt * 0.4
                    o.y += (tk.y - o.y) / d * 680 * dt * 0.4
            if o.dead:
                continue
            if o.t in ("green", "red"):
                for k in self.karts:
                    if k.id == o.owner and grace:
                        continue
                    if math.hypot(k.x - o.x, k.y - o.y) < KR + 7:
                        self.hit_kart(k, o.t)
                        o.dead = True
                        break
            elif o.t in ("banana", "fake"):
                for k in self.karts:
                    if k.id == o.owner and grace:
                        continue
                    if math.hypot(k.x - o.x, k.y - o.y) < KR + 8:
                        if k.ghost_t > 0:
                            continue
                        if k.star_t > 0 or k.bullet_t > 0:
                            o.dead = True
                            break
                        self.hit_kart(k, o.t)
                        o.dead = True
                        break
            elif o.t == "bomb":
                for k in self.karts:
                    if k.id == o.owner and grace:
                        continue
                    if math.hypot(k.x - o.x, k.y - o.y) < KR + 10:
                        self.explode(o, 125)
                        break
        self.objs = [o for o in self.objs if not o.dead]

    # ---- main step ----
    def step(self, inp):
        dt = DT
        self.frame += 1
        self.t += dt
        self.m += (self.m_target - self.m) * (1 - math.exp(-dt / 1.0))
        P = self.player
        if self.state == "countdown":
            if inp.get("accel") and P.accel_since is None:
                P.accel_since = self.t
            if not inp.get("accel"):
                P.accel_since = None
            if self.t >= 0:
                self.state = "racing"
                self.ev("go")
                if P.accel_since is not None:
                    early = -P.accel_since
                    if early <= 0.5:
                        P.rocket = True
                        self.give_boost(P, MAXV * 0.30, 1.0)
                        P.v = MAXV * 0.4
                        self.ev("rocket", P)
                    elif early >= 1.0:
                        P.stall_t = 0.9
                        self.ev("burnout", P)
                for k in self.karts:
                    if not k.is_player and k.ai.skill > 0.98 and self.rand() < 0.6:
                        self.give_boost(k, MAXV * 0.25, 0.8)
        for k in self.karts:
            k.place = self.place_of(k)
        for k in self.karts:
            if k.is_player and not k.finished:
                use = inp
            else:
                use = self.ai_input(k)
            if self.state == "countdown":
                use = dict(steer=0.0, accel=False, brake=False, drift=False)
            self.step_kart(k, use, dt)
            if not k.is_player:
                self.ai_use_item(k)
            if k.roulette_t > 0:
                k.roulette_t -= dt
                if k.roulette_t <= 0:
                    k.item = {"type": self.pick_item(k)}
                    self.ev("gotitem", k, item=k.item["type"])
        edge = bool(inp.get("item")) and not self.prev_item
        self.prev_item = bool(inp.get("item"))
        if edge and self.state == "racing" and not P.finished:
            self.use_item(P, bool(inp.get("back")))
        # kart vs kart
        ks = self.karts
        for i in range(len(ks)):
            for j in range(i + 1, len(ks)):
                a, b = ks[i], ks[j]
                if a.ghost_t > 0 or b.ghost_t > 0:
                    continue
                dx, dy = b.x - a.x, b.y - a.y
                d = math.hypot(dx, dy)
                mn = KR * 2 * (0.7 if (a.shrink_t > 0 or b.shrink_t > 0) else 1)
                if mn > d > 0.001:
                    nx, ny, over = dx / d, dy / d, mn - d
                    wa, wb = a.c["w"], b.c["w"]
                    tw = wa + wb
                    a.x -= nx * over * wb / tw
                    a.y -= ny * over * wb / tw
                    b.x += nx * over * wa / tw
                    b.y += ny * over * wa / tw
                    sa = a.star_t > 0 or a.bullet_t > 0
                    sb = b.star_t > 0 or b.bullet_t > 0
                    if sa and not sb:
                        self.hit_kart(b, "star")
                    elif sb and not sa:
                        self.hit_kart(a, "star")
                    else:
                        rel = abs(a.v - b.v)
                        a.v *= 0.97 + (0.02 if wa > wb else -0.03)
                        b.v *= 0.97 + (0.02 if wb > wa else -0.03)
                        if rel > 60:
                            self.ev("bump", a)
        for bx in self.boxes:
            if bx.respawn > 0:
                bx.respawn -= dt
                continue
            for k in ks:
                if k.item or k.roulette_t > 0:
                    continue
                if math.hypot(k.x - bx.x, k.y - bx.y) < KR + 14:
                    bx.respawn = 3.5
                    k.roulette_t = 1.5 if k.is_player else 0.9
                    self.ev("box", k)
                    break
        for c in self.coins:
            if c.got:
                if c.respawn is not None:
                    c.respawn -= dt
                    if c.respawn <= 0:
                        c.got, c.respawn = False, None
                continue
            for k in ks:
                if k.coins < 10 and math.hypot(k.x - c.x, k.y - c.y) < KR + 10:
                    c.got, c.respawn = True, 12.0
                    k.coins += 1
                    if k.is_player:
                        self.ev("coin", k)
                    break
        self.update_objs(dt)
        for f in self.fx:
            f.t += dt
        self.fx = [f for f in self.fx if f.t < 0.6]
        if self.state == "racing":
            if P.finished:
                self.results_t += dt
                if self.results_t > 4 or all(k.finished for k in ks):
                    self.state = "results"
                    self.results = self.compute_results()
            if self.t > 600:
                self.state = "results"
                self.results = self.compute_results()
        return self

    def compute_results(self):
        pts = [10, 8, 6, 4, 3, 2, 1, 0]
        lst = sorted(self.karts, key=lambda k: -self.rank(k))
        return [dict(place=i + 1, id=k.id, name=k.c["name"], time=k.finish_time if k.finished else None, points=pts[i], player=k.is_player)
                for i, k in enumerate(lst)]
