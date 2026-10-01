import GLib from 'gi://GLib';

const STAT_PATH = '/proc/stat';
const CPUINFO_PATH = '/proc/cpuinfo';

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return null;
        return new TextDecoder().decode(bytes);
    } catch (e) {
        logError(e, `cathud: could not read ${path}`);
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

export class CpuMonitor {
    constructor() {
        // /proc/stat counters are monotonic totals since boot, so a usage
        // percentage only exists relative to a previous sample. The first
        // read therefore reports zeroes rather than a bogus since-boot average.
        this._prev = null;
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

        return {
            total: percentFor(0),
            cores: samples.slice(1).map((_, i) => percentFor(i + 1)),
            ready: true,
        };
    }

    // Current clock per core, in MHz. Returns [] on machines whose cpuinfo
    // omits "cpu MHz" (common on some ARM kernels).
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
}
