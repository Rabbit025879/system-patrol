#!/usr/bin/env python3
"""Generate the Cat HUD mascot frames.

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
    # Grey-blue tabby. Mid-tones throughout so it reads on the dark HUD.
    "cat": {
        "body": (138, 152, 170, 255),
        "dark": (88, 99, 116, 255),
        "light": (196, 205, 217, 255),
        "tail_size": 2,
        "tail_rings": False,
        "mask": False,
        "stripes": True,
    },
    # Same rig with a raccoon's markings: bandit mask, banded bushy tail,
    # dark paws. Marking tone stays mid-grey -- true raccoon-black vanishes
    # against a dark background.
    "raccoon": {
        "body": (178, 186, 196, 255),
        "dark": (92, 101, 114, 255),
        "light": (222, 227, 233, 255),
        "tail_size": 3,
        "tail_rings": True,
        "mask": True,
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


def draw_leg(c, hip, thigh, shin, color, paw):
    knee = polar(hip, thigh, 3.4)
    foot = polar(knee, shin, 3.6)
    # Never let a foot sink below the ground line.
    foot = (foot[0], min(foot[1], GROUND - 1))
    c.line(hip, knee, color)
    c.line(knee, foot, color)
    c.dot(round(foot[0]), round(foot[1]), paw, 2)


def draw_tail(c, base, mid, tip, spec, color=None):
    size = spec["tail_size"]
    base_color = color or spec["body"]
    points = []
    for k in range(13):
        t = k / 12
        x = (1 - t) ** 2 * base[0] + 2 * (1 - t) * t * mid[0] + t * t * tip[0]
        y = (1 - t) ** 2 * base[1] + 2 * (1 - t) * t * mid[1] + t * t * tip[1]
        points.append((round(x), round(y)))
    for k, (x, y) in enumerate(points):
        ringed = spec["tail_rings"] and (k // 2) % 2 == 1
        c.dot(x - (size - 2), y, spec["dark"] if ringed else base_color, size)


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
    if spec["mask"]:
        for mx in range(0, 4):
            c.dot(hx + mx, hy - 1, spec["dark"])
            c.dot(hx + mx, hy, spec["dark"])
    if eye_open:
        c.dot(hx + 1, hy - 1, WHITE)
        c.dot(hx + 1, hy, WHITE)
        c.dot(hx + 2, hy - 1, PUPIL)
        c.dot(hx + 2, hy, PUPIL)
    else:
        c.dot(hx + 1, hy, PUPIL)
        c.dot(hx + 2, hy, PUPIL)


def draw_body(c, hip, shoulder, spec):
    c.capsule(hip, shoulder, 4.0, 4.3, spec["body"])
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
    legs(0.0, spec["body"], spec["dark"] if spec["mask"] else spec["light"])
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
    paw = spec["dark"] if spec["mask"] else spec["light"]
    leg(hind, 0.0, spec["body"], paw)
    leg(fore, 0.5 * math.pi, spec["body"], paw)
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


BUILDERS = {"run": run_frame, "walk": walk_frame, "sleep": sleep_frame}


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
            frames = [BUILDERS[mood](spec, i) for i in range(FRAME_COUNT)]
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
