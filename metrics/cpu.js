import GLib from 'gi://GLib';

const STAT_PATH = '/proc/stat';
const CPUINFO_PATH = '/proc/cpuinfo';
const HWMON_ROOT = '/sys/class/hwmon';

// Enough points to show a minute or so of history at the HUD's refresh rate.
const HISTORY_LENGTH = 60;

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return null;
        return new TextDecoder().decode(bytes);
    } catch (e) {
        return null;
    }
}

// A /proc/stat cpu line is: cpu<n> user nice system idle iowait irq softirq steal ...
// Everything that is not idle or iowait counts as busy time.
function parseStatLine(line) {
    const fields = line.split(/\s+/).slice(1).map(Number);
    if (fields.length < 4 || fields.some(Number.isNaN))
        return null;

    const total = fields.reduce((sum, n) => sum + n, 0);
    const idle = fields[3] + (fields[4] ?? 0);
    return {total, idle};
}

// coretemp exposes "Package id 0" plus one "Core N" per physical core, which
// is fewer entries than /proc/stat's logical CPUs on an SMT machine.
function findCoretemp() {
    try {
        const dir = GLib.Dir.open(HWMON_ROOT, 0);
        let name;
        while ((name = dir.read_name()) !== null) {
            const path = GLib.build_filenamev([HWMON_ROOT, name]);
            const label = readText(GLib.build_filenamev([path, 'name']))?.trim();
            if (label === 'coretemp' || label === 'k10temp' || label === 'zenpower') {
                dir.close();
                return path;
            }
        }
        dir.close();
    } catch (e) {
        // No hwmon at all; temperatures are simply unavailable.
    }
    return null;
}

export class CpuMonitor {
    constructor() {
        // /proc/stat counters are monotonic totals since boot, so a usage
        // percentage only exists relative to a previous sample. The first
        // read therefore reports zeroes rather than a bogus since-boot average.
        this._prev = null;
        this._hwmonPath = findCoretemp();
        this._history = [];
    }

    read() {
        const text = readText(STAT_PATH);
        if (!text)
            return {total: 0, cores: [], ready: false};

        const samples = [];
        for (const line of text.split('\n')) {
            if (!line.startsWith('cpu'))
                break; // cpu lines are always first and contiguous
            const parsed = parseStatLine(line);
            if (parsed)
                samples.push(parsed);
        }

        if (!samples.length)
            return {total: 0, cores: [], ready: false};

        const prev = this._prev;
        this._prev = samples;
        if (!prev || prev.length !== samples.length)
            return {total: 0, cores: [], ready: false};

        const percentFor = i => {
            const dTotal = samples[i].total - prev[i].total;
            const dIdle = samples[i].idle - prev[i].idle;
            if (dTotal <= 0)
                return 0;
            return Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100));
        };

        const total = percentFor(0);
        const cores = samples.slice(1).map((_, i) => percentFor(i + 1));

        this._history.push(cores);
        if (this._history.length > HISTORY_LENGTH)
            this._history.shift();

        return {total, cores, ready: true};
    }

    // Per-core load over time, oldest first, for the HUD graph.
    get history() {
        return this._history;
    }

    get historyLength() {
        return HISTORY_LENGTH;
    }

    modelName() {
        const match = readText(CPUINFO_PATH)?.match(/^model name\s*:\s*(.+)$/m);
        return match ? match[1].trim() : 'Unknown CPU';
    }

    // Current clock per logical core, in MHz. Returns [] on machines whose
    // cpuinfo omits "cpu MHz" (common on some ARM kernels).
    readFrequencies() {
        const text = readText(CPUINFO_PATH);
        if (!text)
            return [];

        const freqs = [];
        for (const line of text.split('\n')) {
            const match = line.match(/^cpu MHz\s*:\s*([\d.]+)/);
            if (match)
                freqs.push(Math.round(Number(match[1])));
        }
        return freqs;
    }

    // {package, cores: []} in °C, both possibly null/empty.
    readTemperatures() {
        if (!this._hwmonPath)
            return {package: null, cores: []};

        let packageTemp = null;
        const cores = [];

        for (let i = 1; i <= 32; i++) {
            const label = readText(
                GLib.build_filenamev([this._hwmonPath, `temp${i}_label`]))?.trim();
            const raw = readText(
                GLib.build_filenamev([this._hwmonPath, `temp${i}_input`]));
            if (raw === null)
                continue;

            const celsius = Number(raw) / 1000;
            if (Number.isNaN(celsius))
                continue;

            if (label && /^Package/i.test(label))
                packageTemp = celsius;
            else if (!label || /^Core/i.test(label))
                cores.push(celsius);
        }

        // k10temp and friends report a single unlabelled sensor.
        if (packageTemp === null && cores.length)
            packageTemp = Math.max(...cores);

        return {package: packageTemp, cores};
    }
}
