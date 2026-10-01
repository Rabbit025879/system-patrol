#!/usr/bin/env python3
"""Generate the Cat HUD panel sprite frames.

Each mascot is authored as ASCII art on a 16x16 logical grid and upscaled with
nearest-neighbour so it stays crisp pixel art at every size. Keeping the art in
this script (rather than only as PNGs) means a sprite can always be retouched
and regenerated -- the previous extension's generator was lost because it was
never committed.

Usage:  python3 tools/gen_frames.py
Writes: assets/frames/<mascot>/<mood>/<size>/frame-<nn>.png
"""

import math
import os

from PIL import Image

GRID = 16
FRAME_COUNT = 12
SIZES = [16, 24, 32, 64, 128]
MOODS = ["run", "sleep"]

OUT_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "assets", "frames")

EYE = (248, 250, 252, 255)
NONE = (0, 0, 0, 0)

# Grey-blue tabby. Deliberately not clawd's clay-orange, so the extensions stay
# tellable apart in the top bar. Mid-tone reads on light and dark panels.
CAT_BODY = (125, 138, 153, 255)
CAT_DARK = (82, 92, 105, 255)

# The eye mask and tail rings are the whole silhouette at this size, so they
# have to stay visible against a near-black top bar as well as a light one.
# A true raccoon-black marking (58, 64, 73) disappears into the dark panel
# entirely; this mid-tone keeps contrast against the body in both themes.
RACCOON_BODY = (178, 186, 196, 255)
RACCOON_DARK = (92, 101, 114, 255)

# --- cat -------------------------------------------------------------------

# Body, head and tail. Legs are drawn separately per frame (rows 12-14), and
# rows 0-1 stay clear so the vertical bob never clips at the top.
CAT_ART = [
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
# gives all 12 frames their own silhouette.
CAT_LEGS = [
    ["..##...##.......", "...#....#.......", "...o....o......."],
    ["..##....##......", "..#......#......", "..o......o......"],
    ["...##..##.......", "...#...#........", "...o...o........"],
    ["..##...##.......", "..#.....#.......", "..o.....o......."],
]

# Curled up asleep. The head sits to the right with its ears and a shut-eye
# dash, and the tail wraps around the front in the dark tone so it separates
# from the body -- without those cues a curled animal just reads as a blob.
CAT_SLEEP = [
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

# --- raccoon ---------------------------------------------------------------

# Stockier than the cat, with the two markings that actually identify a raccoon
# at 16px: a dark bandit mask across the eye, and a banded tail.
# The tail runs as a banded diagonal that meets the body where the back slopes
# down, the same join the cat uses. Drawn higher than that it reads as loose
# dashes floating beside the animal rather than as a tail.
RACCOON_ART = [
    "................",
    "................",
    "...........o...o",
    "...........##.##",
    "oo........######",
    "##........oEoo##",
    ".oo.......######",
    ".##.....########",
    "..oo..##########",
    "..##############",
    "..##############",
    "..##############",
]

# Thicker, shorter and darker than the cat's -- raccoons have black paws, and
# 1px legs read as spider limbs once the tail is this heavy.
RACCOON_LEGS = [
    ["..oo...oo.......", "..oo...oo......."],
    ["..oo....oo......", "..oo....oo......"],
    ["...oo..oo.......", "...oo..oo......."],
    [".oo.....oo......", ".oo.....oo......"],
]

# Curled asleep. The mask carries the identity here; the banded tail lies
# across the front so the stripes stay visible on the curled silhouette.
RACCOON_SLEEP = [
    "................",
    "................",
    "................",
    "................",
    "...........o...o",
    "...........##.##",
    "oo........######",
    "##....####oEoo##",
    "oo##############",
    "################",
    ".###############",
    ".###############",
    "..############..",
    "................",
    "................",
    "................",
]

MASCOTS = {
    "cat": {
        "body": CAT_BODY,
        "dark": CAT_DARK,
        "art": CAT_ART,
        "legs": CAT_LEGS,
        "sleep": CAT_SLEEP,
    },
    "raccoon": {
        "body": RACCOON_BODY,
        "dark": RACCOON_DARK,
        "art": RACCOON_ART,
        "legs": RACCOON_LEGS,
        "sleep": RACCOON_SLEEP,
    },
}


def palette_for(spec):
    return {".": NONE, "#": spec["body"], "o": spec["dark"], "E": EYE}


def stamp(img, art, palette, y_off=0):
    """Paint ASCII art onto the grid at the given vertical offset."""
    px = img.load()
    for y, row in enumerate(art):
        ty = y + y_off
        if not 0 <= ty < GRID:
            continue
        for x, ch in enumerate(row):
            if x >= GRID:
                continue
            color = palette.get(ch, NONE)
            if color[3]:
                px[x, ty] = color


def run_frame(spec, i):
    """Walking: legs cycle every 4 frames, body bobs once per 12."""
    img = Image.new("RGBA", (GRID, GRID), NONE)
    palette = palette_for(spec)
    # One full bob per loop. Integer offset keeps it on the pixel grid.
    bob = 1 if math.sin(i / FRAME_COUNT * 2 * math.pi) > 0.5 else 0
    stamp(img, spec["art"], palette, bob)
    stamp(img, spec["legs"][i % len(spec["legs"])], palette, 12 + bob)
    return img


def sleep_frame(spec, i):
    """Curled up: a slow one-pixel breath, nothing else moves."""
    img = Image.new("RGBA", (GRID, GRID), NONE)
    stamp(img, spec["sleep"], palette_for(spec), 1 if i >= FRAME_COUNT // 2 else 0)
    return img


BUILDERS = {"run": run_frame, "sleep": sleep_frame}


def main():
    written = 0
    for mascot, spec in MASCOTS.items():
        for mood in MOODS:
            build = BUILDERS[mood]
            for i in range(FRAME_COUNT):
                base = build(spec, i)
                for size in SIZES:
                    out_dir = os.path.join(OUT_ROOT, mascot, mood, str(size))
                    os.makedirs(out_dir, exist_ok=True)
                    # NEAREST keeps the pixel-art edges hard at every scale.
                    base.resize((size, size), Image.NEAREST).save(
                        os.path.join(out_dir, f"frame-{i:02d}.png"))
                    written += 1
    print(f"wrote {written} frames for {len(MASCOTS)} mascots to {OUT_ROOT}")


if __name__ == "__main__":
    main()
