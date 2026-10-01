import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {PatrolHud} from './hud.js';
import {greetingFor, activityFor, formatCustom, ROTATE_SECONDS} from './phrases.js';
import {CpuMonitor} from './metrics/cpu.js';
import {readMemory} from './metrics/memory.js';
import {readDisks} from './metrics/disk.js';
import {NetworkMonitor, readLinkInfo} from './metrics/network.js';
import {readStatic, readUptime} from './metrics/system.js';
import {readPower} from './metrics/power.js';
import {readGpus} from './metrics/gpu.js';
import {PublicIpMonitor} from './metrics/publicip.js';

// The panel only needs a load figure to pick its phrase, so it can tick
// slowly while the HUD is shut. Open, it drives a live uptime counter.
const IDLE_INTERVAL_MS = 3000;
const OPEN_INTERVAL_MS = 1000;

// These need a subprocess or the network, so they run far less often than
// the counters, and only while the HUD is actually on screen.
const DISK_INTERVAL_MS = 20000;
const LINK_INTERVAL_MS = 15000;
const GPU_INTERVAL_MS = 5000;

// Matches the typing speed of the welcome label this set of greetings came
// from, which is what makes it read as the same effect.
const TYPE_INTERVAL_MS = 80;

const COLOR_TEXT = '#d7dae0';

export const PatrolIndicator = GObject.registerClass(
class PatrolIndicator extends PanelMenu.Button {
    _init(extensionPath, settings) {
        // menuAlignment 0, no menu: clicking toggles the HUD instead of
        // dropping a standard popup.
        super._init(0.0, 'System Patrol', true);

        this._settings = settings;
        this._cpu = new CpuMonitor();
        this._network = new NetworkMonitor();
        this._publicIp = new PublicIpMonitor();
        this._cancellable = new Gio.Cancellable();
        this._static = readStatic();

        this._timeoutId = null;
        this._interval = IDLE_INTERVAL_MS;
        this._startedAt = GLib.get_monotonic_time() / 1e6;
        this._lastDiskPoll = 0;
        this._lastLinkPoll = 0;
        this._lastGpuPoll = 0;
        this._link = null;
        this._lastCpuPercent = 0;
        this._lastMemPercent = 0;
        this._panelTarget = null;
        this._typeId = null;

        this._label = new St.Label({
            text: '…',
            style: `font-family: monospace; color: ${COLOR_TEXT}; font-size: 12px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);

        this._hud = new PatrolHud(extensionPath, settings);
        this._hud.setStatic(this._static);
        this._hud.connect('closed', () => {
            this.remove_style_pseudo_class('active');
            // Nothing is watching the animation once the HUD is shut.
            this._hud.mascot.pause();
            this._setInterval(IDLE_INTERVAL_MS);
        });

        this.connect('button-press-event', () => {
            this._toggleHud();
            return Clutter.EVENT_STOP;
        });

        // Only restyle from cached values -- calling _tick here would take an
        // extra CPU sample, shrinking the delta window and reporting ~0%.
        this._settingsChangedId = settings.connect('changed', () => {
            this._applyPanelText(
                this._panelText(this._lastCpuPercent, this._lastMemPercent));
        });

        this.connect('destroy', () => this._onDestroy());

        // Prime the delta-based monitors so the first visible sample is real.
        this._cpu.read();
        this._network.read();
        this._setInterval(IDLE_INTERVAL_MS);
    }

    _toggleHud() {
        if (this._hud.isOpen) {
            this._hud.close();
            return;
        }
        this.add_style_pseudo_class('active');
        this._hud.open();
        this._setInterval(OPEN_INTERVAL_MS);
        // Populate immediately rather than making the user wait a full tick.
        this._tick();
        this._pollDisks();
        this._pollLink();
        this._pollGpus();
        this._pollPublicIp();
    }

    _setInterval(ms) {
        if (this._timeoutId && this._interval === ms)
            return;
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._interval = ms;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // Live figures change every tick, so they are written straight to the
    // label; a greeting changes rarely and is typed out instead.
    _panelText(cpuPercent, memPercent) {
        const mascot = this._settings.get_string('mascot');
        const mode = this._settings.get_string('panel-mode');
        const elapsed = GLib.get_monotonic_time() / 1e6 - this._startedAt;
        const rotation = Math.floor(elapsed / ROTATE_SECONDS);

        switch (mode) {
        case 'stats':
            return {
                text: `CPU ${`${Math.round(cpuPercent)}`.padStart(3)}%  ` +
                    `RAM ${`${Math.round(memPercent)}`.padStart(3)}%`,
                typed: false,
            };
        case 'custom':
            return {
                text: formatCustom(this._settings.get_string('panel-custom-text'), {
                    cpu: cpuPercent,
                    ram: memPercent,
                    mascot,
                    host: this._static.hostname,
                }),
                typed: false,
            };
        case 'activity':
            return {text: activityFor(mascot, cpuPercent, rotation), typed: true};
        default:
            return {text: greetingFor(rotation), typed: true};
        }
    }

    _applyPanelText({text, typed}) {
        if (text === this._panelTarget)
            return;
        this._panelTarget = text;

        if (this._typeId) {
            GLib.source_remove(this._typeId);
            this._typeId = null;
        }

        if (!typed) {
            this._label.text = text;
            return;
        }

        // Array.from splits by code point, so an emoji is never cut in half
        // mid-surrogate-pair the way slicing the raw string would.
        const chars = Array.from(text);
        let i = 0;
        this._label.text = '';
        this._typeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TYPE_INTERVAL_MS, () => {
            i++;
            this._label.text = chars.slice(0, i).join('');
            if (i >= chars.length) {
                this._typeId = null;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _tick() {
        const cpu = this._cpu.read();
        const mem = readMemory();

        if (cpu.ready)
            this._lastCpuPercent = cpu.total;
        if (mem)
            this._lastMemPercent = mem.percent;

        const panel = this._panelText(this._lastCpuPercent, this._lastMemPercent);
        this._applyPanelText(panel);

        if (!this._hud.isOpen)
            return;

        // The mascot only runs while it is visible, inside the HUD.
        this._hud.mascot.setCpu(this._lastCpuPercent);
        this._hud.setUptime(readUptime().text);

        this._hud.updateCpu(cpu, {
            model: this._cpu.modelName(),
            temps: this._cpu.readTemperatures(),
            freqs: this._cpu.readFrequencies(),
            history: this._cpu.history,
            capacity: this._cpu.historyLength,
            coreIds: this._cpu.coreIds,
        });
        this._hud.updateMemory(mem);
        this._hud.updatePower(readPower());
        this._hud.updateNetwork(this._network.read(), this._link);

        const showPublicIp = this._settings.get_boolean('show-public-ip');
        this._hud.setPublicIpVisible(showPublicIp);

        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastDiskPoll >= DISK_INTERVAL_MS)
            this._pollDisks();
        if (now - this._lastLinkPoll >= LINK_INTERVAL_MS)
            this._pollLink();
        if (now - this._lastGpuPoll >= GPU_INTERVAL_MS)
            this._pollGpus();
        if (showPublicIp)
            this._pollPublicIp();
    }

    _pollDisks() {
        this._lastDiskPoll = GLib.get_monotonic_time() / 1000;
        readDisks(disks => {
            // Callbacks can outlive the HUD closing or the extension being
            // disabled, so re-check before touching any actor.
            if (this._hud?.isOpen)
                this._hud.updateDisks(disks);
        }, this._cancellable);
    }

    _pollLink() {
        this._lastLinkPoll = GLib.get_monotonic_time() / 1000;
        readLinkInfo(link => {
            this._link = link;
            if (this._hud?.isOpen)
                this._hud.updateNetwork(this._network.read(), link);
        }, this._cancellable);
    }

    _pollGpus() {
        this._lastGpuPoll = GLib.get_monotonic_time() / 1000;
        readGpus(gpus => {
            if (this._hud?.isOpen)
                this._hud.updateGpus(gpus);
        }, this._cancellable);
    }

    _pollPublicIp() {
        this._publicIp.fetch(address => {
            if (this._hud?.isOpen)
                this._hud.updatePublicIp(address);
        });
    }

    _onDestroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._typeId) {
            GLib.source_remove(this._typeId);
            this._typeId = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._cancellable.cancel();
        this._publicIp.destroy();
        if (this._hud) {
            this._hud.close();
            this._hud.destroy();
            this._hud = null;
        }
    }
});
