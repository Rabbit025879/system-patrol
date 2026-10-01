import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// NOTE: this extension targets GNOME Shell 46, where St.BoxLayout takes a
// boolean `vertical`. The `orientation` property only exists from GNOME 48 on,
// and passing it here throws "No property orientation on StBoxLayout".

// One Dark palette, matching the Claude Usage indicator.
const COLOR_NORMAL = '#98c379';
const COLOR_WARNING = '#e5c07b';
const COLOR_CRITICAL = '#e06c75';
const COLOR_TEXT = '#d7dae0';
const COLOR_MUTED = '#7f8694';
const COLOR_BG = 'rgba(28, 31, 36, 0.94)';
const COLOR_BORDER = 'rgba(122, 134, 148, 0.45)';
const COLOR_TRACK = 'rgba(122, 134, 148, 0.22)';

const WARNING_PERCENT = 75;
const CRITICAL_PERCENT = 90;

const BAR_WIDTH = 120;
const BAR_HEIGHT = 8;
const CORE_BAR_WIDTH = 54;
const CORE_COLUMNS = 2;

const MONO = 'font-family: monospace;';

function colorFor(percent) {
    if (percent >= CRITICAL_PERCENT)
        return COLOR_CRITICAL;
    if (percent >= WARNING_PERCENT)
        return COLOR_WARNING;
    return COLOR_NORMAL;
}

export function formatBytes(bytes) {
    const units = ['B', 'K', 'M', 'G', 'T'];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    // Sub-10 values keep a decimal so "1.4G" does not collapse to "1G".
    return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)}${units[i]}`;
}

export function formatRate(bytesPerSecond) {
    return `${formatBytes(bytesPerSecond)}/s`;
}

// A fixed-width track with a proportional fill. The fill is a child widget
// whose width is restyled on each update rather than re-created.
class Bar {
    constructor(width = BAR_WIDTH) {
        this._width = width;
        this.actor = new St.Widget({
            style: `width: ${width}px; height: ${BAR_HEIGHT}px;` +
                `background-color: ${COLOR_TRACK}; border-radius: ${BAR_HEIGHT / 2}px;`,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });
        this._fill = new St.Widget({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.FILL,
        });
        this.actor.add_child(this._fill);
    }

    set(percent) {
        const clamped = Math.max(0, Math.min(100, percent));
        // A non-zero load should always leave at least a visible sliver.
        const filled = clamped > 0 ? Math.max(2, Math.round(this._width * clamped / 100)) : 0;
        this._fill.style =
            `width: ${filled}px; background-color: ${colorFor(clamped)};` +
            `border-radius: ${BAR_HEIGHT / 2}px;`;
    }
}

function label(text, style = '') {
    return new St.Label({
        text,
        style: `${MONO} color: ${COLOR_TEXT}; ${style}`,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

function sectionTitle(text) {
    return new St.Label({
        text,
        style: `${MONO} color: ${COLOR_MUTED}; font-size: 11px; ` +
            'font-weight: bold; margin: 10px 0 4px 0; letter-spacing: 1px;',
    });
}

// A label + bar + value row, with the pieces kept around so updates only
// change text and styles instead of rebuilding actors every tick.
class MetricRow {
    constructor(name, {nameWidth = 70, barWidth = BAR_WIDTH, valueWidth = 90} = {}) {
        this.actor = new St.BoxLayout({vertical: false, style: 'spacing: 8px;'});
        this._name = label(name, `width: ${nameWidth}px;`);
        this._bar = new Bar(barWidth);
        this._value = label('', `width: ${valueWidth}px; color: ${COLOR_MUTED}; font-size: 11px;`);
        this.actor.add_child(this._name);
        this.actor.add_child(this._bar.actor);
        this.actor.add_child(this._value);
    }

    update(percent, valueText, nameText = null) {
        if (nameText !== null)
            this._name.text = nameText;
        this._bar.set(percent);
        this._value.text = valueText;
    }
}

export const CatHud = GObject.registerClass({
    // 'closed' has to be declared here; emitting an undeclared signal throws.
    Signals: {'closed': {}},
},
class CatHud extends St.BoxLayout {
    _init() {
        super._init({
            vertical: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
            style: `background-color: ${COLOR_BG}; border: 1px solid ${COLOR_BORDER};` +
                'border-radius: 16px; padding: 14px 18px 18px 18px;' +
                'box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);',
        });

        this._coreRows = [];
        this._diskRows = [];
        this._backdrop = null;
        this._isOpen = false;

        this._buildHeader();
        this._buildCpu();
        this._buildMemory();
        this._buildDisk();
        this._buildNetwork();

        this._setupDrag();

        this.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _buildHeader() {
        const header = new St.BoxLayout({vertical: false, style: 'spacing: 10px;'});
        header.add_child(new St.Label({
            text: 'Cat HUD',
            style: `${MONO} color: ${COLOR_TEXT}; font-size: 13px; font-weight: bold;`,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(new St.Widget({x_expand: true}));
        header.add_child(new St.Label({
            text: 'drag to move · esc to close',
            style: `${MONO} color: ${COLOR_MUTED}; font-size: 10px;`,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.add_child(header);
    }

    _buildCpu() {
        this.add_child(sectionTitle('CPU'));
        this._cpuTotal = new MetricRow('Total', {valueWidth: 110});
        this.add_child(this._cpuTotal.actor);

        // Per-core rows are laid out in fixed columns; the row set is created
        // on the first sample, once the core count is actually known.
        this._coreGrid = new St.BoxLayout({vertical: false, style: 'spacing: 14px; margin-top: 6px;'});
        this._coreColumns = [];
        for (let c = 0; c < CORE_COLUMNS; c++) {
            const column = new St.BoxLayout({vertical: true, style: 'spacing: 2px;'});
            this._coreColumns.push(column);
            this._coreGrid.add_child(column);
        }
        this.add_child(this._coreGrid);
    }

    _buildMemory() {
        this.add_child(sectionTitle('MEMORY'));
        this._memRow = new MetricRow('RAM', {valueWidth: 110});
        this._swapRow = new MetricRow('Swap', {valueWidth: 110});
        this.add_child(this._memRow.actor);
        this.add_child(this._swapRow.actor);
    }

    _buildDisk() {
        this.add_child(sectionTitle('DISK'));
        this._diskBox = new St.BoxLayout({vertical: true, style: 'spacing: 2px;'});
        this.add_child(this._diskBox);
    }

    _buildNetwork() {
        this.add_child(sectionTitle('NETWORK'));
        this._netBox = new St.BoxLayout({vertical: true, style: 'spacing: 2px;'});
        this._netTotal = label('');
        this._netBox.add_child(this._netTotal);
        this._netDetail = label('', `color: ${COLOR_MUTED}; font-size: 11px;`);
        this._netBox.add_child(this._netDetail);
        this.add_child(this._netBox);
    }

    // Press-drag-release on the body moves the window. Presses that land on a
    // child still bubble up here, which is what makes the whole panel a handle.
    _setupDrag() {
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let originX = 0;
        let originY = 0;

        this.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            [startX, startY] = event.get_coords();
            [originX, originY] = this.get_position();
            dragging = true;
            return Clutter.EVENT_STOP;
        });

        this.connect('motion-event', (_actor, event) => {
            if (!dragging)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            this.set_position(
                Math.round(originX + x - startX),
                Math.round(originY + y - startY));
            return Clutter.EVENT_STOP;
        });

        this.connect('button-release-event', () => {
            if (!dragging)
                return Clutter.EVENT_PROPAGATE;
            dragging = false;
            return Clutter.EVENT_STOP;
        });
    }

    get isOpen() {
        return this._isOpen;
    }

    open() {
        if (this._isOpen)
            return;
        this._isOpen = true;

        const monitor = Main.layoutManager.primaryMonitor;

        // A transparent full-monitor catcher sits underneath so a click
        // anywhere outside the panel dismisses it.
        this._backdrop = new St.Widget({reactive: true, can_focus: false});
        this._backdrop.set_size(monitor.width, monitor.height);
        this._backdrop.set_position(monitor.x, monitor.y);
        this._backdrop.connect('button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        Main.layoutManager.addChrome(this._backdrop);
        Main.layoutManager.addChrome(this, {trackFullscreen: true});

        const [, width] = this.get_preferred_width(-1);
        const [, height] = this.get_preferred_height(-1);
        const x = monitor.x + Math.floor((monitor.width - width) / 2);
        const y = monitor.y + Math.floor((monitor.height - height) / 2);

        this.set_position(x, y - 12);
        this.opacity = 0;
        this.ease({
            y,
            opacity: 255,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this.grab_key_focus();
    }

    close() {
        if (!this._isOpen)
            return;
        this._isOpen = false;

        if (this._backdrop) {
            Main.layoutManager.removeChrome(this._backdrop);
            this._backdrop.destroy();
            this._backdrop = null;
        }
        Main.layoutManager.removeChrome(this);
        this.emit('closed');
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    updateCpu(cpu) {
        if (!cpu.ready) {
            this._cpuTotal.update(0, 'sampling…');
            return;
        }

        this._cpuTotal.update(cpu.total, `${cpu.total.toFixed(1)}%`);

        // Build the per-core rows once the core count is known, then only
        // update their values on later ticks.
        if (this._coreRows.length !== cpu.cores.length) {
            for (const row of this._coreRows)
                row.actor.destroy();
            this._coreRows = [];

            const perColumn = Math.ceil(cpu.cores.length / CORE_COLUMNS);
            cpu.cores.forEach((_, i) => {
                const row = new MetricRow(`C${i}`, {
                    nameWidth: 26,
                    barWidth: CORE_BAR_WIDTH,
                    valueWidth: 64,
                });
                this._coreRows.push(row);
                this._coreColumns[Math.floor(i / perColumn)].add_child(row.actor);
            });
        }

        const freqs = this._frequencies ?? [];
        cpu.cores.forEach((percent, i) => {
            const mhz = freqs[i];
            this._coreRows[i].update(
                percent,
                mhz ? `${percent.toFixed(0)}% ${mhz}M` : `${percent.toFixed(0)}%`);
        });
    }

    setFrequencies(freqs) {
        this._frequencies = freqs;
    }

    updateMemory(mem) {
        if (!mem) {
            this._memRow.update(0, 'unavailable');
            this._swapRow.update(0, '');
            return;
        }
        this._memRow.update(mem.percent,
            `${formatBytes(mem.used)} / ${formatBytes(mem.total)}`);

        if (mem.swapTotal) {
            this._swapRow.update(mem.swapPercent,
                `${formatBytes(mem.swapUsed)} / ${formatBytes(mem.swapTotal)}`);
        } else {
            this._swapRow.update(0, 'none');
        }
    }

    updateDisks(disks) {
        if (this._diskRows.length !== disks.length) {
            for (const row of this._diskRows)
                row.actor.destroy();
            this._diskRows = disks.map(() => {
                const row = new MetricRow('', {nameWidth: 92, valueWidth: 110});
                this._diskBox.add_child(row.actor);
                return row;
            });
        }

        disks.forEach((disk, i) => {
            this._diskRows[i].update(disk.percent,
                `${formatBytes(disk.used)} / ${formatBytes(disk.size)}`,
                disk.path);
        });
    }

    updateNetwork(net) {
        if (!net.ready) {
            this._netTotal.text = '↓ sampling…   ↑ sampling…';
            this._netDetail.text = '';
            return;
        }
        this._netTotal.text =
            `↓ ${formatRate(net.rx).padEnd(10)} ↑ ${formatRate(net.tx)}`;
        this._netDetail.text = net.interfaces.length
            ? net.interfaces.map(i => `${i.name} ↓${formatRate(i.rx)} ↑${formatRate(i.tx)}`).join('   ')
            : 'no active interface';
    }
});
