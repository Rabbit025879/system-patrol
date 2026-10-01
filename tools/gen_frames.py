#!/usr/bin/env python3
"""Generate the Cat HUD panel sprite frames.

The cat is authored as ASCII art on a 16x16 logical grid and upscaled with
nearest-neighbour so it stays crisp pixel art at every size. Keeping the art in
this script (rather than only as PNGs) means the sprite can always be retouched
and regenerated -- the previous extension's generator was lost because it was
never committed.

Usage:  python3 tools/gen_frames.py
Writes: cat-assets/frames/<mood>/<size>/cat-<nn>.png
"""

import math
import os

from PIL import Image

GRID = 16
FRAME_COUNT = 12
SIZES = [16, 24, 32, 64, 128]
MOODS = ["run", "sleep"]

OUT_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "cat-assets", "frames")

# Grey-blue tabby. Deliberately not clawd's clay-orange, so the two extensions
# stay tellable apart in the top bar. Mid-tone reads on light and dark panels.
BODY = (125, 138, 153, 255)
DARK = (82, 92, 105, 255)      # ear insides, stripes, paws
EYE = (248, 250, 252, 255)
NONE = (0, 0, 0, 0)

PALETTE = {".": NONE, "#": BODY, "o": DARK, "E": EYE}

# Body, head and tail. Legs are drawn separately per frame (rows 12-14), and
# row 0-1 stay clear so the vertical bob never clips at the top.
BODY_ART = [
    "................",
    "................",
    "...........o...o",
    "...........##.##",
    "..........######",
    "..........##E###",
    ".o........######",
    ".oo.....########",
    "..o..###########",
    "..#####o##o#####",
    "..##############",
    "..##############",
]

# A four-pose walk cycle. Each entry is rows 12-14 of the grid; the 12 frames
# step through these so the gait reads clearly at 16px, while the body bob
# below gives all 12 frames their own silhouette.
LEGS = [
    [
        "..##...##.......",
        "...#....#.......",
        "...o....o.......",
    ],
    [
        "..##....##......",
        "..#......#......",
        "..o......o......",
    ],
    [
        "...##..##.......",
        "...#...#........",
        "...o...o........",
    ],
    [
        "..##...##.......",
        "..#.....#.......",
        "..o.....o.......",
    ],
]

# Curled up asleep. The head sits to the right with its ears and a shut-eye
# dash, and the tail wraps around the front in the dark tone so it separates
# from the body -- without those cues a curled cat just reads as a blob.
SLEEP_ART = [
    "................",
    "................",
    "................",
    "................",
    "..........o...o.",
    "..........##.##.",
    ".........#######",
    "......##########",
    "....######oo####",
    "...#############",
    "..##o##o########",
    "..##############",
    "..#ooooo########",
    "...ooooo#######.",
    "................",
    "................",
]


def blank():
    return Image.new("RGBA", (GRID, GRID), NONE)


def stamp(img, art, x_off=0, y_off=0):
    """Paint ASCII art onto the grid at the given offset."""
    px = img.load()
    for y, row in enumerate(art):
        ty = y + y_off
        if not 0 <= ty < GRID:
            continue
        for x, ch in enumerate(row):
            tx = x + x_off
            if not 0 <= tx < GRID:
                continue
            color = PALETTE.get(ch, NONE)
            if color[3]:
                px[tx, ty] = color


def run_frame(i):
    """Walking cat: legs cycle every 4 frames, body bobs once per 12."""
    img = blank()
    # One full bob per loop. Integer offset keeps it on the pixel grid.
    bob = 1 if math.sin(i / FRAME_COUNT * 2 * math.pi) > 0.5 else 0
    stamp(img, BODY_ART, 0, bob)
    stamp(img, LEGS[i % len(LEGS)], 0, 12 + bob)
    return img


def sleep_frame(i):
    """Curled cat: a slow one-pixel breath, nothing else moves."""
    img = blank()
    breath = 1 if i >= FRAME_COUNT // 2 else 0
    stamp(img, SLEEP_ART, 0, breath)
    return img


BUILDERS = {"run": run_frame, "sleep": sleep_frame}


def main():
    written = 0
    for mood in MOODS:
        build = BUILDERS[mood]
        for i in range(FRAME_COUNT):
            base = build(i)
            for size in SIZES:
                out_dir = os.path.join(OUT_ROOT, mood, str(size))
                os.makedirs(out_dir, exist_ok=True)
                # NEAREST keeps the pixel-art edges hard at every scale.
                base.resize((size, size), Image.NEAREST).save(
                    os.path.join(out_dir, f"cat-{i:02d}.png"))
                written += 1
    print(f"wrote {written} frames to {OUT_ROOT}")


if __name__ == "__main__":
    main()
