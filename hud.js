import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {MascotIcon} from './mascotIcon.js';

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
const COLOR_BG = 'rgba(24, 27, 31, 0.99)';
const COLOR_PANEL = 'rgba(38, 42, 48, 0.75)';
const COLOR_BORDER = 'rgba(122, 134, 148, 0.35)';
const COLOR_TRACK = 'rgba(122, 134, 148, 0.30)';

// Settings keys that shape the glass; each is an integer percentage.
const GLASS_KEYS = ['glass-mode', 'glass-tint', 'glass-blur', 'glass-brightness'];

// Shell themes, and blur extensions such as Blur My Shell, style and blur
// chrome actors carrying the popup classes, so this one makes the HUD follow
// them.
const SYSTEM_STYLE_CLASS = 'popup-menu-content';

const WARNING_PERCENT = 75;
const CRITICAL_PERCENT = 90;

const BAR_HEIGHT = 9;
const AVATAR_SIZE = 64;
// A floor, not a fixed size: the graph grows to take up any slack in its column.
const GRAPH_MIN_HEIGHT = 96;
// Upper bounds the graph's vertical axis steps through as load rises.
const GRAPH_SCALES = [25, 50, 100];

// One scale for the whole HUD, so bumping legibility is a single edit.
const FONT_BODY = 14;
const FONT_SMALL = 12;
const FONT_SECTION = 13;
const FONT_HOST = 20;
const FONT_OS = 16;

const MONO = 'font-family: monospace;';

// Every bar row in the left column shares these, so the bars all start and
// end on the same two vertical lines whichever section they belong to.
const LEFT_GRID = {nameWidth: 82, valueWidth: 96, barWidth: 64, percentWidth: 40, trailWidth: 76};
// A row with no value cell lets its name span both columns; the extra 8 is
// the gap that would have sat between them.
const LEFT_WIDE_NAME = LEFT_GRID.nameWidth + LEFT_GRID.valueWidth + 8;

// Keys match the 'mascot' enum in the gschema.
const MASCOT_CHOICES = [
    {key: 'cat', glyph: '🐈', name: 'Cat'},
    {key: 'raccoon', glyph: '🦝', name: 'Raccoon'},
];

function colorFor(percent) {
    if (percent >= CRITICAL_PERCENT)
        return COLOR_CRITICAL;
    if (percent >= WARNING_PERCENT)
        return COLOR_WARNING;
    return COLOR_NORMAL;
}

// A battery reads the other way round from a load: full is good, empty is
// the alarm. Run through colorFor it showed a fully charged battery in red.
function batteryColor(percent) {
    if (percent <= 15)
        return COLOR_CRITICAL;
    if (percent <= 30)
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
    // Spread hues around the wheel, but step by a number coprime with most
    // core counts so adjacent cores are not adjacent hues -- neighbouring
    // traces stay tellable apart when they overlap.
    const hue = ((index * 5) % Math.max(1, count)) / Math.max(1, count) * 360;
    const s = 0.95;
    const l = 0.60;
    const k = n => (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
}

function label(text, style = '') {
    return new St.Label({
        text,
        style: `${MONO} color: ${COLOR_TEXT}; font-size: ${FONT_BODY}px; ${style}`,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

// A small coloured chip standing in for an icon, as in the reference layout.
function sectionHeader(title, accent) {
    const row = new St.BoxLayout({vertical: false, style: 'spacing: 8px; margin: 16px 0 7px 0;'});
    row.add_child(new St.Widget({
        style: `width: 12px; height: 12px; border-radius: 3px; background-color: ${accent};`,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    // No letter-spacing here on purpose: St leaves it out of a label's
    // natural width, so every heading came out clipped by one character.
    row.add_child(new St.Label({
        text: title,
        style: `${MONO} color: ${COLOR_MUTED}; font-size: ${FONT_SECTION}px;` +
            'font-weight: bold;',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    return row;
}

// A fixed-width track with a proportional fill. The fill is a child widget
// whose width is restyled on each update rather than re-created.
// The track expands to whatever its row has spare, so every row in a column
// ends at the same edge instead of leaving a ragged gap; minWidth is only the
// floor. The fill is therefore sized from the allocated width, and resized
// whenever that changes.
class Bar {
    constructor(minWidth) {
        this._percent = 0;
        this._color = null;
        this.actor = new St.Widget({
            style: `min-width: ${minWidth}px; height: ${BAR_HEIGHT}px;` +
                `background-color: ${COLOR_TRACK}; border-radius: ${BAR_HEIGHT / 2}px;`,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // The fill carries its own width and height and sits at the track's
        // origin under the default fixed layout. It used to rely on a
        // BinLayout stretching it to the track's height, but BinLayout ignores
        // a child's alignment unless the child expands, so the fill was
        // allocated at its natural height -- zero -- and never painted.
        this._fill = new St.Widget();
        this.actor.add_child(this._fill);
        this.actor.connect('notify::width', () => this._apply());
    }

    set(percent, color = null) {
        this._percent = Math.max(0, Math.min(100, percent));
        this._color = color;
        this._apply();
    }

    _apply() {
        const width = this.actor.width;
        if (width <= 0)
            return;
        // A non-zero load should always leave at least a visible sliver.
        const filled = this._percent > 0
            ? Math.max(2, Math.round(width * this._percent / 100))
            : 0;
        this._fill.style =
            `width: ${filled}px; height: ${BAR_HEIGHT}px;` +
            `background-color: ${this._color ?? colorFor(this._percent)};` +
            `border-radius: ${BAR_HEIGHT / 2}px;`;
    }
}

// name | value | bar | percent | trailing, with every piece optional-width so
// the same class serves memory, storage, power and the per-core list.
class MetricRow {
    constructor(name, {
        dotColor = null, nameWidth = 48, valueWidth = 92, barWidth = 80,
        percentWidth = 40, trailWidth = 0,
    } = {}) {
        this.actor = new St.BoxLayout({vertical: false, style: 'spacing: 8px;'});

        this._dot = new St.Widget({
            style: `width: 9px; height: 9px; border-radius: 5px;` +
                `background-color: ${dotColor ?? COLOR_NORMAL};`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this._dot);

        this._name = label(name, `width: ${nameWidth}px;`);
        this._tooltipText = '';
        this._tooltip = null;
        this._name.reactive = true;
        this._name.track_hover = true;
        this._name.connect('notify::hover', () => this._syncTooltip());
        this._name.connect('destroy', () => this._hideTooltip());
        this._value = label('',
            `width: ${valueWidth}px; color: ${COLOR_MUTED}; font-size: ${FONT_SMALL}px;`);
        this._bar = new Bar(barWidth);
        this._percent = label('', `width: ${percentWidth}px; font-size: ${FONT_SMALL}px;`);

        this.actor.add_child(this._name);
        // valueWidth 0 means no value cell at all, not an empty one: an empty
        // label would still cost a gap and push the bar out of line.
        if (valueWidth)
            this.actor.add_child(this._value);
        this.actor.add_child(this._bar.actor);
        this.actor.add_child(this._percent);

        if (trailWidth) {
            this._trail = label('',
                `width: ${trailWidth}px; color: ${COLOR_MUTED}; font-size: ${FONT_SMALL}px;`);
            this.actor.add_child(this._trail);
        }
    }

    // Shows the full text next to the name, but only when the name column had
    // to ellipsize it; a name that fits needs no help.
    _syncTooltip() {
        const ellipsized = this._name.clutter_text.get_layout().is_ellipsized();
        if (!this._name.hover || !ellipsized || !this._tooltipText) {
            this._hideTooltip();
            return;
        }
        if (!this._tooltip) {
            this._tooltip = new St.Label({
                text: this._tooltipText,
                style: `${MONO} color: ${COLOR_TEXT}; font-size: ${FONT_SMALL}px; ` +
                    `background-color: ${COLOR_BG}; border: 1px solid ${COLOR_BORDER}; ` +
                    'border-radius: 6px; padding: 4px 8px;',
            });
            Main.uiGroup.add_child(this._tooltip);
        }
        const [x, y] = this._name.get_transformed_position();
        this._tooltip.set_position(Math.round(x), Math.round(y + this._name.height + 4));
    }

    _hideTooltip() {
        this._tooltip?.destroy();
        this._tooltip = null;
    }

    update({percent = 0, value = '', trail = '', name = null, tooltip = '', dotColor = null, barColor = null}) {
        if (name !== null)
            this._name.text = name;
        this._tooltipText = tooltip;
        if (dotColor)
            this._dot.style =
                `width: 9px; height: 9px; border-radius: 5px; background-color: ${dotColor};`;
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
            style: `background-color: ${COLOR_PANEL}; border-radius: 8px; margin: 4px 0;` +
                `min-height: ${GRAPH_MIN_HEIGHT}px;`,
            y_expand: true,
        });
        this._history = [];
        this._capacity = 60;
        this.connect('repaint', area => this._draw(area));
    }

    setHistory(history, capacity) {
        this._history = history;
        this._capacity = capacity;

        // Fit the vertical scale to the recent peak. On a fixed 0-100% axis an
        // idle machine draws every trace along the bottom edge and leaves the
        // rest of the plot blank.
        let peak = 0;
        for (const sample of history) {
            for (const value of sample)
                peak = Math.max(peak, value);
        }
        this.scaleMax = GRAPH_SCALES.find(limit => peak <= limit) ?? 100;
        this.queue_repaint();
    }

    _draw(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const padX = 8;
        const padY = 8;
        const plotW = Math.max(1, width - padX * 2);
        const plotH = Math.max(1, height - padY * 2);

        // Guide line at half of the current scale.
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

        const max = this.scaleMax ?? 100;
        const coreCount = samples[samples.length - 1].length;
        // Oldest sample pins to the left edge of the window, so the trace
        // scrolls instead of stretching as history fills up.
        const stepX = plotW / Math.max(1, this._capacity - 1);
        const offsetX = padX + plotW - (samples.length - 1) * stepX;

        cr.setLineWidth(2);
        for (let core = 0; core < coreCount; core++) {
            const [r, g, b] = coreColor(core, coreCount);
            cr.setSourceRGBA(r, g, b, 1);
            let started = false;
            for (let i = 0; i < samples.length; i++) {
                const value = samples[i][core];
                if (value === undefined)
                    continue;
                const x = offsetX + i * stepX;
                const y = padY + plotH -
                    (Math.max(0, Math.min(max, value)) / max) * plotH;
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

export const PatrolHud = GObject.registerClass({
    // 'closed' has to be declared here; emitting an undeclared signal throws.
    Signals: {'closed': {}},
},
class PatrolHud extends St.BoxLayout {
    _init(extensionPath, settings) {
        super._init({
            vertical: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        this._blur = null;
        try {
            this._blur = new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND});
            this.add_effect_with_name('glass-blur', this._blur);
        } catch (e) {
            // No backdrop blur available; the tint alone still reads as glass.
            console.warn(`System Patrol: blur unavailable: ${e.message}`);
            this._blur = null;
        }

        this._applyGlass(settings);
        const glassIds = GLASS_KEYS.map(
            key => settings.connect(`changed::${key}`, () => this._applyGlass(settings)));
        this.connect('destroy', () => glassIds.forEach(id => settings.disconnect(id)));

        this._coreRows = [];
        this._diskRows = [];
        this._gpuBlocks = [];
        this._backdrop = null;
        this._isOpen = false;
        this._userMoved = false;

        this._buildHeader(extensionPath, settings);

        const columns = new St.BoxLayout({vertical: false, style: 'spacing: 34px;'});
        const left = new St.BoxLayout({vertical: true});
        const right = new St.BoxLayout({vertical: true, x_expand: true});

        // Five compact sections on the left, the processor alone on the
        // right. The columns rarely come out the same height, so each has
        // something that absorbs the difference -- the graph on the right,
        // spacers between sections on the left -- and both always end on the
        // same line. In practice the left is the taller one, so the slack
        // becomes a bigger graph rather than blank space.
        const spacer = () => new St.Widget({y_expand: true});
        this._buildNetwork(left);
        left.add_child(spacer());
        this._buildMemory(left);
        left.add_child(spacer());
        this._buildStorage(left);
        left.add_child(spacer());
        this._buildPower(left);
        left.add_child(spacer());
        this._buildGpu(left);

        this._buildCpu(right);

        columns.add_child(left);
        columns.add_child(right);
        this.add_child(columns);

        this._setupDrag();

        // Content can change the HUD's size while it is open -- a disk
        // appearing, the core rows being built on the first sample -- so
        // centring has to follow the allocation, not happen once.
        this.connect('notify::width', () => this._centre());
        this.connect('notify::height', () => this._centre());

        this.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    // Liquid glass: a light tint over a blurred backdrop. The blur always
    // fills the actor's whole rectangle and cannot follow a rounded corner, so
    // the glass is square to keep the tint and the blur lined up.
    _applyGlass(settings) {
        const mode = settings.get_string('glass-mode');
        const system = mode === 'system';
        const glass = mode === 'glass';

        // Themes and blur extensions look for the class when the HUD is added
        // to the stage, so a change made while it is open applies from the
        // next open.
        if (system)
            this.add_style_class_name(SYSTEM_STYLE_CLASS);
        else
            this.remove_style_class_name(SYSTEM_STYLE_CLASS);

        const padding = 'padding: 20px 26px 24px 26px;';
        if (system) {
            // Background, border, radius and shadow all come from the theme.
            this.style = padding;
        } else if (glass) {
            const tint = settings.get_int('glass-tint') / 100;
            this.style = `background-color: rgba(44, 50, 60, ${tint}); ${padding}`;
        } else {
            this.style = `background-color: ${COLOR_BG}; border: 1px solid ${COLOR_BORDER};` +
                `border-radius: 18px; ${padding}` +
                'box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);';
        }

        // The blur costs a GPU pass per frame, so it only runs for the glass.
        if (this._blur) {
            const radius = settings.get_int('glass-blur');
            this._blur.radius = radius;
            this._blur.brightness = settings.get_int('glass-brightness') / 100;
            // A zero radius would still pay for the offscreen pass.
            this._blur.enabled = glass && radius > 0;
        }
    }

    // The backdrop blur reads the pixels behind the HUD, and a redraw that
    // covers only part of the HUD leaves its previous, tinted frame in the
    // rest of them, which the blur then picks up as a dark flicker. Queueing
    // the whole actor widens every redraw to the full box.
    _invalidate() {
        if (this._isOpen && this._blur?.enabled)
            this.queue_redraw();
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
            style: `${MONO} color: ${COLOR_MUTED}; font-size: ${FONT_SMALL}px;`,
        }));
        this._hostLabel = new St.Label({
            text: '—',
            style: `${MONO} color: ${COLOR_TEXT}; font-size: ${FONT_HOST}px; font-weight: bold;`,
        });
        identity.add_child(this._hostLabel);
        this._uptimeLabel = new St.Label({
            text: '',
            style: `${MONO} color: ${COLOR_MUTED}; font-size: ${FONT_SMALL}px;`,
        });
        identity.add_child(this._uptimeLabel);
        header.add_child(identity);

        // The OS and kernel lines sit in what used to be dead space between
        // the identity block and the mascot.
        header.add_child(new St.Widget({x_expand: true}));
        const osBox = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        this._buildOs(osBox);
        header.add_child(osBox);
        header.add_child(new St.Widget({x_expand: true}));

        // The mascot speaks for itself -- its gait already says how busy the
        // machine is, so no caption. Underneath sits a switch between the two.
        const mascotBox = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 6px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.mascot = new MascotIcon(extensionPath, settings);
        this.mascot.onFrame = () => this._invalidate();
        mascotBox.add_child(this.mascot);
        mascotBox.add_child(this._buildMascotSwitch(settings));
        header.add_child(mascotBox);

        this.add_child(header);
    }

    // A two-segment toggle writing straight to the 'mascot' setting. MascotIcon
    // already listens for that key, so the animation swaps immediately, and
    // the preferences window stays in step because both read the same key.
    _buildMascotSwitch(settings) {
        const pill = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            style: `background-color: ${COLOR_TRACK}; border-radius: 11px; padding: 2px;`,
        });

        const segments = MASCOT_CHOICES.map(({key, glyph, name}) => {
            const button = new St.Button({
                label: glyph,
                can_focus: true,
                accessible_name: name,
            });
            button.connect('clicked', () => settings.set_string('mascot', key));
            pill.add_child(button);
            return {key, button};
        });

        const restyle = () => {
            const current = settings.get_string('mascot');
            for (const {key, button} of segments) {
                const active = key === current;
                button.style =
                    `font-size: ${FONT_SMALL}px; padding: 2px 12px; border-radius: 9px;` +
                    `background-color: ${active ? COLOR_ACCENT : 'transparent'};`;
                button.opacity = active ? 255 : 150;
            }
        };
        restyle();

        const changedId = settings.connect('changed::mascot', restyle);
        pill.connect('destroy', () => settings.disconnect(changedId));
        return pill;
    }

    _buildNetwork(parent) {
        parent.add_child(sectionHeader('NETWORK', COLOR_ACCENT));
        this._wifiLabel = label('Wi-Fi : —');
        this._rateLabel = label('', `color: ${COLOR_MUTED}; font-size: ${FONT_SMALL}px;`);
        this._publicIpLabel = label('Public IP : —',
            `color: ${COLOR_MUTED}; font-size: ${FONT_SMALL}px;`);
        this._localIpLabel = label('Local IP : —',
            `color: ${COLOR_MUTED}; font-size: ${FONT_SMALL}px;`);
        parent.add_child(this._wifiLabel);
        parent.add_child(this._rateLabel);
        parent.add_child(this._publicIpLabel);
        parent.add_child(this._localIpLabel);
    }

    _buildMemory(parent) {
        parent.add_child(sectionHeader('MEMORY', COLOR_NORMAL));
        this._memRow = new MetricRow('RAM', LEFT_GRID);
        this._swapRow = new MetricRow('Swap', {...LEFT_GRID, dotColor: COLOR_VIOLET});
        parent.add_child(this._memRow.actor);
        parent.add_child(this._swapRow.actor);
    }

    _buildStorage(parent) {
        parent.add_child(sectionHeader('STORAGE', COLOR_WARNING));
        this._diskBox = new St.BoxLayout({vertical: true, style: 'spacing: 3px;'});
        parent.add_child(this._diskBox);
    }

    _buildPower(parent) {
        parent.add_child(sectionHeader('POWER', COLOR_NORMAL));
        this._powerRow = new MetricRow('—',
            {...LEFT_GRID, nameWidth: LEFT_WIDE_NAME, valueWidth: 0});
        this._powerDetail = label('',
            `color: ${COLOR_MUTED}; font-size: ${FONT_SMALL}px; margin-left: 17px;`);
        parent.add_child(this._powerRow.actor);
        parent.add_child(this._powerDetail);
    }

    _buildOs(parent) {
        this._osLabel = new St.Label({
            text: 'OS : —',
            style: `${MONO} color: ${COLOR_TEXT}; font-size: ${FONT_OS}px; font-weight: bold;`,
        });
        this._kernelLabel = new St.Label({
            text: 'Kernel : —',
            style: `${MONO} color: ${COLOR_MUTED}; font-size: ${FONT_SMALL}px;`,
        });
        parent.add_child(this._osLabel);
        parent.add_child(this._kernelLabel);
    }

    _buildCpu(parent) {
        parent.add_child(sectionHeader('PROCESSOR', COLOR_ACCENT));
        this._cpuModelLabel = label('—');
        parent.add_child(this._cpuModelLabel);

        this._cpuSummary = label('', `color: ${COLOR_MUTED}; font-size: ${FONT_SMALL}px;`);
        parent.add_child(this._cpuSummary);

        this._graph = new CpuGraph();
        parent.add_child(this._graph);

        // Per-core rows are created on the first sample, once the core count
        // is actually known, then only updated afterwards.
        this._coreGrid = new St.BoxLayout({vertical: false, style: 'spacing: 22px;'});
        this._coreColumns = [];
        for (let c = 0; c < 2; c++) {
            const column = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'spacing: 2px;',
            });
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
            // Once it has been placed by hand, stop pulling it back.
            this._userMoved = true;
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

        this._userMoved = false;
        this._centre();

        if (this._blur?.enabled) {
            // The blur samples the screen behind the HUD, so a HUD that fades
            // in or slides, or that is painted before it has been centred,
            // blurs the wrong pixels for a frame and flashes. It stays
            // invisible until _centre has placed it, then appears at once.
            this.opacity = 0;
            this._revealOnCentre = true;
        } else {
            // The slide runs on translation_y, not y, so it cannot fight the
            // centring that _centre does through set_position.
            this.opacity = 0;
            this.translation_y = -12;
            this.ease({
                opacity: 255,
                translation_y: 0,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        this.grab_key_focus();
    }

    // Centres on the allocated size rather than the preferred one. Asking for
    // the preferred size straight after addChrome measures the actor before
    // its CSS padding and font sizes have resolved, which put the HUD off
    // centre by however much the style adds.
    _centre() {
        if (!this._isOpen || this._userMoved)
            return;

        const width = this.width;
        const height = this.height;
        // Zero until the first allocation lands; the notify handlers below
        // call back in once it does.
        if (width <= 0 || height <= 0)
            return;

        const monitor = Main.layoutManager.primaryMonitor;
        this.set_position(
            monitor.x + Math.floor((monitor.width - width) / 2),
            monitor.y + Math.floor((monitor.height - height) / 2));

        if (this._revealOnCentre) {
            this._revealOnCentre = false;
            this.opacity = 255;
        }
    }

    close() {
        if (!this._isOpen)
            return;
        this._isOpen = false;

        // Closing mid-slide would otherwise leave the transition running and
        // translation_y parked off zero, offsetting the next open.
        this.remove_all_transitions();
        this.translation_y = 0;
        this._revealOnCentre = false;

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
        this._invalidate();
        this._uptimeLabel.text = text;
    }

    updateCpu(cpu, {model, temps, freqs, history, capacity, coreIds}) {
        this._invalidate();
        this._cpuModelLabel.text = model;
        this._graph.setHistory(history, capacity);

        if (!cpu.ready) {
            this._cpuSummary.text = 'sampling…';
            return;
        }

        const pkg = temps.package;
        this._cpuSummary.text =
            `Load ${cpu.total.toFixed(1)}%   ` +
            (pkg !== null ? `Package ${Math.round(pkg)} °C` : 'Temp N/A') +
            `   Graph 0–${this._graph.scaleMax}%`;

        if (this._coreRows.length !== cpu.cores.length) {
            for (const row of this._coreRows)
                row.actor.destroy();
            this._coreRows = [];

            const perColumn = Math.ceil(cpu.cores.length / 2);
            cpu.cores.forEach((_, i) => {
                const row = new MetricRow(`C${i}`, {
                    dotColor: `rgb(${coreColor(i, cpu.cores.length)
                        .map(v => Math.round(v * 255)).join(',')})`,
                    nameWidth: 30,
                    valueWidth: 64,
                    barWidth: 48,
                    percentWidth: 36,
                    trailWidth: 44,
                });
                this._coreRows.push(row);
                this._coreColumns[Math.floor(i / perColumn)].add_child(row.actor);
            });
        }

        // coretemp has one sensor per physical core, so SMT siblings share a
        // reading. Which threads are siblings comes from the kernel topology,
        // not from thread order -- see readCoreIds in metrics/cpu.js.
        cpu.cores.forEach((percent, i) => {
            const mhz = freqs[i];
            const coreId = coreIds[i];
            const temp = coreId === undefined || coreId === null
                ? undefined
                : temps.byCoreId.get(coreId);
            this._coreRows[i].update({
                percent,
                value: mhz ? `${mhz} MHz` : '',
                trail: temp !== undefined ? `${Math.round(temp)} °C` : '',
            });
        });
    }

    updateMemory(mem) {
        this._invalidate();
        if (!mem) {
            this._memRow.update({percent: 0, value: 'unavailable'});
            return;
        }
        this._memRow.update({
            percent: mem.percent,
            value: `${formatBytes(mem.used)} / ${formatBytes(mem.total)}`,
            trail: `Cache ${formatBytes(mem.cached)}`,
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
    }

    updateDisks(disks) {
        this._invalidate();
        if (this._diskRows.length !== disks.length) {
            for (const row of this._diskRows)
                row.actor.destroy();
            this._diskRows = disks.map(() => {
                const row = new MetricRow('', {...LEFT_GRID, dotColor: COLOR_WARNING});
                this._diskBox.add_child(row.actor);
                return row;
            });
        }

        disks.forEach((disk, i) => {
            this._diskRows[i].update({
                name: disk.name,
                tooltip: disk.path,
                percent: disk.percent,
                value: `${formatBytes(disk.used)} / ${formatBytes(disk.size)}`,
                trail: `Free ${formatBytes(disk.free)}`,
            });
        });
    }

    updatePower(power) {
        this._invalidate();
        if (!power) {
            this._powerRow.update({percent: 0, name: 'No battery'});
            this._powerDetail.text = 'Running on mains';
            this._powerDetail.visible = true;
            return;
        }
        this._powerRow.update({
            name: power.status === 'Full' ? 'Fully Charged' : power.status,
            percent: power.percent,
            trail: `${power.watts.toFixed(2)} W`,
            barColor: batteryColor(power.percent),
        });
        // Time remaining only means something while running on the battery.
        const discharging = power.status === 'Discharging';
        this._powerDetail.visible = discharging;
        if (discharging)
            this._powerDetail.text = `${power.timeText} remaining`;
    }

    updateNetwork(net, link) {
        this._invalidate();
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
        this._invalidate();
        this._publicIpLabel.text = `Public IP : ${address ?? '—'}`;
    }

    setPublicIpVisible(visible) {
        this._publicIpLabel.visible = visible;
    }

    updateGpus(gpus) {
        this._invalidate();
        if (this._gpuBlocks.length !== gpus.length) {
            for (const block of this._gpuBlocks)
                block.actor.destroy();
            this._gpuBlocks = gpus.map(() => {
                const actor = new St.BoxLayout({vertical: true, style: 'spacing: 2px;'});
                const name = label('', 'font-weight: bold;');
                const vram = new MetricRow('VRAM', {...LEFT_GRID, dotColor: COLOR_VIOLET});
                const detail = label('',
                    `color: ${COLOR_MUTED}; font-size: ${FONT_SMALL}px; margin-left: 17px;`);
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
                block.detail.visible = true;
                block.vram.update({
                    percent: gpu.detail.memPercent,
                    value: `${gpu.detail.memUsed}MB / ${gpu.detail.memTotal}MB`,
                    barColor: COLOR_VIOLET,
                    trail: `${gpu.detail.temp} °C`,
                });
                block.detail.text =
                    `Clock ${gpu.detail.clock}/${gpu.detail.clockMax} MHz    ` +
                    `Util ${gpu.detail.util}%`;
            } else {
                // Integrated cards expose no counters: name only, rather than
                // an empty bar and a line saying so.
                block.vram.actor.visible = false;
                block.detail.visible = false;
            }
        });
    }
});
