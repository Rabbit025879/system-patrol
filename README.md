# Cat HUD

A GNOME Shell system monitor. The top bar stays to a single short line — the
cat is napping, the raccoon is sprinting — and clicking it opens a floating HUD
with the full picture: who the machine is, what it is doing, and how hard.

The mascot lives **in the HUD**, not in the panel. It runs faster as CPU load
rises and curls up asleep below 5%, so the animation is a reading too.

Two mascots ship with it, a **cat** and a **raccoon**, switchable in the
extension's preferences. The swap applies immediately — no logout needed.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-46-4A86CF)
![Platform](https://img.shields.io/badge/Platform-Linux-FCC624)

## What it shows

| Section | Source | Notes |
| --- | --- | --- |
| Identity | AccountsService, `/proc/uptime` | Login avatar, hostname, uptime |
| OS | `/etc/os-release`, `uname` | Distro, kernel, architecture |
| CPU | `/proc/stat`, `/proc/cpuinfo`, `coretemp` | Total, per-core load/clock/temp, 60-sample graph |
| Memory | `/proc/meminfo` | RAM, swap and cache |
| Storage | `/proc/mounts` + GIO | Real block devices only; snap loopbacks filtered out |
| Network | `/sys/class/net`, `ip`, `iwgetid` | SSID, live rates, local address |
| Power | `/sys/class/power_supply` | Charge, watts, time remaining |
| Graphics | `nvidia-smi`, `/sys/class/drm` | VRAM, temperature, clocks, utilisation |

Everything except the SSID, local address and GPU query comes straight from the
kernel with no subprocess at all.

## The HUD

- **Click** the panel line to open or close it
- **Drag** anywhere on the panel to move it
- **Esc**, or a click outside, closes it

Disks, network addresses, GPU counters and the public IP are only polled while
the HUD is on screen, and each on its own slower cadence.

## Top bar

One line, typed out character by character, in four modes:

- **Greetings** (default) — the author's own raccoon/rabbit set, rotating every
  90 seconds. Carried over from an earlier customisation of System Info HUD's
  welcome label; the step through the list is coprime with its length, so all
  thirteen appear before any repeats.
- **Activity** — a line tied to system load, using the same thresholds as the
  mascot's gait so the words and the animation always agree
- **CPU / RAM figures** — the plain numbers
- **Custom text** — your own string, with `{cpu}` `{ram}` `{mascot}` `{host}`

The typing walks the string by code point rather than by UTF-16 unit, so an
emoji is never left half-drawn mid-surrogate-pair.

## Privacy

The public IP row queries `api.ipify.org` every 10 minutes while the HUD is
open. **That is the only thing this extension sends off the machine**, and it
can be turned off in preferences — everything else is local reads.

## Settings

```bash
gnome-extensions prefs cathud@rabbit025879
```

Or from the command line:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/cathud@rabbit025879/schemas set org.gnome.shell.extensions.cathud mascot raccoon
```

## Regenerating the sprites

Both mascots are generated, not hand-drawn, so they can always be retuned and
rebuilt:

```bash
python3 tools/gen_frames.py
```

The mascot is a small skeletal rig — hip, shoulder, head, four two-segment
legs and a tail — posed per frame on a 36×24 pixel grid, so the gallop, walk
and sleep loops are tuned by editing `run_frame`, `walk_frame` and
`sleep_frame` rather than redrawing sprites. It writes 12 frames × 3 moods per
mascot into `assets/frames/`. Add `--preview DIR` to also get a looping GIF of
each, which is the quickest way to judge a change. A new animal is an entry in
`MASCOTS` plus the gschema enum and `prefs.js`. Requires Pillow.

Two things that are easy to get wrong when drawing a new one, both learned the
hard way here:

- **Keep markings mid-tone.** A true raccoon-black reads perfectly on a light
  panel and vanishes entirely into a dark one.
- **Join the tail where the back slopes down.** Drawn any higher it separates
  from the body and reads as loose dashes floating alongside the animal.

## Developing

On **X11**, `Alt`+`F2` then `r` restarts the shell in place and picks up code
changes. On **Wayland** that is not possible — log out and back in instead,
since GNOME caches extension modules for the session.

To smoke-test without touching your own session, run a nested shell:

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

## A note on GNOME versions

`metadata.json` declares support for shell 46 only, because that is what this
has actually been run on. That is deliberate: `St.BoxLayout` replaced its
boolean `vertical` property with `orientation` in GNOME 48, so code written
against one breaks outright on the other. This codebase uses `vertical`.

## Credits

Written from scratch. The layout and the choice of what to display were
informed by [System Info HUD](https://github.com/LalaloyXyz/System-info-HUD)
(GPL-3.0), and the animation technique is carried over from this author's own
Claude Usage extension. No code was copied from either.
