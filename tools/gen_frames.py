#!/usr/bin/env python3
"""Generate the System Patrol mascot frames.

The mascot is a small skeletal rig -- hip, shoulder, head, four two-segment
legs and a tail -- posed per frame and rasterised straight onto a 36x24 pixel
grid with no anti-aliasing, then upscaled with nearest-neighbour. Posing a rig
rather than hand-drawing each frame is what makes a twelve-frame gallop
practical, and keeping the generator in the repository means the animation can
always be retuned and rebuilt.

Usage:  python3 tools/gen_frames.py [--preview DIR]
Writes: assets/frames/<mascot>/<mood>/frame-<nn>.png
        with --preview, also one looping GIF per mascot and mood into DIR
"""

import math
import os
import shutil
import sys

from PIL import Image

GRID_W, GRID_H = 36, 24
# The HUD shows the mascot at exactly 3x the grid, and 6x covers HiDPI, so
# every art pixel always lands on a whole number of screen pixels.
SCALE = 6
FRAME_COUNT = 12
GROUND = 22
MOODS = ["run", "walk", "sleep"]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT = os.path.join(ROOT, "assets", "frames")

NONE = (0, 0, 0, 0)
WHITE = (250, 251, 253, 255)
PUPIL = (36, 40, 48, 255)
PINK = (236, 150, 160, 255)

MASCOTS = {
    # Orange tabby: ginger coat, darker ginger stripes, cream belly and paws.
    "cat": {
        "body": (236, 152, 72, 255),
        "dark": (186, 100, 38, 255),
        "light": (252, 228, 192, 255),
        "tail_size": 2,
        "tail_rings": False,
        "mask": False,
        "stripes": True,
    },
    # Warm grey-brown with cream markings. The raccoon has its own frame
    # builders further down: a different animal, not a recoloured cat.
    "raccoon": {
        "body": (156, 150, 146, 255),
        "dark": (78, 74, 78, 255),
        "light": (228, 224, 216, 255),
        "stripes": False,
    },
}


class Canvas:
    def __init__(self):
        self.img = Image.new("RGBA", (GRID_W, GRID_H), NONE)
        self.px = self.img.load()

    def dot(self, x, y, color, size=1):
        for dy in range(size):
            for dx in range(size):
                tx, ty = int(x) + dx, int(y) + dy
                if 0 <= tx < GRID_W and 0 <= ty < GRID_H:
                    self.px[tx, ty] = color

    def line(self, p0, p1, color, size=2):
        """A run of size x size blocks; keeps limbs an even thickness."""
        steps = max(1, int(round(max(abs(p1[0] - p0[0]), abs(p1[1] - p0[1])))))
        for k in range(steps + 1):
            t = k / steps
            self.dot(round(p0[0] + (p1[0] - p0[0]) * t),
                     round(p0[1] + (p1[1] - p0[1]) * t), color, size)

    def ellipse(self, cx, cy, rx, ry, color):
        for y in range(GRID_H):
            for x in range(GRID_W):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0:
                    self.px[x, y] = color

    def capsule(self, a, b, ra, rb, color):
        """Torso: every pixel within a tapering radius of the spine a-b."""
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy or 1
        for y in range(GRID_H):
            for x in range(GRID_W):
                t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length2))
                cx, cy = ax + dx * t, ay + dy * t
                if math.hypot(x - cx, y - cy) <= ra + (rb - ra) * t:
                    self.px[x, y] = color


def polar(origin, angle_deg, length):
    """Angle is measured from straight down, positive toward the head."""
    a = math.radians(angle_deg)
    return (origin[0] + math.sin(a) * length, origin[1] + math.cos(a) * length)


def draw_leg(c, hip, thigh, shin, color, paw, thigh_len=3.4, shin_len=3.6):
    knee = polar(hip, thigh, thigh_len)
    foot = polar(knee, shin, shin_len)
    # Never let a foot sink below the ground line.
    foot = (foot[0], min(foot[1], GROUND - 1))
    c.line(hip, knee, color)
    c.line(knee, foot, color)
    c.dot(round(foot[0]), round(foot[1]), paw, 2)


def draw_tail(c, base, mid, tip, spec, color=None):
    size = 2
    base_color = color or spec["body"]
    points = []
    for k in range(13):
        t = k / 12
        x = (1 - t) ** 2 * base[0] + 2 * (1 - t) * t * mid[0] + t * t * tip[0]
        y = (1 - t) ** 2 * base[1] + 2 * (1 - t) * t * mid[1] + t * t * tip[1]
        points.append((round(x), round(y)))
    for k, (x, y) in enumerate(points):
        c.dot(x - (size - 2), y, base_color, size)


def draw_head(c, centre, spec, eye_open=True):
    hx, hy = centre
    c.ellipse(hx, hy, 4.4, 3.9, spec["body"])
    # Ears: two small triangles, pink inside.
    for ex in (-3, 2):
        c.dot(hx + ex, hy - 6, spec["body"])
        c.dot(hx + ex, hy - 5, spec["body"], 1)
        c.dot(hx + ex + 1, hy - 5, spec["body"])
        c.dot(hx + ex - 1, hy - 4, spec["body"])
        c.dot(hx + ex, hy - 4, PINK)
        c.dot(hx + ex + 1, hy - 4, spec["body"])
    # Muzzle and nose.
    c.dot(hx + 3, hy + 1, spec["light"], 2)
    c.dot(hx + 4, hy + 1, PINK)
    if eye_open:
        c.dot(hx + 1, hy - 1, WHITE)
        c.dot(hx + 1, hy, WHITE)
        c.dot(hx + 2, hy - 1, PUPIL)
        c.dot(hx + 2, hy, PUPIL)
    else:
        c.dot(hx + 1, hy, PUPIL)
        c.dot(hx + 2, hy, PUPIL)


def draw_body(c, hip, shoulder, spec, hip_r=4.0, shoulder_r=4.3):
    c.capsule(hip, shoulder, hip_r, shoulder_r, spec["body"])
    # Pale belly: the lowest two rows of the torso, following its slope, so
    # it hugs the underside instead of floating as a bar across the flank.
    span = max(1, shoulder[0] - hip[0])
    for x in range(int(hip[0]) - 2, int(shoulder[0]) + 3):
        t = max(0.0, min(1.0, (x - hip[0]) / span))
        spine = hip[1] + (shoulder[1] - hip[1]) * t
        for y in range(int(round(spine)) + 3, GRID_H):
            if 0 <= x < GRID_W and c.px[x, y][3]:
                c.px[x, y] = spec["light"]
    if spec["stripes"]:
        for k in range(3):
            sx = int(round(hip[0] + 2 + k * 3))
            top = int(round(hip[1] + (shoulder[1] - hip[1]) * (k / 3))) - 4
            for sy in range(top, top + 3):
                if 0 <= sx < GRID_W and 0 <= sy < GRID_H and c.px[sx, sy][3]:
                    c.px[sx, sy] = spec["dark"]


def run_frame(spec, i):
    """Gallop: hind and fore pairs swing in opposition, the spine stretches
    in flight and bunches as the legs gather underneath."""
    th = 2 * math.pi * i / FRAME_COUNT
    ext = -math.sin(th)                       # +1 stretched out, -1 gathered
    lift = round(max(0.0, ext) * 1.6)         # airborne while stretched
    rock = round(0.9 * math.cos(th))

    hip = (11 - round(1.3 * ext), 13 - lift + rock)
    shoulder = (21 + round(1.3 * ext), 13 - lift - rock)
    c = Canvas()

    def legs(phase, color, paw):
        e = -math.sin(th - phase)
        fold = (1 - e) / 2
        hind_thigh = -55 * e
        fore_thigh = 55 * e
        draw_leg(c, (hip[0] - 1, hip[1] + 2), hind_thigh,
                 hind_thigh - 5 - 40 * fold, color, paw)
        draw_leg(c, (shoulder[0] + 1, shoulder[1] + 2), fore_thigh,
                 fore_thigh + 10 - 65 * fold, color, paw)

    legs(0.7, spec["dark"], spec["dark"])     # far pair, slightly behind
    wag = math.sin(th + 1.0)
    tail_base = (hip[0] - 3, hip[1] - 2)
    draw_tail(c, tail_base,
              (tail_base[0] - 5, tail_base[1] - 1 + 1.5 * wag),
              (tail_base[0] - 8, tail_base[1] - 4 - 2.5 * ext), spec)
    draw_body(c, hip, shoulder, spec)
    legs(0.0, spec["body"], spec["light"])
    draw_head(c, (shoulder[0] + 5, shoulder[1] - 4 + round(0.6 * ext)), spec)
    return c.img


def walk_frame(spec, i):
    """Four-beat walk: each leg a quarter cycle behind the last, level back."""
    th = 2 * math.pi * i / FRAME_COUNT
    bob = 1 if math.sin(2 * th) > 0.6 else 0
    hip = (11, 13 + bob)
    shoulder = (21, 13 + bob)
    c = Canvas()

    def leg(origin, phase, color, paw):
        swing = 24 * math.sin(th + phase)
        raise_ = 38 * max(0.0, math.cos(th + phase))
        draw_leg(c, origin, swing, swing - raise_, color, paw)

    hind = (hip[0] - 1, hip[1] + 2)
    fore = (shoulder[0] + 1, shoulder[1] + 2)
    leg(hind, math.pi, spec["dark"], spec["dark"])
    leg(fore, 1.5 * math.pi, spec["dark"], spec["dark"])

    sway = math.sin(th)
    tail_base = (hip[0] - 3, hip[1] - 2)
    draw_tail(c, tail_base,
              (tail_base[0] - 4, tail_base[1] - 3),
              (tail_base[0] - 4 + 1.5 * sway, tail_base[1] - 8), spec)
    draw_body(c, hip, shoulder, spec)
    leg(hind, 0.0, spec["body"], spec["light"])
    leg(fore, 0.5 * math.pi, spec["body"], spec["light"])
    draw_head(c, (shoulder[0] + 5, shoulder[1] - 4 + (1 - bob if i % 6 == 0 else 0)), spec)
    return c.img


def sleep_frame(spec, i):
    """Curled up: the flank rises and falls, and an ear flicks once a loop."""
    th = 2 * math.pi * i / FRAME_COUNT
    breath = (1 - math.cos(th)) / 2           # 0 exhaled .. 1 inhaled
    c = Canvas()
    top = 0.9 * breath
    c.ellipse(15, 17.3 - top, 10.5, 4.7 + top, spec["body"])
    if spec["stripes"]:
        for sx in (9, 13, 17):
            for sy in range(12, 16):
                if c.px[sx, sy][3]:
                    c.px[sx, sy] = spec["dark"]
    # Haunch: a darker arc suggesting the folded hind leg.
    for hx, hy in ((8, 19), (9, 18), (10, 18), (11, 18), (12, 19), (12, 20)):
        c.dot(hx, hy, spec["dark"])
    # A one-pixel shadow behind the head keeps it from melting into the flank.
    c.ellipse(24, 18, 4.6, 4.1, spec["dark"])
    draw_head(c, (25, 18), spec, eye_open=False)
    # Tail wrapped along the ground and up toward the chin, in the dark tone:
    # drawn in body colour it is invisible against the body it lies on.
    draw_tail(c, (4, 19), (7, 22), (20, 21), spec, color=spec["dark"])
    c.dot(21, 20, spec["light"], 2)           # front paw tucked under the chin
    if i in (4, 5):                           # ear flick
        c.dot(22, 11, spec["body"])
    return c.img


# --- raccoon ---------------------------------------------------------------
#
# Built from the same primitives as the cat but with its own anatomy: a heavy
# rump carried higher than the shoulders, short legs, a low-slung head with a
# pointed snout and bandit mask, and a thick banded tail held out behind
# rather than up.

RACCOON_HIP_R = 4.9
RACCOON_SHOULDER_R = 4.2
RACCOON_THIGH = 2.6
RACCOON_SHIN = 3.0


RACCOON_BAND = 2.2


def draw_raccoon_tail(c, base, mid, tip, spec, base_color=None, bushy=True):
    """Bushy and banded, ending on a dark tip.

    Bands are measured along the curve from the tip, not by sample index, so
    they stay the same width however long or bent the tail is in a pose --
    indexed bands squeezed down to an unreadable dark block on short tails.
    """
    body = base_color or spec["body"]
    samples = 48
    points = []
    for k in range(samples):
        t = k / (samples - 1)
        x = (1 - t) ** 2 * base[0] + 2 * (1 - t) * t * mid[0] + t * t * tip[0]
        y = (1 - t) ** 2 * base[1] + 2 * (1 - t) * t * mid[1] + t * t * tip[1]
        points.append((x, y))
    arc = [0.0]
    for a, b in zip(points, points[1:]):
        arc.append(arc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total = arc[-1]
    # Each pixel takes the band of the nearest point on the curve. Stamping
    # blocks in order instead lets every stamp paint over its neighbours, and
    # a brush wider than a band wipes the bands out.
    nearest = {}
    for (x, y), d in zip(points, arc):
        t = d / total if total else 0
        size = 4 if bushy and 0.2 < t < 0.85 else 3
        dark = int((total - d) / RACCOON_BAND) % 2 == 0
        ox, oy = round(x) - size // 2, round(y) - size // 2
        for dy in range(size):
            for dx in range(size):
                key = (ox + dx, oy + dy)
                dist = math.hypot(key[0] - x, key[1] - y)
                if key not in nearest or dist < nearest[key][0]:
                    nearest[key] = (dist, dark)
    for (px, py), (_, dark) in nearest.items():
        c.dot(px, py, spec["dark"] if dark else body)


def draw_raccoon_head(c, centre, spec, eye_open=True):
    hx, hy = centre
    # Small rounded ears, solid, with a pale inner pixel. Drawn first so the
    # skull overlaps them. A pale rim round a dark centre read as hollow loops
    # against the dark HUD.
    for ex in (-3, 1):
        c.dot(hx + ex, hy - 5, spec["body"])
        c.dot(hx + ex + 1, hy - 5, spec["body"])
        c.dot(hx + ex - 1, hy - 4, spec["body"])
        c.dot(hx + ex, hy - 4, spec["light"])
        c.dot(hx + ex + 1, hy - 4, spec["body"])
        c.dot(hx + ex + 2, hy - 4, spec["body"])
    c.ellipse(hx, hy, 4.4, 3.9, spec["body"])
    # Pale brow over the mask, pale muzzle under it.
    for x in range(0, 4):
        c.dot(hx + x, hy - 2, spec["light"])
    for x in range(1, 5):
        c.dot(hx + x, hy + 1, spec["light"])
        c.dot(hx + x, hy + 2, spec["light"])
    # The mask itself.
    for x in range(-1, 4):
        c.dot(hx + x, hy - 1, spec["dark"])
        c.dot(hx + x, hy, spec["dark"])
    # Snout pokes out past the skull, nose on the end.
    c.dot(hx + 4, hy, spec["light"])
    c.dot(hx + 5, hy, spec["light"])
    c.dot(hx + 5, hy + 1, PUPIL)
    if eye_open:
        c.dot(hx + 2, hy - 1, WHITE)
    else:
        c.dot(hx + 1, hy, spec["body"])
        c.dot(hx + 2, hy, spec["body"])


def raccoon_leg(c, origin, thigh, shin, color, spec):
    draw_leg(c, origin, thigh, shin, color, spec["dark"], RACCOON_THIGH, RACCOON_SHIN)


def raccoon_run_frame(spec, i):
    """A bounding lope: shorter reach than the cat's gallop, more rock, and
    the tail streaming level behind."""
    th = 2 * math.pi * i / FRAME_COUNT
    ext = -math.sin(th)
    lift = round(max(0.0, ext) * 1.3)
    rock = round(1.0 * math.cos(th))

    hip = (14 - round(1.0 * ext), 13 - lift + rock)
    shoulder = (22 + round(1.0 * ext), 14 - lift - rock)
    c = Canvas()

    def legs(phase, color):
        e = -math.sin(th - phase)
        fold = (1 - e) / 2
        hind_thigh = -46 * e
        fore_thigh = 46 * e
        raccoon_leg(c, (hip[0] - 1, hip[1] + 3), hind_thigh,
                    hind_thigh - 5 - 40 * fold, color, spec)
        raccoon_leg(c, (shoulder[0] + 1, shoulder[1] + 2), fore_thigh,
                    fore_thigh + 10 - 60 * fold, color, spec)

    legs(0.7, spec["dark"])
    wag = math.sin(th + 1.0)
    tail_base = (hip[0] - 4, hip[1] - 1)
    draw_raccoon_tail(c, tail_base,
                      (tail_base[0] - 4, tail_base[1] - 1 + 1.5 * wag),
                      (tail_base[0] - 8, tail_base[1] + 1 - 2.0 * ext), spec)
    draw_body(c, hip, shoulder, spec, RACCOON_HIP_R, RACCOON_SHOULDER_R)
    legs(0.0, spec["body"])
    draw_raccoon_head(c, (shoulder[0] + 5, shoulder[1] - 2 + round(0.6 * ext)), spec)
    return c.img


def raccoon_walk_frame(spec, i):
    """A waddle: hips and shoulders bob out of step, head low, tail trailing."""
    th = 2 * math.pi * i / FRAME_COUNT
    hip_bob = 1 if math.sin(2 * th) > 0.5 else 0
    shoulder_bob = 1 if math.sin(2 * th + math.pi) > 0.5 else 0
    hip = (14, 13 + hip_bob)
    shoulder = (22, 14 + shoulder_bob)
    c = Canvas()

    def leg(origin, phase, color):
        swing = 20 * math.sin(th + phase)
        raise_ = 34 * max(0.0, math.cos(th + phase))
        raccoon_leg(c, origin, swing, swing - raise_, color, spec)

    hind = (hip[0] - 1, hip[1] + 3)
    fore = (shoulder[0] + 1, shoulder[1] + 2)
    leg(hind, math.pi, spec["dark"])
    leg(fore, 1.5 * math.pi, spec["dark"])

    sway = math.sin(th)
    tail_base = (hip[0] - 4, hip[1])
    draw_raccoon_tail(c, tail_base,
                      (tail_base[0] - 4, tail_base[1] + 1),
                      (tail_base[0] - 8, tail_base[1] + 3 + 1.2 * sway), spec)
    draw_body(c, hip, shoulder, spec, RACCOON_HIP_R, RACCOON_SHOULDER_R)
    leg(hind, 0.0, spec["body"])
    leg(fore, 0.5 * math.pi, spec["body"])
    draw_raccoon_head(c, (shoulder[0] + 5, shoulder[1] - 2), spec)
    return c.img


def raccoon_sleep_frame(spec, i):
    """Curled up with the banded tail wrapped round the front; the tail tip
    twitches once a loop."""
    th = 2 * math.pi * i / FRAME_COUNT
    breath = (1 - math.cos(th)) / 2
    c = Canvas()
    top = 0.9 * breath
    c.ellipse(15, 17.0 - top, 10.5, 5.2 + top, spec["body"])
    for hx, hy in ((8, 18), (9, 17), (10, 17), (11, 17), (12, 18), (12, 19)):
        c.dot(hx, hy, spec["dark"])
    c.ellipse(24, 18, 4.6, 4.1, spec["dark"])
    draw_raccoon_head(c, (25, 18), spec, eye_open=False)
    twitch = 1 if i in (4, 5) else 0
    # Pale between the bands here: body-coloured bands would vanish against
    # the body the tail is lying on.
    draw_raccoon_tail(c, (4, 18), (7, 22), (20, 21 - twitch), spec,
                      base_color=spec["light"], bushy=False)
    return c.img


BUILDERS = {
    "cat": {"run": run_frame, "walk": walk_frame, "sleep": sleep_frame},
    "raccoon": {
        "run": raccoon_run_frame,
        "walk": raccoon_walk_frame,
        "sleep": raccoon_sleep_frame,
    },
}


def upscale(img, scale):
    return img.resize((GRID_W * scale, GRID_H * scale), Image.NEAREST)


def main():
    preview_dir = None
    if "--preview" in sys.argv:
        preview_dir = sys.argv[sys.argv.index("--preview") + 1]
        os.makedirs(preview_dir, exist_ok=True)

    # Rebuild from scratch so a renamed mood never leaves stale frames behind.
    shutil.rmtree(OUT_ROOT, ignore_errors=True)

    written = 0
    for mascot, spec in MASCOTS.items():
        for mood in MOODS:
            frames = [BUILDERS[mascot][mood](spec, i) for i in range(FRAME_COUNT)]
            out_dir = os.path.join(OUT_ROOT, mascot, mood)
            os.makedirs(out_dir, exist_ok=True)
            for i, frame in enumerate(frames):
                upscale(frame, SCALE).save(os.path.join(out_dir, f"frame-{i:02d}.png"))
                written += 1

            if preview_dir:
                duration = {"run": 60, "walk": 100, "sleep": 260}[mood]
                big = []
                for frame in frames:
                    bg = Image.new("RGBA", (GRID_W * 8, GRID_H * 8), (24, 27, 31, 255))
                    bg.alpha_composite(upscale(frame, 8))
                    big.append(bg.convert("P", palette=Image.ADAPTIVE))
                big[0].save(os.path.join(preview_dir, f"{mascot}-{mood}.gif"),
                            save_all=True, append_images=big[1:],
                            duration=duration, loop=0)

    print(f"wrote {written} frames for {len(MASCOTS)} mascots to {OUT_ROOT}")


if __name__ == "__main__":
    main()
