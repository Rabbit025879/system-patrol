import GLib from 'gi://GLib';

const MEMINFO_PATH = '/proc/meminfo';

// /proc/meminfo reports kibibytes.
const KIB = 1024;

export function readMemory() {
    let text;
    try {
        const [ok, bytes] = GLib.file_get_contents(MEMINFO_PATH);
        if (!ok)
            return null;
        text = new TextDecoder().decode(bytes);
    } catch (e) {
        logError(e, 'system-patrol: could not read /proc/meminfo');
        return null;
    }

    const fields = {};
    for (const line of text.split('\n')) {
        const match = line.match(/^(\w+):\s+(\d+)/);
        if (match)
            fields[match[1]] = Number(match[2]) * KIB;
    }

    const total = fields.MemTotal ?? 0;
    if (!total)
        return null;

    // MemAvailable is the kernel's own estimate of what a new workload could
    // claim; it is far more honest than MemFree, which ignores reclaimable
    // cache. Fall back only on kernels too old to publish it.
    const available = fields.MemAvailable ?? (fields.MemFree ?? 0) + (fields.Cached ?? 0);
    const used = Math.max(0, total - available);

    const swapTotal = fields.SwapTotal ?? 0;
    const swapUsed = Math.max(0, swapTotal - (fields.SwapFree ?? 0));

    return {
        total,
        used,
        available,
        cached: fields.Cached ?? 0,
        percent: (used / total) * 100,
        swapTotal,
        swapUsed,
        swapPercent: swapTotal ? (swapUsed / swapTotal) * 100 : 0,
    };
}
