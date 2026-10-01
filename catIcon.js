import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import cairo from 'gi://cairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FRAME_COUNT = 12;
// Every generated size is an exact integer multiple of the 16px art grid, so
// drawing the 64px set through a NEAREST filter lands on whole source pixels
// at 32px and stays crisp at the sizes in between.
const FRAME_SIZE = 64;
// 32 would map to exactly 2x the art grid, but crowds a 32px-tall panel.
const ICON_SIZE = 28;

const MOOD_RUN = 'run';
const MOOD_SLEEP = 'sleep';
const MOODS = [MOOD_RUN, MOOD_SLEEP];

// Below this the machine is effectively idle and the cat curls up.
const SLEEP_MAX_PERCENT = 5;
const WALK_MAX_PERCENT = 30;
const TROT_MAX_PERCENT = 70;

const RUN_INTERVAL_MS = {
    walk: 220,
    trot: 110,
    sprint: 60,
};
const SLEEP_INTERVAL_MS = 400;

function moodFor(cpuPercent) {
    return cpuPercent < SLEEP_MAX_PERCENT ? MOOD_SLEEP : MOOD_RUN;
}

function runIntervalForPercent(percent) {
    if (percent <= WALK_MAX_PERCENT)
        return RUN_INTERVAL_MS.walk;
    if (percent <= TROT_MAX_PERCENT)
        return RUN_INTERVAL_MS.trot;
    return RUN_INTERVAL_MS.sprint;
}

export const CatIcon = GObject.registerClass(
class CatIcon extends St.DrawingArea {
    _init(extensionPath, settings) {
        super._init({
            style_class: 'system-status-icon',
            reactive: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.set_size(ICON_SIZE, ICON_SIZE);

        // Frames are decoded lazily per mood on first use, since a machine that
        // never idles below 5% never needs the sleep set.
        this._extensionPath = extensionPath;
        this._settings = settings;
        this._mascot = settings.get_string('mascot');
        this._surfaces = {};

        // Switching mascot drops every decoded frame and repaints, so the swap
        // takes effect immediately rather than at the next login.
        this._mascotChangedId = settings.connect('changed::mascot', () => {
            this._mascot = settings.get_string('mascot');
            this._cleanupSurfaces();
            this._frameIndex = 0;
            this.queue_repaint();
        });

        this._mood = MOOD_SLEEP;
        this._frameIndex = 0;
        this._timeoutId = null;
        this._currentInterval = null;
        this._suspended = false;

        this.connect('repaint', area => this._onRepaint(area));

        // Pause while the screen is locked so the timer is not burning CPU --
        // and skewing the very number it is displaying -- for a hidden panel.
        try {
            this._lockedChangedId = Main.screenShield.connect('locked-changed', () => {
                this._setSuspended(!!Main.screenShield.locked);
            });
        } catch (e) {
            logError(e, 'cathud: could not hook screen lock state');
            this._lockedChangedId = null;
        }

        this.connect('destroy', () => {
            this._stopTimer();
            this._cleanupSurfaces();
            if (this._lockedChangedId)
                Main.screenShield.disconnect(this._lockedChangedId);
            if (this._mascotChangedId)
                this._settings.disconnect(this._mascotChangedId);
        });

        // Starts frozen on the sleeping pose until the first CPU sample lands.
    }

    _framesFor(mood) {
        if (!this._surfaces[mood])
            this._surfaces[mood] = this._loadFrames(mood);
        return this._surfaces[mood];
    }

    _loadFrames(mood) {
        const surfaces = [];
        for (let i = 0; i < FRAME_COUNT; i++) {
            const n = i.toString().padStart(2, '0');
            const path = GLib.build_filenamev([
                this._extensionPath, 'assets', 'frames', this._mascot, mood,
                `${FRAME_SIZE}`, `frame-${n}.png`,
            ]);
            try {
                const surface = cairo.ImageSurface.createFromPNG(path);
                // A failed decode still yields a surface object, just a
                // dimensionless one; _onRepaint already skips a null frame.
                surfaces.push(surface.getWidth() > 0 && surface.getHeight() > 0 ? surface : null);
            } catch (e) {
                logError(e, `cathud: failed to load ${path}`);
                surfaces.push(null);
            }
        }
        return surfaces;
    }

    // cpuPercent is the current total CPU utilization (0-100).
    setCpu(cpuPercent) {
        const mood = moodFor(cpuPercent);
        const interval = mood === MOOD_SLEEP
            ? SLEEP_INTERVAL_MS
            : runIntervalForPercent(cpuPercent);

        if (mood !== this._mood) {
            this._mood = mood;
            this._frameIndex = 0;
            this.queue_repaint();
        }
        this._startTimer(interval);
    }

    // Stops the timer and freezes on the sleeping pose.
    pause() {
        this._stopTimer();
        this._currentInterval = null;
        this._mood = MOOD_SLEEP;
        if (this._frameIndex !== 0) {
            this._frameIndex = 0;
            this.queue_repaint();
        }
    }

    _startTimer(interval) {
        if (this._currentInterval === interval)
            return;
        this._currentInterval = interval;
        this._restartTimer();
    }

    _stopTimer() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    // Suspends or resumes ticking without touching mood/frame/interval state,
    // so the animation picks up exactly where it left off once resumed.
    _setSuspended(suspended) {
        if (this._suspended === suspended)
            return;
        this._suspended = suspended;
        this._restartTimer();
    }

    _restartTimer() {
        this._stopTimer();
        if (this._suspended || this._currentInterval === null)
            return;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._currentInterval, () => {
            this._frameIndex = (this._frameIndex + 1) % FRAME_COUNT;
            this.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _cleanupSurfaces() {
        for (const mood of MOODS) {
            for (const surface of this._surfaces[mood] ?? []) {
                if (surface && typeof surface.$dispose === 'function')
                    surface.$dispose();
            }
        }
        this._surfaces = {};
    }

    _onRepaint(area) {
        const cr = area.get_context();
        const [surfaceWidth, surfaceHeight] = area.get_surface_size();
        const image = this._framesFor(this._mood)[this._frameIndex];

        if (!image) {
            cr.$dispose();
            return;
        }

        const resourceScale = this.get_resource_scale();
        const imgWidth = image.getWidth() / resourceScale;
        const imgHeight = image.getHeight() / resourceScale;
        const scale = Math.min(surfaceWidth / imgWidth, surfaceHeight / imgHeight);

        cr.translate(
            (surfaceWidth - imgWidth * scale) / 2,
            (surfaceHeight - imgHeight * scale) / 2);
        cr.scale(scale, scale);

        cr.setSourceSurface(image, 0, 0);
        // Without NEAREST, cairo's default smoothing turns the chunky pixel art
        // into a blur at any scale that is not exactly 1:1.
        try {
            cr.getSource().setFilter(cairo.Filter.NEAREST);
        } catch (e) {
            // Older cairo bindings without pattern filters still draw, just softly.
        }
        cr.paint();
        cr.$dispose();
    }
});
