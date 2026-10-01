import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {CatIcon} from './catIcon.js';
import {CatHud} from './hud.js';
import {CpuMonitor} from './metrics/cpu.js';
import {readMemory} from './metrics/memory.js';
import {readDisks} from './metrics/disk.js';
import {NetworkMonitor} from './metrics/network.js';

// Fast enough that the cat's gait tracks what the machine is doing, slow
// enough that sampling is not itself a measurable share of the load.
const POLL_INTERVAL_MS = 2000;
// Disk usage moves far more slowly, and is only worth polling while the panel
// that shows it is actually on screen.
const DISK_INTERVAL_MS = 20000;

const COLOR_TEXT = '#d7dae0';

export const CatHudIndicator = GObject.registerClass(
class CatHudIndicator extends PanelMenu.Button {
    _init(extensionPath, settings) {
        // menuAlignment 0, no menu: clicking toggles the HUD instead of
        // dropping a standard popup.
        super._init(0.0, 'Cat HUD', true);

        this._cpu = new CpuMonitor();
        this._network = new NetworkMonitor();
        this._diskCancellable = new Gio.Cancellable();

        this._timeoutId = null;
        this._lastDiskPoll = 0;

        const box = new St.BoxLayout({vertical: false, style: 'spacing: 6px;'});
        this._catIcon = new CatIcon(extensionPath, settings);
        box.add_child(this._catIcon);

        // Monospace and a fixed width so the panel does not jitter as the
        // numbers change width.
        this._label = new St.Label({
            text: 'CPU  --%  RAM  --%',
            style: `font-family: monospace; color: ${COLOR_TEXT}; font-size: 12px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);
        this.add_child(box);

        this._hud = new CatHud();
        this._hud.connect('closed', () => this.remove_style_pseudo_class('active'));

        this.connect('button-press-event', () => {
            this._toggleHud();
            return Clutter.EVENT_STOP;
        });

        this.connect('destroy', () => this._onDestroy());

        // Prime the delta-based monitors so the first visible sample is real,
        // then start ticking.
        this._cpu.read();
        this._network.read();
        this._startTimer();
    }

    _toggleHud() {
        if (this._hud.isOpen) {
            this._hud.close();
            return;
        }
        this.add_style_pseudo_class('active');
        this._hud.open();
        // Populate immediately rather than making the user wait a full tick.
        this._tick();
        this._pollDisks();
    }

    _startTimer() {
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_MS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _tick() {
        const cpu = this._cpu.read();
        const mem = readMemory();
        const net = this._network.read();

        this._catIcon.setCpu(cpu.ready ? cpu.total : 0);

        const cpuText = cpu.ready ? `${Math.round(cpu.total)}`.padStart(3) : ' --';
        const memText = mem ? `${Math.round(mem.percent)}`.padStart(3) : ' --';
        this._label.text = `CPU ${cpuText}%  RAM ${memText}%`;

        if (!this._hud.isOpen)
            return;

        this._hud.setFrequencies(this._cpu.readFrequencies());
        this._hud.updateCpu(cpu);
        this._hud.updateMemory(mem);
        this._hud.updateNetwork(net);

        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastDiskPoll >= DISK_INTERVAL_MS)
            this._pollDisks();
    }

    _pollDisks() {
        this._lastDiskPoll = GLib.get_monotonic_time() / 1000;
        readDisks(disks => {
            // The callback can outlive the panel being closed or the extension
            // being disabled, so re-check before touching any actor.
            if (this._hud && this._hud.isOpen)
                this._hud.updateDisks(disks);
        }, this._diskCancellable);
    }

    _onDestroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        this._diskCancellable.cancel();
        if (this._hud) {
            this._hud.close();
            this._hud.destroy();
            this._hud = null;
        }
    }
});
