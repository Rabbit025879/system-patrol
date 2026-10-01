import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {CatIcon} from './catIcon.js';

// NOTE: this extension targets GNOME Shell 46, where St.BoxLayout takes a
// boolean `vertical`. The `orientation` property only exists from GNOME 48 on,
// and passing it here throws "No property orientation on StBoxLayout".

// One Dark palette, matching the Claude Usage indicator.
const COLOR_NORMAL = '#98c379';
const COLOR_WARNING = '#e5c07b';
const COLOR_CRITICAL = '#e06c75';
const COLOR_ACCENT = '#61afef';
const COLOR_VIOLET = '#c678dd';
const COLOR_TEXT = '#d7dae0';
const COLOR_MUTED = '#7f8694';
const COLOR_BG = 'rgba(26, 29, 33, 0.96)';
const COLOR_PANEL = 'rgba(38, 42, 48, 0.75)';
const COLOR_BORDER = 'rgba(122, 134, 148, 0.35)';
const COLOR_TRACK = 'rgba(122, 134, 148, 0.22)';

const WARNING_PERCENT = 75;
const CRITICAL_PERCENT = 90;

const BAR_HEIGHT = 7;
const MASCOT_SIZE = 56;
const AVATAR_SIZE = 56;
const GRAPH_HEIGHT = 92;

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

// Distinct hues for the per-core graph lines, spread evenly around the wheel.
function coreColor(index, count) {
    const hue = (index / Math.max(1, count)) * 360;
    const s = 0.62;
    const l = 0.62;
    const k = n => (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
}

function label(text, style = '') {
    return new St.Label({
        text,
        style: `${MONO} color: ${COLOR_TEXT}; font-size: 12px; ${style}`,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

// A small coloured chip standing in for an icon, as in the reference layout.
function sectionHeader(title, accent) {
    const row = new St.BoxLayout({vertical: false, style: 'spacing: 7px; margin: 12px 0 5px 0;'});
    row.add_child(new St.Widget({
        style: `width: 11px; height: 11px; border-radius: 3px; background-color: ${accent};`,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    row.add_child(new St.Label({
        text: title,
        style: `${MONO} color: ${COLOR_MUTED}; font-size: 11px; ` +
            'font-weight: bold; letter-spacing: 1px;',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    return row;
}

// A fixed-width track with a proportional fill. The fill is a child widget
// whose width is restyled on each update rather than re-created.
class Bar {
    constructor(width) {
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

    set(percent, color = null) {
        const clamped = Math.max(0, Math.min(100, percent));
        // A non-zero load should always leave at least a visible sliver.
        const filled = clamped > 0 ? Math.max(2, Math.round(this._width * clamped / 100)) : 0;
        this._fill.style =
            `width: ${filled}px; background-color: ${color ?? colorFor(clamped)};` +
            `border-radius: ${BAR_HEIGHT / 2}px;`;
    }
}

// name | value | bar | percent | trailing, with every piece optional-width so
// the same class serves memory, storage, power and the per-core list.
class MetricRow {
    constructor(name, {
        dotColor = null, nameWidth = 54, valueWidth = 96, barWidth = 72,
        percentWidth = 38, trailWidth = 0,
    } = {}) {
        this.actor = new St.BoxLayout({vertical: false, style: 'spacing: 7px;'});

        this._dot = new St.Widget({
            style: `width: 7px; height: 7px; border-radius: 4px;` +
                `background-color: ${dotColor ?? COLOR_NORMAL};`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this._dot);

        this._name = label(name, `width: ${nameWidth}px;`);
        this._value = label('', `width: ${valueWidth}px; color: ${COLOR_MUTED}; font-size: 11px;`);
        this._bar = new Bar(barWidth);
        this._percent = label('', `width: ${percentWidth}px; font-size: 11px;`);

        this.actor.add_child(this._name);
        this.actor.add_child(this._value);
        this.actor.add_child(this._bar.actor);
        this.actor.add_child(this._percent);

        if (trailWidth) {
            this._trail = label('', `width: ${trailWidth}px; color: ${COLOR_MUTED}; font-size: 11px;`);
            this.actor.add_child(this._trail);
        }
    }

    update({percent = 0, value = '', trail = '', name = null, dotColor = null, barColor = null}) {
        if (name !== null)
            this._name.text = name;
        if (dotColor)
            this._dot.style =
                `width: 7px; height: 7px; border-radius: 4px; background-color: ${dotColor};`;
        this._value.text = value;
        this._bar.set(percent, barColor);
        this._percent.text = `${Math.round(percent)}%`;
        if (this._trail)
            this._trail.text = trail;
    }
}

// Per-core load history as overlaid polylines, one hue per core.
const CpuGraph = GObject.registerClass(
class CpuGraph extends St.DrawingArea {
    _init() {
        super._init({
            style: `background-color: ${COLOR_PANEL}; border-radius: 8px; margin: 4px 0;`,
        });
        this.set_height(GRAPH_HEIGHT);
        this._history = [];
        this._capacity = 60;
        this.connect('repaint', area => this._draw(area));
    }

    setHistory(history, capacity) {
        this._history = history;
        this._capacity = capacity;
        this.queue_repaint();
    }

    _draw(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const padX = 8;
        const padY = 8;
        const plotW = Math.max(1, width - padX * 2);
        const plotH = Math.max(1, height - padY * 2);

        // 50% guide line.
        cr.setSourceRGBA(0.49, 0.53, 0.58, 0.35);
        cr.setLineWidth(1);
        cr.moveTo(padX, padY + plotH / 2);
        cr.lineTo(padX + plotW, padY + plotH / 2);
        cr.stroke();

        const samples = this._history;
        if (samples.length < 2) {
            cr.$dispose();
            return;
        }

        const coreCount = samples[samples.length - 1].length;
        // Oldest sample pins to the left edge of the window, so the trace
        // scrolls instead of stretching as history fills up.
        const stepX = plotW / Math.max(1, this._capacity - 1);
        const offsetX = padX + plotW - (samples.length - 1) * stepX;

        cr.setLineWidth(1.4);
        for (let core = 0; core < coreCount; core++) {
            const [r, g, b] = coreColor(core, coreCount);
            cr.setSourceRGBA(r, g, b, 0.9);
            let started = false;
            for (let i = 0; i < samples.length; i++) {
                const value = samples[i][core];
                if (value === undefined)
                    continue;
                const x = offsetX + i * stepX;
                const y = padY + plotH - (Math.max(0, Math.min(100, value)) / 100) * plotH;
                if (started) {
                    cr.lineTo(x, y);
                } else {
                    cr.moveTo(x, y);
                    started = true;
                }
            }
            cr.stroke();
        }

        cr.$dispose();
    }
});

export const CatHud = GObject.registerClass({
    // 'closed' has to be declared here; emitting an undeclared signal throws.
    Signals: {'closed': {}},
},
class CatHud extends St.BoxLayout {
    _init(extensionPath, settings) {
        super._init({
            vertical: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
            style: `background-color: ${COLOR_BG}; border: 1px solid ${COLOR_BORDER};` +
                'border-radius: 18px; padding: 16px 20px 20px 20px;' +
                'box-shadow: 0 18px 45px rgba(0, 0, 0, 0.5);',
        });

        this._coreRows = [];
        this._diskRows = [];
        this._gpuBlocks = [];
        this._backdrop = null;
        this._isOpen = false;

        this._buildHeader(extensionPath, settings);

        const columns = new St.BoxLayout({vertical: false, style: 'spacing: 28px;'});
        const left = new St.BoxLayout({vertical: true});
        const right = new St.BoxLayout({vertical: true});

        this._buildNetwork(left);
        this._buildMemory(left);
        this._buildStorage(left);
        this._buildPower(left);

        this._buildOs(right);
        this._buildCpu(right);
        this._buildGpu(right);

        columns.add_child(left);
        columns.add_child(right);
        this.add_child(columns);

        this._setupDrag();

        this.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    // Avatar and machine identity on the left, the mascot on the right: the
    // animation lives here rather than in the top bar, which keeps the panel
    // to a single line of text.
    _buildHeader(extensionPath, settings) {
        const header = new St.BoxLayout({vertical: false, style: 'spacing: 14px;'});

        this._avatar = new St.Widget({
            style: `width: ${AVATAR_SIZE}px; height: ${AVATAR_SIZE}px;` +
                `border-radius: ${AVATAR_SIZE / 2}px; background-color: ${COLOR_PANEL};`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._avatar);

        const identity = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        identity.add_child(new St.Label({
            text: 'Device name',
            style: `${MONO} color: ${COLOR_MUTED}; font-size: 11px;`,
        }));
        this._hostLabel = new St.Label({
            text: '—',
            style: `${MONO} color: ${COLOR_TEXT}; font-size: 15px; font-weight: bold;`,
        });
        identity.add_child(this._hostLabel);
        this._uptimeLabel = new St.Label({
            text: '',
            style: `${MONO} color: ${COLOR_MUTED}; font-size: 11px;`,
        });
        identity.add_child(this._uptimeLabel);
        header.add_child(identity);

        header.add_child(new St.Widget({x_expand: true}));

        const mascotBox = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        this.mascot = new CatIcon(extensionPath, settings, MASCOT_SIZE);
        mascotBox.add_child(this.mascot);
        this._phraseLabel = new St.Label({
            text: '',
            style: `${MONO} color: ${COLOR_MUTED}; font-size: 11px;`,
            x_align: Clutter.ActorAlign.CENTER,
        });
        mascotBox.add_child(this._phraseLabel);
        header.add_child(mascotBox);

        this.add_child(header);
    }

    _buildNetwork(parent) {
        parent.add_child(sectionHeader('NETWORK', COLOR_ACCENT));
        this._wifiLabel = label('Wi-Fi : —');
        this._rateLabel = label('', `color: ${COLOR_MUTED}; font-size: 11px;`);
        this._publicIpLabel = label('Public IP : —', `color: ${COLOR_MUTED}; font-size: 11px;`);
        this._localIpLabel = label('Local IP : —', `color: ${COLOR_MUTED}; font-size: 11px;`);
        parent.add_child(this._wifiLabel);
        parent.add_child(this._rateLabel);
        parent.add_child(this._publicIpLabel);
        parent.add_child(this._localIpLabel);
    }

    _buildMemory(parent) {
        parent.add_child(sectionHeader('MEMORY', COLOR_NORMAL));
        this._memRow = new MetricRow('RAM', {trailWidth: 0});
        this._swapRow = new MetricRow('Swap', {dotColor: COLOR_VIOLET});
        this._cacheLabel = label('', `color: ${COLOR_MUTED}; font-size: 11px; margin-left: 14px;`);
        parent.add_child(this._memRow.actor);
        parent.add_child(this._swapRow.actor);
        parent.add_child(this._cacheLabel);
    }

    _buildStorage(parent) {
        parent.add_child(sectionHeader('STORAGE', COLOR_WARNING));
        this._diskBox = new St.BoxLayout({vertical: true, style: 'spacing: 3px;'});
        parent.add_child(this._diskBox);
    }

    _buildPower(parent) {
        parent.add_child(sectionHeader('POWER', COLOR_NORMAL));
        this._powerRow = new MetricRow('—', {nameWidth: 94, valueWidth: 0, barWidth: 72});
        this._powerDetail = label('', `color: ${COLOR_MUTED}; font-size: 11px; margin-left: 14px;`);
        parent.add_child(this._powerRow.actor);
        parent.add_child(this._powerDetail);
    }

    _buildOs(parent) {
        this._osLabel = new St.Label({
            text: 'OS : —',
            style: `${MONO} color: ${COLOR_TEXT}; font-size: 13px; font-weight: bold;`,
        });
        this._kernelLabel = new St.Label({
            text: 'Kernel : —',
            style: `${MONO} color: ${COLOR_MUTED}; font-size: 11px;`,
        });
        parent.add_child(this._osLabel);
        parent.add_child(this._kernelLabel);
    }

    _buildCpu(parent) {
        parent.add_child(sectionHeader('PROCESSOR', COLOR_ACCENT));
        this._cpuModelLabel = label('—', `font-size: 11px;`);
        parent.add_child(this._cpuModelLabel);

        this._cpuSummary = label('', `color: ${COLOR_MUTED}; font-size: 11px;`);
        parent.add_child(this._cpuSummary);

        this._graph = new CpuGraph();
        parent.add_child(this._graph);

        // Per-core rows are created on the first sample, once the core count
        // is actually known, then only updated afterwards.
        this._coreGrid = new St.BoxLayout({vertical: false, style: 'spacing: 18px;'});
        this._coreColumns = [];
        for (let c = 0; c < 2; c++) {
            const column = new St.BoxLayout({vertical: true, style: 'spacing: 2px;'});
            this._coreColumns.push(column);
            this._coreGrid.add_child(column);
        }
        parent.add_child(this._coreGrid);
    }

    _buildGpu(parent) {
        parent.add_child(sectionHeader('GRAPHICS', COLOR_VIOLET));
        this._gpuBox = new St.BoxLayout({vertical: true, style: 'spacing: 3px;'});
        parent.add_child(this._gpuBox);
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

    // --- updates ----------------------------------------------------------

    setStatic(info) {
        this._hostLabel.text = info.hostname;
        this._osLabel.text = `OS : ${info.os} [${info.arch}]`;
        this._kernelLabel.text = `Kernel : ${info.kernel}`;
        if (info.avatar) {
            this._avatar.style =
                `width: ${AVATAR_SIZE}px; height: ${AVATAR_SIZE}px;` +
                `border-radius: ${AVATAR_SIZE / 2}px;` +
                `background-image: url("file://${info.avatar}");` +
                'background-size: cover;';
        }
    }

    setUptime(text) {
        this._uptimeLabel.text = text;
    }

    setPhrase(text) {
        this._phraseLabel.text = text;
    }

    updateCpu(cpu, {model, temps, freqs, history, capacity}) {
        this._cpuModelLabel.text = model;
        this._graph.setHistory(history, capacity);

        if (!cpu.ready) {
            this._cpuSummary.text = 'sampling…';
            return;
        }

        const pkg = temps.package;
        this._cpuSummary.text =
            `Load ${cpu.total.toFixed(1)}%   ` +
            (pkg !== null ? `Package ${Math.round(pkg)} °C` : 'Temp N/A');

        if (this._coreRows.length !== cpu.cores.length) {
            for (const row of this._coreRows)
                row.actor.destroy();
            this._coreRows = [];

            const perColumn = Math.ceil(cpu.cores.length / 2);
            cpu.cores.forEach((_, i) => {
                const row = new MetricRow(`C${i}`, {
                    dotColor: `rgb(${coreColor(i, cpu.cores.length)
                        .map(v => Math.round(v * 255)).join(',')})`,
                    nameWidth: 26,
                    valueWidth: 60,
                    barWidth: 46,
                    percentWidth: 34,
                    trailWidth: 52,
                });
                this._coreRows.push(row);
                this._coreColumns[Math.floor(i / perColumn)].add_child(row.actor);
            });
        }

        // coretemp reports one sensor per physical core, so on an SMT machine
        // two logical cores share a reading.
        const perCoreTemp = temps.cores;
        const threadsPerCore = perCoreTemp.length
            ? Math.max(1, Math.round(cpu.cores.length / perCoreTemp.length))
            : 0;

        cpu.cores.forEach((percent, i) => {
            const mhz = freqs[i];
            const temp = threadsPerCore ? perCoreTemp[Math.floor(i / threadsPerCore)] : undefined;
            this._coreRows[i].update({
                percent,
                value: mhz ? `${mhz} MHz` : '',
                trail: temp !== undefined ? `${Math.round(temp)} °C` : '',
            });
        });
    }

    updateMemory(mem) {
        if (!mem) {
            this._memRow.update({percent: 0, value: 'unavailable'});
            return;
        }
        this._memRow.update({
            percent: mem.percent,
            value: `${formatBytes(mem.used)} / ${formatBytes(mem.total)}`,
        });
        if (mem.swapTotal) {
            this._swapRow.update({
                percent: mem.swapPercent,
                value: `${formatBytes(mem.swapUsed)} / ${formatBytes(mem.swapTotal)}`,
                barColor: COLOR_VIOLET,
            });
        } else {
            this._swapRow.update({percent: 0, value: 'none'});
        }
        this._cacheLabel.text = `Cache ${formatBytes(mem.cached)}`;
    }

    updateDisks(disks) {
        if (this._diskRows.length !== disks.length) {
            for (const row of this._diskRows)
                row.actor.destroy();
            this._diskRows = disks.map(() => {
                const row = new MetricRow('', {
                    dotColor: COLOR_WARNING,
                    nameWidth: 76,
                    valueWidth: 86,
                    barWidth: 60,
                    percentWidth: 36,
                    trailWidth: 70,
                });
                this._diskBox.add_child(row.actor);
                return row;
            });
        }

        disks.forEach((disk, i) => {
            this._diskRows[i].update({
                name: disk.path,
                percent: disk.percent,
                value: `${formatBytes(disk.used)} / ${formatBytes(disk.size)}`,
                trail: `Free ${formatBytes(disk.free)}`,
            });
        });
    }

    updatePower(power) {
        if (!power) {
            this._powerRow.update({percent: 0, name: 'No battery'});
            this._powerDetail.text = this._acOnlyText ?? 'Running on mains';
            return;
        }
        this._powerRow.update({
            name: power.status === 'Full' ? 'Fully Charged' : power.status,
            percent: power.percent,
        });
        this._powerDetail.text =
            `Use ${power.watts.toFixed(2)} W    Time ${power.timeText}`;
    }

    updateNetwork(net, link) {
        const wifi = link?.ssid;
        this._wifiLabel.text = wifi ? `Wi-Fi : ${wifi}` : 'Network : wired / unknown';
        this._rateLabel.text = net.ready
            ? `↓ ${formatRate(net.rx)}    ↑ ${formatRate(net.tx)}`
            : '↓ sampling…    ↑ sampling…';

        const local = link?.addresses?.[0];
        this._localIpLabel.text = local
            ? `Local IP : ${local.addr}`
            : 'Local IP : —';
    }

    updatePublicIp(address) {
        this._publicIpLabel.text = `Public IP : ${address ?? '—'}`;
    }

    setPublicIpVisible(visible) {
        this._publicIpLabel.visible = visible;
    }

    updateGpus(gpus) {
        if (this._gpuBlocks.length !== gpus.length) {
            for (const block of this._gpuBlocks)
                block.actor.destroy();
            this._gpuBlocks = gpus.map(() => {
                const actor = new St.BoxLayout({vertical: true, style: 'spacing: 2px;'});
                const name = label('', 'font-size: 11px; font-weight: bold;');
                const vram = new MetricRow('VRAM', {
                    dotColor: COLOR_VIOLET,
                    nameWidth: 42,
                    valueWidth: 100,
                    barWidth: 56,
                    percentWidth: 36,
                });
                const detail = label('', `color: ${COLOR_MUTED}; font-size: 11px; margin-left: 14px;`);
                actor.add_child(name);
                actor.add_child(vram.actor);
                actor.add_child(detail);
                this._gpuBox.add_child(actor);
                return {actor, name, vram, detail};
            });
        }

        gpus.forEach((gpu, i) => {
            const block = this._gpuBlocks[i];
            block.name.text = `GPU${i}  ${gpu.name}`;
            if (gpu.detail) {
                block.vram.actor.visible = true;
                block.vram.update({
                    percent: gpu.detail.memPercent,
                    value: `${gpu.detail.memUsed}MB / ${gpu.detail.memTotal}MB`,
                    barColor: COLOR_VIOLET,
                });
                block.detail.text =
                    `Temp ${gpu.detail.temp} °C    ` +
                    `Clock ${gpu.detail.clock}/${gpu.detail.clockMax} MHz    ` +
                    `Util ${gpu.detail.util}%`;
            } else {
                // Integrated cards expose no counters; name only, no empty bar.
                block.vram.actor.visible = false;
                block.detail.text = 'no counters exposed';
            }
        });
    }
});
