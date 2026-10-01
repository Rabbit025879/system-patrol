# Cat HUD

A GNOME Shell system monitor. A pixel animal sits in the top bar next to live
CPU and RAM figures, and runs faster the busier the machine gets — curled up
asleep under 5%, walking, trotting, then sprinting past 70%. Clicking it opens
a floating HUD with the full breakdown.

Two mascots ship with it, a **cat** and a **raccoon**, switchable in the
extension's preferences. The swap applies immediately — no logout needed.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-46-4A86CF)
![Platform](https://img.shields.io/badge/Platform-Linux-FCC624)

## What it shows

| Section | Source | Notes |
| --- | --- | --- |
| CPU | `/proc/stat`, `/proc/cpuinfo` | Total plus every core, with current clock |
| Memory | `/proc/meminfo` | Uses `MemAvailable`, and swap when configured |
| Disk | `/proc/mounts` + GIO | Real block devices only; snap loopbacks filtered out |
| Network | `/sys/class/net/*/statistics` | Live up/down rates per active interface |

No external tools are required — everything comes from the kernel directly.

## The HUD

- **Click** the panel cat to open or close it
- **Drag** anywhere on the panel to move it
- **Esc**, or a click outside, closes it

Disk and the per-core breakdown are only polled while the HUD is on screen.

## Install

```bash
ln -s "$PWD" ~/.local/share/gnome-shell/extensions/cathud@rabbit025879
gnome-extensions enable cathud@rabbit025879
```

On Wayland the shell cannot be restarted in place, so log out and back in for
code changes to take effect — GNOME caches extension modules for the session.

## Switching mascot

```bash
gnome-extensions prefs cathud@rabbit025879
```

Or straight from the command line:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/cathud@rabbit025879/schemas set org.gnome.shell.extensions.cathud mascot raccoon
```

## Regenerating the sprites

Both mascots are authored as ASCII art inside the generator, not hand-drawn, so
they can always be retouched and rebuilt:

```bash
python3 tools/gen_frames.py
```

This writes 12 frames × 2 moods × 5 sizes per mascot into `assets/frames/`.
Edit the `*_ART`, `*_LEGS` and `*_SLEEP` blocks in the script to change them,
and add an entry to `MASCOTS` (plus the gschema enum and `prefs.js`) to add a
new animal. Requires Pillow.

Two things that are easy to get wrong when drawing a new one, both learned the
hard way here:

- **Keep markings mid-tone.** A true raccoon-black reads perfectly on a light
  panel and vanishes entirely into a dark one.
- **Join the tail where the back slopes down.** Drawn any higher it separates
  from the body and reads as loose dashes floating alongside the animal.

## A note on GNOME versions

`metadata.json` declares support for shell 46 only, because that is what this
has actually been run on. That is deliberate: `St.BoxLayout` replaced its
boolean `vertical` property with `orientation` in GNOME 48, so code written
against one breaks outright on the other. This codebase uses `vertical`.

## Credits

Written from scratch. The data-collection approach was informed by reading
[System Info HUD](https://github.com/LalaloyXyz/System-info-HUD) (GPL-3.0), and
the animation technique is carried over from this author's own Claude Usage
extension. No code was copied from either.
