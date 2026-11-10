"""Mario Kart DS style game in Python (pygame), driven by the Muse 2 panel's focus meter.
Run:  py mario_kart.py            (needs: py -m pip install pygame numpy)
      py mario_kart.py --keyboard-focus    practice without a headband ([ and ] change focus)
Start the game, then connect the headband in the panel and press Auto Set Baselines. The game starts
its race once the panel reports a live focus score. All art is drawn in code (fan recreation)."""
import math
import os
import sys
import time

import numpy as np
import pygame

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mkds as M
from link import HeadbandLink

TAU = math.tau
W, H, HOR, F, CAMH, CAMD = 320, 240, 84, 190.0, 52.0, 118.0
BX0, BY0, BW, BH = -1700, -850, 3400, 1700
WIN_W, WIN_H = 1200, 760
VIEW = (20, 84, 800, 600)           # x, y, w, h of the scaled 3D view on screen


def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shade(h, f):
    return tuple(min(255, int(c * f)) for c in hexc(h))


# ------------------------------------------------------------------ track texture
def build_texture():
    T = M.TRACK
    img = np.zeros((BH, BW, 3), np.uint8)
    img[:] = (47, 111, 42)
    yy, xx = np.mgrid[0:BH, 0:BW]
    wx, wy = xx + BX0, yy + BY0
    # distance to the centerline, on a coarse grid then enlarged (fast enough and smooth enough)
    step = 4
    cx, cy = wx[::step, ::step], wy[::step, ::step]
    best = np.full(cx.shape, 1e9)
    seg = np.zeros(cx.shape, np.int32)
    pad = M.WALLD + 30
    for i in range(T.N):
        a, b = T.pts[i], T.pts[(i + 1) % T.N]
        gx0 = max(0, int((min(a.x, b.x) - pad - BX0) // step))
        gx1 = min(cx.shape[1], int((max(a.x, b.x) + pad - BX0) // step) + 1)
        gy0 = max(0, int((min(a.y, b.y) - pad - BY0) // step))
        gy1 = min(cx.shape[0], int((max(a.y, b.y) + pad - BY0) // step) + 1)
        if gx1 <= gx0 or gy1 <= gy0:
            continue
        sx_, sy_ = cx[gy0:gy1, gx0:gx1], cy[gy0:gy1, gx0:gx1]
        dx, dy = b.x - a.x, b.y - a.y
        l2 = dx * dx + dy * dy
        t = np.clip(((sx_ - a.x) * dx + (sy_ - a.y) * dy) / l2, 0, 1)
        d = np.hypot(sx_ - (a.x + dx * t), sy_ - (a.y + dy * t))
        bb, ss = best[gy0:gy1, gx0:gx1], seg[gy0:gy1, gx0:gx1]
        m = d < bb
        bb[m] = d[m]
        ss[m] = i
    D = np.kron(best, np.ones((step, step)))[:BH, :BW]
    S = np.kron(seg, np.ones((step, step), np.int32))[:BH, :BW]
    stripe = (S // 2) % 2 == 0
    checker = (((wx // 48) + (wy // 48)) % 2) == 0
    grass = np.where(checker[..., None], (88, 185, 68), (79, 174, 59)).astype(np.uint8)
    img[D < M.WALLD + 18] = np.where(stripe[..., None], (233, 233, 233), (204, 51, 51))[D < M.WALLD + 18]
    m = D < M.WALLD
    img[m] = grass[m]
    m = D < M.HALF + 9
    img[m] = np.where(stripe[..., None], (230, 230, 230), (216, 35, 42))[m]
    m = D < M.HALF
    rng = np.random.default_rng(1)
    noise = rng.integers(-6, 7, (BH, BW, 1))
    road = np.clip(np.array((141, 143, 154)) + noise, 0, 255).astype(np.uint8)
    img[m] = road[m]
    # start line
    sp = T.pts[T.start]
    ang = math.atan2(sp.ty, sp.tx)
    ux = (wx - sp.x) * math.cos(ang) + (wy - sp.y) * math.sin(ang)
    vy = -(wx - sp.x) * math.sin(ang) + (wy - sp.y) * math.cos(ang)
    ms = (ux > -14) & (ux < 14) & (np.abs(vy) < 85)
    chk = ((np.floor((ux + 14) / 14) + np.floor((vy + 85) / 8.5)) % 2) == 0
    img[ms & chk] = (255, 255, 255)
    img[ms & ~chk] = (17, 17, 17)
    return img


def mips(base):
    out = [(base, 1)]
    for d in (2, 4):
        h, w = BH // d, BW // d
        a = base[:h * d, :w * d].reshape(h, d, w, d, 3).mean((1, 3)).astype(np.uint8)
        out.append((a, d))
    return out


class Ground:
    """Mode-7 style floor, vectorised with numpy."""

    def __init__(self, tex):
        self.mips = mips(tex)
        self.rows = H - HOR
        ys = np.arange(self.rows) + 0.5
        self.dist = CAMH * F / ys                       # (rows,)
        self.xo = (np.arange(W) - W / 2)[None, :]       # (1, W)
        self.haze = np.clip((self.dist - 500) / 2600, 0, 0.85)[:, None, None]
        self.haze_col = np.array((198, 226, 180), np.float32)
        self.lv = np.where(self.dist > 1200, 2, np.where(self.dist > 520, 1, 0))
        self.bands = [(lv, np.where(self.lv == lv)[0]) for lv in range(3)]

    def render(self, camx, camy, ang):
        fx, fy = math.cos(ang), math.sin(ang)
        rx, ry = -fy, fx
        out = np.empty((self.rows, W, 3), np.uint8)
        for lv, rows in self.bands:
            if rows.size == 0:
                continue
            arr, d = self.mips[lv]
            D = self.dist[rows][:, None]
            wx = camx + fx * D + rx * self.xo * D / F
            wy = camy + fy * D + ry * self.xo * D / F
            ux = ((wx - BX0) / d).astype(np.int32)
            uy = ((wy - BY0) / d).astype(np.int32)
            ok = (ux >= 0) & (uy >= 0) & (ux < arr.shape[1]) & (uy < arr.shape[0])
            px = arr[np.clip(uy, 0, arr.shape[0] - 1), np.clip(ux, 0, arr.shape[1] - 1)]
            px[~ok] = (47, 111, 42)
            h = self.haze[rows]
            out[rows] = (px * (1 - h) + self.haze_col * h).astype(np.uint8)
        return out


# ------------------------------------------------------------------ sprites
def poly(s, pts, col):
    pygame.draw.polygon(s, col, pts)


def draw_kart(s, k, sx, sy, sc, cam_ang, t):
    a = M.wrap(k.h + k.bo + (k.spin_ang if k.spin_t > 0 else 0) - cam_ang)
    sa, ca = math.sin(a), math.cos(a)
    pf = CAMH / (F / sc) * 0.9
    scl = 0.6 if k.shrink_t > 0 else 1.0
    hop = math.sin(k.hop / 0.22 * math.pi) * 6 * sc if k.hop > 0 else 0

    def P(u, v, h):
        return (sx + (u * sa + v * ca) * sc * scl, sy - (u * ca - v * sa) * sc * pf * scl - h * sc * scl - hop)
    layer = pygame.Surface((W, H), pygame.SRCALPHA)
    if k.star_t > 0 and int(t * 12) % 2:
        pass
    pygame.draw.ellipse(layer, (0, 0, 0, 90), (sx - 24 * sc * scl, sy - 4 * sc * scl, 48 * sc * scl, 10 * sc * scl * pf * 2.2 + 2))
    col, col2 = k.c["kart"], k.c["kart2"]
    wheels = sorted([(u, v, u * ca - v * sa) for u, v in ((-15, -15), (-15, 15), (14, -15), (14, 15))], key=lambda w: -w[2])

    def wheel(w):
        x, y = P(w[0], w[1], 6)
        rw, rh = max(1, 5.5 * sc * scl * (0.55 + 0.45 * abs(ca))), max(1, 6.5 * sc * scl)
        pygame.draw.ellipse(layer, (21, 21, 26), (x - rw, y - rh, rw * 2, rh * 2))
        pygame.draw.circle(layer, (107, 107, 117), (x, y), max(1, 1.8 * sc * scl))
    for w in wheels:
        if w[2] > 0:
            wheel(w)
    u0, u1, v0, v1, h0, h1 = -19, 23, -12, 12, 3, 11
    faces = [((1, 0), ((u1, v0), (u1, v1)), shade(col2, .95)), ((-1, 0), ((u0, v1), (u0, v0)), shade(col, .7)),
             ((0, 1), ((u1, v1), (u0, v1)), shade(col, .85)), ((0, -1), ((u0, v0), (u1, v0)), shade(col, .8))]
    for n, q, c in faces:
        if n[0] * ca - n[1] * sa < 0.01:
            poly(layer, [P(*q[0], h0), P(*q[1], h0), P(*q[1], h1), P(*q[0], h1)], c)
    poly(layer, [P(u0, v0, h1), P(u1, v0, h1), P(u1, v1, h1), P(u0, v1, h1)], shade(col, 1.12))
    poly(layer, [P(8, -5, h1), P(u1, -3, h1), P(u1, 3, h1), P(8, 5, h1)], hexc(col2))
    for w in wheels:
        if w[2] <= 0:
            wheel(w)
    draw_driver(layer, k, P, sc * scl, ca, sa)
    if k.drift and k.drift_t > 0.15:
        c3 = (210, 123, 255) if k.mt == 3 else (255, 154, 42) if k.mt == 2 else (106, 215, 255) if k.mt == 1 else (255, 243, 176)
        for i in range(6):
            x, y = P(-20 + (i * 7 % 4), (1 if k.drift > 0 else -1) * (-10 - i * 1.3), 3 + (i * 5 % 6))
            pygame.draw.rect(layer, c3, (x, y, max(1, 1.6 * sc), max(1, 1.6 * sc)))
    if k.ghost_t > 0:
        layer.set_alpha(int(255 * (0.45 + 0.15 * math.sin(t * 8))))
    if k.star_t > 0 and int(t * 12) % 2:
        layer.fill((90, 90, 30, 0), special_flags=pygame.BLEND_RGB_ADD)
    s.blit(layer, (0, 0))


def draw_driver(s, k, P, sc, ca, sa):
    ch = k.c
    cid = ch["id"]
    face = ca < -0.05
    bx, by = P(-3, 0, 13)
    hx, hy = P(-2, 0, 27)
    rad = 8.4 * sc
    torso = {"peach": "#ff8fc7", "toad": "#4f7be0", "yoshi": "#7ed957", "dk": ch["hair"], "bowser": "#e8b43c",
             "wario": "#f4d11f", "luigi": "#2e9a2e"}.get(cid, "#e52521")
    pygame.draw.ellipse(s, hexc(torso), (bx - 8 * sc, by - 10.5 * sc, 16 * sc, 17 * sc))
    if cid in ("mario", "luigi", "wario"):
        pygame.draw.rect(s, (122, 58, 181) if cid == "wario" else (26, 63, 176), (bx - 6 * sc, by - sc, 12 * sc, 6 * sc))
    big = 1.12 if cid in ("dk", "bowser", "wario") else 0.9 if cid == "toad" else 1.0
    if cid == "peach" and not face:
        pygame.draw.ellipse(s, hexc(ch["hair"]), (hx - 9.5 * sc, hy - 5 * sc, 19 * sc, 22 * sc))
    pygame.draw.circle(s, hexc(ch["skin"]), (hx, hy), rad * big)
    if not face:
        if cid == "toad":
            pygame.draw.circle(s, (244, 244, 244), (hx, hy - sc), rad * 1.25)
            for dx, dy in ((-5, -6), (4, -8), (0, -3)):
                pygame.draw.circle(s, (229, 37, 33), (hx + dx * sc, hy + dy * sc), 2.4 * sc)
        elif cid in ("yoshi", "dk", "bowser"):
            pygame.draw.circle(s, hexc(ch["hair"] if cid != "yoshi" else "#46c14a"), (hx, hy - sc), rad * 1.1)
            if cid == "bowser":
                for sg in (-1, 1):
                    poly(s, [(hx + sg * 6 * sc, hy - 8 * sc), (hx + sg * 9 * sc, hy - 15 * sc), (hx + sg * 2 * sc, hy - 9 * sc)], (244, 241, 208))
        elif cid == "peach":
            pygame.draw.circle(s, hexc(ch["hair"]), (hx, hy), rad * 1.02)
            pygame.draw.rect(s, (242, 193, 78), (hx - 4 * sc, hy - 11 * sc, 8 * sc, 3 * sc))
        else:
            pygame.draw.circle(s, hexc(ch["cap"]), (hx, hy), rad * 1.04)
            pygame.draw.rect(s, hexc(ch["hair"]), (hx - rad * .9, hy + 2 * sc, rad * 1.8, 4 * sc))
    else:
        for dx in (-3, 3):
            pygame.draw.ellipse(s, (255, 255, 255), (hx + dx * sc - 2.2 * sc, hy - 4 * sc, 4.4 * sc, 6 * sc))
            pygame.draw.circle(s, (26, 26, 138), (hx + dx * sc, hy - .5 * sc), max(1, 1.1 * sc))
        if cid in ("mario", "luigi", "wario"):
            pygame.draw.circle(s, (224, 160, 112), (hx, hy + 2 * sc), 2.6 * sc)
            pygame.draw.rect(s, (75, 58, 42) if cid == "wario" else (58, 36, 16), (hx - 5 * sc, hy + 4 * sc, 10 * sc, 2 * sc))
            pygame.draw.circle(s, hexc(ch["cap"]), (hx, hy - 2 * sc), rad * 1.04)
            pygame.draw.rect(s, hexc(ch["cap"]), (hx - rad * 1.04, hy - 2.6 * sc, rad * 2.08, 2.4 * sc))
            pygame.draw.circle(s, (255, 255, 255), (hx, hy - 6.5 * sc), 2.6 * sc)
        elif cid == "peach":
            pygame.draw.circle(s, hexc(ch["hair"]), (hx, hy - 3 * sc), rad)
            pygame.draw.rect(s, (242, 193, 78), (hx - 4 * sc, hy - 11 * sc, 8 * sc, 3 * sc))
        elif cid == "yoshi":
            pygame.draw.ellipse(s, (245, 255, 240), (hx - 7 * sc, hy + sc, 14 * sc, 9 * sc))
        elif cid == "toad":
            pygame.draw.circle(s, (244, 244, 244), (hx, hy - 3 * sc), rad * 1.25)
            for dx, dy in ((-5, -8), (4, -9), (0, -6)):
                pygame.draw.circle(s, (229, 37, 33), (hx + dx * sc, hy + dy * sc), 2.4 * sc)
        else:
            pygame.draw.ellipse(s, (201, 154, 106) if cid == "dk" else (232, 180, 60), (hx - 6 * sc, hy - 2 * sc, 12 * sc, 10 * sc))
            pygame.draw.circle(s, hexc(ch["hair"]), (hx, hy - 4 * sc), rad * 1.1)
    for u, v in ((8, 8), (8, -8)):
        x, y = P(u, v, 17)
        pygame.draw.circle(s, hexc(torso), (x, y), 2.8 * sc)
        pygame.draw.circle(s, (245, 245, 245), (x, y + .5 * sc), 1.8 * sc)


ICON_COL = {"green": (60, 200, 60), "red": (232, 51, 47), "banana": (255, 224, 58), "fake": (255, 181, 43), "mush": (232, 51, 47),
            "gold": (245, 197, 24), "bomb": (34, 34, 34), "spiny": (42, 99, 224), "thunder": (255, 224, 58), "star": (255, 224, 58),
            "bullet": (34, 34, 34), "blooper": (244, 244, 244), "boo": (244, 244, 255)}
ICON_TXT = {"green": "G", "red": "R", "banana": "B", "fake": "?", "mush": "M", "gold": "M", "bomb": "B", "spiny": "S",
            "thunder": "Z", "star": "*", "bullet": "BB", "blooper": "b", "boo": "boo"}


def icon(s, typ, x, y, size, font):
    base = M.TRIPLE[typ][0] if typ in M.TRIPLE else typ
    tri = typ != base
    col = ICON_COL.get(base, (200, 200, 200))
    pts = [(-.22, .1), (.22, .1), (0, -.12)] if tri else [(0, 0)]
    for ox, oy in pts:
        r = size * (.24 if tri else .34)
        if base in ("fake",):
            pygame.draw.rect(s, col, (x + ox * size - r, y + oy * size - r, r * 2, r * 2))
        elif base in ("thunder", "star"):
            poly(s, [(x + ox * size + math.cos(-math.pi / 2 + i * math.pi / 5) * (r if i % 2 == 0 else r * .45),
                      y + oy * size + math.sin(-math.pi / 2 + i * math.pi / 5) * (r if i % 2 == 0 else r * .45)) for i in range(10)], col)
        else:
            pygame.draw.circle(s, col, (x + ox * size, y + oy * size), r)
        pygame.draw.circle(s, (17, 17, 17), (x + ox * size, y + oy * size), r, 1) if base not in ("fake",) else None
    if not tri and font:
        t = font.render(ICON_TXT.get(base, "?"), True, (255, 255, 255) if base in ("bomb", "bullet", "spiny", "red", "green", "mush") else (20, 20, 20))
        s.blit(t, (x - t.get_width() / 2, y - t.get_height() / 2))


# ------------------------------------------------------------------ game
class Game:
    def __init__(self, keyboard_focus=False):
        pygame.init()
        pygame.display.set_caption("Mario Kart (Muse 2 focus)")
        self.screen = pygame.display.set_mode((WIN_W, WIN_H))
        self.clock = pygame.time.Clock()
        self.view = pygame.Surface((W, H))
        self.keyboard_focus = keyboard_focus
        self.manual_focus = 50.0
        self.link = HeadbandLink()
        self.f_big = pygame.font.SysFont("segoeui,arial", 34)
        self.f_mid = pygame.font.SysFont("segoeui,arial", 20)
        self.f_small = pygame.font.SysFont("segoeui,arial", 14)
        self.f_hud = pygame.font.SysFont("segoeui,arial", 15, bold=True)
        self.f_hud_big = pygame.font.SysFont("segoeui,arial", 30, bold=True)
        self.f_icon = pygame.font.SysFont("arial", 7, bold=True)
        self.map_surf = None
        self.ground = None
        self.race = None
        self.cam_ang = 0.0
        self.msg, self.msg_t = "", 0.0
        self.steer = 0.0
        self.tap = set()

    # --- focus source
    def focus_state(self):
        if self.keyboard_focus:
            return "live", self.manual_focus, [99, 99, 99, 99]
        return self.link.read()

    def load_assets(self):
        self.screen.fill((2, 3, 15))
        t = self.f_mid.render("Building the track...", True, (200, 220, 255))
        self.screen.blit(t, (WIN_W // 2 - t.get_width() // 2, WIN_H // 2))
        pygame.display.flip()
        self.ground = Ground(build_texture())
        self.map_surf = self.build_map()

    def build_map(self):
        s = pygame.Surface((340, 255))
        s.fill((18, 32, 106))
        sx = 320 / 2700
        pts = [(170 + p.x * sx, 127 + p.y * sx) for p in M.TRACK.pts]
        for p in pts[::1]:
            pygame.draw.circle(s, (233, 233, 233), p, M.HALF * sx + 2)
        for p in pts[::1]:
            pygame.draw.circle(s, (141, 143, 154), p, M.HALF * sx)
        sp = M.TRACK.pts[M.TRACK.start]
        pygame.draw.rect(s, (255, 255, 255), (170 + sp.x * sx - 1, 127 + sp.y * sx - 8, 3, 16))
        self.map_sx = sx
        return s

    # --- waiting screen
    def wait_screen(self):
        while True:
            for e in pygame.event.get():
                if e.type == pygame.QUIT or (e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE):
                    return False
            state, focus, sens = self.focus_state()
            if state == "live":
                return True
            self.screen.fill((2, 3, 15))
            msg = {"off": "Waiting for the Muse 2 panel...", "waiting": "Panel linked. Press Auto Set Baselines in the panel."}[state]
            lines = [msg, "", "1. Open the Muse 2 panel and press Connect.",
                     "2. Press Auto Set Baselines and go from relaxed to concentrating for 10 seconds.",
                     "3. The race starts by itself once your focus score is live.", "", "Esc to quit"]
            y = 200
            for i, ln in enumerate(lines):
                t = (self.f_big if i == 0 else self.f_mid).render(ln, True, (233, 241, 255) if i == 0 else (159, 178, 230))
                self.screen.blit(t, (WIN_W // 2 - t.get_width() // 2, y))
                y += 56 if i == 0 else 34
            pygame.display.flip()
            self.clock.tick(30)

    # --- input
    def read_input(self):
        K = pygame.key.get_pressed()
        left, right = K[pygame.K_LEFT] or K[pygame.K_a], K[pygame.K_RIGHT] or K[pygame.K_d]
        target = int(bool(right)) - int(bool(left))
        rate, dt = (9 if target == 0 else 6.5), 1 / 60
        if abs(target - self.steer) < rate * dt:
            self.steer = float(target)
        else:
            self.steer += math.copysign(rate * dt, target - self.steer)
        back = bool(K[pygame.K_DOWN] or K[pygame.K_s])
        item = bool(K[pygame.K_SPACE] or K[pygame.K_x])
        return dict(steer=self.steer, accel=bool(K[pygame.K_UP] or K[pygame.K_w]), brake=back,
                    drift=bool(K[pygame.K_LSHIFT] or K[pygame.K_RSHIFT] or K[pygame.K_z]), item=item, back=back)

    def handle_events(self, race):
        for e in race.events:
            me = e["id"] == "mario"
            t = e["type"]
            if t == "go":
                self.say("GO!", 1.0)
            elif t == "lap" and me:
                self.say("FINAL LAP" if e["lap"] >= race.laps else "LAP %d" % (e["lap"] + 1), 1.6)
            elif t == "finish" and me:
                self.say("FINISH!", 3.0)
            elif t == "rocket" and me:
                self.say("ROCKET START!", 1.4)
            elif t == "burnout" and me:
                self.say("TOO EARLY", 1.2)
        race.events.clear()

    def say(self, m, t):
        self.msg, self.msg_t = m, t

    # --- rendering
    def render_world(self, race):
        P = race.player
        goal = P.h + P.drift * 0.16
        self.cam_ang += M.wrap(goal - self.cam_ang) * min(1, 7 / 60)
        ca = self.cam_ang
        fx, fy = math.cos(ca), math.sin(ca)
        rx, ry = -fy, fx
        camx, camy = P.x - fx * CAMD, P.y - fy * CAMD
        v = self.view
        for yy in range(HOR):
            f = yy / HOR
            v.fill((int(74 + 117 * f), int(160 + 67 * f), int(240 + 15 * f)), (0, yy, W, 1))
        self.draw_horizon(ca)
        floor = self.ground.render(camx, camy, ca)               # (rows, W, 3) indexed [y][x]
        pygame.surfarray.blit_array(self.floor_surf, floor.transpose(1, 0, 2))
        v.blit(self.floor_surf, (0, HOR))

        def proj(x, y):
            dx, dy = x - camx, y - camy
            cz, cx = dx * fx + dy * fy, dx * rx + dy * ry
            if cz > 6:
                return cz, W / 2 + F * cx / cz, HOR + F * CAMH / cz, F / cz
            return None
        items = []
        t = time.time()
        for b in race.boxes:
            if b.respawn <= 0:
                p = proj(b.x, b.y)
                if p:
                    items.append((p[0], lambda p=p: self.draw_box(p, t)))
        for c in race.coins:
            if not c.got:
                p = proj(c.x, c.y)
                if p:
                    items.append((p[0], lambda p=p: self.draw_coin(p, t)))
        for o in race.objs:
            p = proj(o.x, o.y)
            if p:
                items.append((p[0], lambda o=o, p=p: self.draw_obj(o, p)))
        for k in race.karts:
            p = proj(k.x, k.y)
            if p:
                items.append((p[0], lambda k=k, p=p: draw_kart(self.view, k, p[1], p[2], p[3], ca, t)))
        for e in race.fx:
            p = proj(e.x, e.y)
            if p:
                items.append((p[0] - 1, lambda e=e, p=p: self.draw_fx(e, p)))
        for _, fn in sorted(items, key=lambda i: -i[0]):
            fn()

    def draw_horizon(self, ang):
        v = self.view
        off = -ang * 260
        wrapx = lambda x, per: ((x % per) + per) % per
        for i in range(4):
            x = wrapx(off * .25 + i * 170, 680) - 120
            pygame.draw.ellipse(v, (232, 244, 255), (x - 34, 22 + (i % 2) * 14 - 9, 68, 18))
        for i in range(6):
            x = wrapx(off * .5 + i * 120, 720) - 120
            pygame.draw.ellipse(v, (106, 168, 106), (x - 64, HOR - 24 + 2, 128, 52 + (i % 3) * 10))
        for i in range(8):
            x = wrapx(off * .8 + i * 90, 720) - 100
            pygame.draw.ellipse(v, (63, 154, 63), (x - 46, HOR - 14 + 2, 92, 30 + (i % 3) * 6))
        for i in range(5):
            x = wrapx(off + i * 175, 880) - 150
            pygame.draw.rect(v, (47, 174, 63), (x, HOR - 15, 12, 15))
            pygame.draw.rect(v, (31, 138, 49), (x - 2, HOR - 18, 16, 5))
        for i in range(4):
            x = wrapx(off + 70 + i * 210, 840) - 150
            pygame.draw.rect(v, (232, 160, 58), (x, HOR - 12, 14, 12))
        pygame.draw.rect(v, (154, 122, 90), (0, HOR - 3, W, 3))
        pygame.draw.rect(v, (0, 0, 0), (0, HOR, W, 0))

    def draw_box(self, p, t):
        s = 17 * p[3]
        y = p[2] - 10 * p[3] - math.sin(t * 3) * 1.5 * p[3]
        h = (t * 120) % 360
        c = pygame.Color(0)
        c.hsva = (h, 90, 90, 100)
        pygame.draw.rect(self.view, c, (p[1] - s / 2, y - s / 2, s, s))
        pygame.draw.rect(self.view, (255, 255, 255), (p[1] - s / 2, y - s / 2, s, s), max(1, int(s * .12)))
        q = pygame.font.SysFont("arial", max(6, int(s * .8)), bold=True).render("?", True, (255, 255, 255)) if False else None

    def draw_coin(self, p, t):
        s = 8 * p[3]
        w = max(1, abs(math.cos(t * 4)) * s)
        pygame.draw.ellipse(self.view, (255, 210, 31), (p[1] - w * .6, p[2] - 6 * p[3] - s * .6, w * 1.2, s * 1.2))

    def draw_obj(self, o, p):
        s = 26 * p[3]
        pygame.draw.ellipse(self.view, (30, 30, 30), (p[1] - s * .35, p[2] - s * .06, s * .7, s * .12))
        icon(self.view, o.t, p[1], p[2] - s * .3, s, self.f_icon)

    def draw_fx(self, e, p):
        r = max(2, e.r * p[3] * (0.35 + e.t * 1.6))
        a = max(0.0, 1 - e.t / 0.6)
        surf = pygame.Surface((int(r * 2) + 2, int(r * 2) + 2), pygame.SRCALPHA)
        for k, col in ((1.0, (200, 40, 10)), (0.7, (255, 170, 40)), (0.35, (255, 250, 200))):
            pygame.draw.circle(surf, col + (int(220 * a),), (surf.get_width() // 2, surf.get_height() // 2), max(1, int(r * k)))
        self.view.blit(surf, (p[1] - surf.get_width() / 2, p[2] - r * .35 - surf.get_height() / 2))

    def ord(self, n):
        return "%d%s" % (n, "st" if n == 1 else "nd" if n == 2 else "rd" if n == 3 else "th")

    def fmt_t(self, s):
        if s is None:
            return "--"
        m = int(s // 60)
        r = s - m * 60
        return "%d'%s%.2f\"" % (m, "0" if r < 10 else "", r)

    def text_o(self, s, txt, x, y, font, col=(255, 255, 255), right=False, center=False):
        t = font.render(txt, True, col)
        o = font.render(txt, True, (0, 0, 0))
        w = t.get_width()
        x = x - w if right else x - w / 2 if center else x
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            s.blit(o, (x + dx, y + dy))
        s.blit(t, (x, y))

    def draw_view_hud(self, race):
        v, P = self.view, race.player
        pygame.draw.rect(v, (20, 20, 40), (5, 5, 34, 34), border_radius=6)
        pygame.draw.rect(v, (255, 255, 255), (5, 5, 34, 34), 1, border_radius=6)
        if P.roulette_t > 0:
            keys = list(M.ITEM_TABLE)
            icon(v, keys[int(time.time() * 14) % len(keys)], 22, 22, 26, self.f_icon)
        elif P.item:
            icon(v, P.item["type"], 22, 22, 28, self.f_icon)
            if P.item.get("n") is not None and P.item["type"] in M.TRIPLE:
                self.text_o(v, "x%d" % P.item["n"], 28, 28, self.f_icon)
        self.text_o(v, self.ord(P.place), W - 8, 2, self.f_hud_big, (255, 224, 58) if P.place == 1 else (255, 255, 255), right=True)
        self.text_o(v, "LAP %d/%d" % (min(race.laps, max(1, P.lap + 1)), race.laps), 46, 4, self.f_hud)
        self.text_o(v, self.fmt_t(max(0, race.t)), 46, 19, self.f_small, (207, 227, 255))
        pygame.draw.circle(v, (255, 210, 31), (54, 44), 4)
        self.text_o(v, "x%d" % P.coins, 62, 37, self.f_small)
        self.text_o(v, "SPEED x%.2f" % race.m, 6, H - 18, self.f_hud, (125, 255, 184) if race.m >= 1 else (255, 179, 179))
        sy = 56
        tags = []
        if P.star_t > 0:
            tags.append(("STAR %.1f" % P.star_t, (255, 224, 58)))
        if P.boost_t > 0:
            tags.append(("BOOST", (255, 176, 64)))
        if P.shrink_t > 0:
            tags.append(("SHRUNK", (153, 170, 221)))
        if P.ghost_t > 0:
            tags.append(("BOO", (221, 221, 255)))
        if P.bullet_t > 0:
            tags.append(("BULLET BILL", (255, 255, 255)))
        if P.drift:
            tags.append(("MINI-TURBO %d" % P.mt if P.mt else "DRIFT", [(255, 255, 255), (106, 215, 255), (255, 154, 42), (210, 123, 255)][P.mt]))
        for txt, col in tags:
            self.text_o(v, txt, 6, sy, self.f_small, col)
            sy += 13
        if P.ink_t > 0:
            ink = pygame.Surface((W, H), pygame.SRCALPHA)
            for i in range(9):
                pygame.draw.ellipse(ink, (250, 250, 250, int(min(.9, P.ink_t) * 255)), (14 + i * 30, 60 + (i * 53) % 90, 52, 40))
            v.blit(ink, (0, 0))
        if race.state == "countdown":
            n = math.ceil(-race.t)
            if 1 <= n <= 3:
                self.text_o(v, str(n), W // 2, 60, pygame.font.SysFont("arial", 60, bold=True), (255, 224, 58), center=True)
        if self.msg_t > 0:
            self.msg_t -= 1 / 60
            self.text_o(v, self.msg, W // 2, 70, self.f_hud_big, (255, 224, 58), center=True)
        if race.state == "results" and race.results:
            ov = pygame.Surface((W - 60, H - 36), pygame.SRCALPHA)
            ov.fill((0, 10, 50, 225))
            v.blit(ov, (30, 18))
            self.text_o(v, "RESULTS", W // 2, 22, self.f_hud_big, (255, 224, 58), center=True)
            for i, r in enumerate(race.results):
                y = 56 + i * 17
                if r["player"]:
                    pygame.draw.rect(v, (110, 100, 40), (40, y - 2, W - 80, 16))
                self.text_o(v, str(r["place"]), 50, y, self.f_small)
                self.text_o(v, r["name"], 70, y, self.f_small, (255, 224, 58) if r["player"] else (255, 255, 255))
                self.text_o(v, self.fmt_t(r["time"]), 190, y, self.f_small)
                self.text_o(v, "%d pts" % r["points"], 278, y, self.f_small, (154, 220, 255), right=True)
            self.text_o(v, "ENTER: play again   ESC: quit", W // 2, H - 34, self.f_small, (207, 227, 255), center=True)

    def draw_screen(self, race, state, focus, sens):
        S = self.screen
        S.fill((2, 3, 15))
        pygame.draw.rect(S, (4, 16, 80), (20, 12, WIN_W - 40, 60), border_radius=8)
        pygame.draw.rect(S, (60, 100, 200), (20, 12, WIN_W - 40, 60), 1, border_radius=8)
        S.blit(self.f_small.render("MARIO KART · FIGURE-8 CIRCUIT", True, (183, 166, 255)), (40, 16))
        for i, n in enumerate(("TP9", "AF7", "AF8", "TP10")):
            x = 40 + i * 64
            v = sens[i]
            col = (120, 130, 170) if v is None else (55, 255, 182) if v >= 70 else (255, 209, 102) if v >= 40 else (255, 92, 122)
            pygame.draw.polygon(S, col, [(x + 20, 36), (x + 26, 42), (x + 20, 48), (x + 14, 42)], 0 if v is not None else 2)
            lab = self.f_small.render(("--" if v is None else "%d%%" % v) + " " + n, True, (220, 230, 255))
            S.blit(lab, (x + 20 - lab.get_width() / 2, 50))
        S.blit(self.f_small.render("FOCUS", True, (183, 166, 255)), (330, 16))
        S.blit(self.f_big.render("--" if focus is None else str(round(focus)), True, (255, 255, 255)), (330, 30))
        pygame.draw.rect(S, (60, 100, 200), (400, 44, 200, 10), 1)
        pygame.draw.rect(S, (53, 230, 255), (401, 45, 198 * (focus or 0) / 100, 8))
        S.blit(self.f_small.render("SPEED MULTIPLIER", True, (183, 166, 255)), (660, 16))
        S.blit(self.f_big.render("x%.2f" % race.m, True, (255, 255, 255)), (660, 30))
        S.blit(self.f_small.render("0 focus = 0.5x   50 = 1x   100 = 1.5x", True, (159, 178, 230)), (790, 44))
        link = "Keyboard focus" if self.keyboard_focus else {"live": "Muse live", "waiting": "Muse: set baselines", "off": "Muse: no signal"}[state]
        S.blit(self.f_small.render("LINK " + link, True, (159, 178, 230)), (1000, 16))
        S.blit(pygame.transform.scale(self.view, (VIEW[2], VIEW[3])), VIEW[:2])
        pygame.draw.rect(S, (74, 168, 255), (VIEW[0] - 2, VIEW[1] - 2, VIEW[2] + 4, VIEW[3] + 4), 2)
        # minimap
        mp = self.map_surf.copy()
        sx = self.map_sx
        for k in sorted(race.karts, key=lambda q: q.is_player):
            x, y = 170 + k.x * sx, 127 + k.y * sx
            pygame.draw.circle(mp, (0, 0, 0), (x, y), 7 if k.is_player else 6)
            c = k.c["cap"]
            pygame.draw.circle(mp, (79, 123, 224) if c == "#f4f4f4" else hexc(c), (x, y), 5 if k.is_player else 4)
            if k.is_player:
                pygame.draw.line(mp, (255, 255, 255), (x, y), (x + math.cos(k.h) * 10, y + math.sin(k.h) * 10), 2)
        for i, k in enumerate(sorted(race.karts, key=lambda q: q.place)):
            mp.blit(self.f_small.render("%d %s" % (i + 1, k.c["name"]), True, (255, 224, 58) if k.is_player else (207, 227, 255)),
                    (6 + (i >> 2) * 130, 4 + (i & 3) * 15))
        S.blit(mp, (840, 84))
        helps = ["Arrows / WASD   steer + accelerate (down brakes)", "Shift            hold to drift, release for mini-turbo",
                 "Space            use item (hold down + Space throws behind)", "Esc              quit"]
        if self.keyboard_focus:
            helps.append("[ and ]          lower / raise focus (practice mode)")
        for i, h in enumerate(helps):
            S.blit(self.f_small.render(h, True, (207, 220, 255)), (840, 360 + i * 22))
        warn = "" if focus is not None or self.keyboard_focus else "No live focus reading: holding the last speed multiplier."
        if warn:
            S.blit(self.f_mid.render(warn, True, (255, 157, 176)), (20, WIN_H - 40))
        else:
            S.blit(self.f_small.render("Your top speed and acceleration follow your focus. Boosts keep their own strength.", True, (159, 178, 230)), (20, WIN_H - 36))

    # --- main loop
    def play(self):
        if self.ground is None:
            self.load_assets()
            self.floor_surf = pygame.Surface((W, H - HOR))
        self.race = M.Race(seed=int(time.time()) & 0xFFFF)
        self.cam_ang = self.race.player.h
        self.msg_t = 0.0
        self.steer = 0.0
        race = self.race
        state, focus, sens = self.focus_state()
        race.set_focus(focus if focus is not None else 50, True)
        acc = 0.0
        last = time.perf_counter()
        while True:
            for e in pygame.event.get():
                if e.type == pygame.QUIT:
                    return False
                if e.type == pygame.KEYDOWN:
                    if e.key == pygame.K_ESCAPE:
                        return False
                    if e.key == pygame.K_RETURN and race.state == "results":
                        return True
                    if self.keyboard_focus and e.key == pygame.K_LEFTBRACKET:
                        self.manual_focus = max(0, self.manual_focus - 10)
                    if self.keyboard_focus and e.key == pygame.K_RIGHTBRACKET:
                        self.manual_focus = min(100, self.manual_focus + 10)
            now = time.perf_counter()
            acc += min(0.1, now - last)
            last = now
            state, focus, sens = self.focus_state()
            if focus is not None:
                race.set_focus(focus)
            n = 0
            while acc >= M.DT and n < 6:
                if race.state != "results":
                    race.step(self.read_input())
                self.handle_events(race)
                acc -= M.DT
                n += 1
            if acc > 0.2:
                acc = 0.0
            self.render_world(race)
            self.draw_view_hud(race)
            self.draw_screen(race, state, focus, sens)
            pygame.display.flip()
            self.clock.tick(60)


def main():
    g = Game(keyboard_focus="--keyboard-focus" in sys.argv)
    g.load_assets()
    g.floor_surf = pygame.Surface((W, H - HOR))
    while True:
        if not g.wait_screen():
            break
        if not g.play():
            break
    pygame.quit()


if __name__ == "__main__":
    main()
