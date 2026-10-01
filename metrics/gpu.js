import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// One call returns everything, so the HUD never spawns more than one process
// per refresh no matter how many GPUs are installed.
const NVIDIA_QUERY = [
    'nvidia-smi',
    '--query-gpu=name,memory.used,memory.total,temperature.gpu,clocks.sm,clocks.max.sm,utilization.gpu',
    '--format=csv,noheader,nounits',
];

const DRM_ROOT = '/sys/class/drm';

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch (e) {
        return null;
    }
}

// Integrated GPUs have no nvidia-smi equivalent, so they are listed by name
// only -- better than pretending the card is not there.
function integratedCards() {
    const cards = [];
    try {
        const dir = GLib.Dir.open(DRM_ROOT, 0);
        let name;
        while ((name = dir.read_name()) !== null) {
            if (!/^card\d+$/.test(name))
                continue;
            const uevent = readText(GLib.build_filenamev([DRM_ROOT, name, 'device', 'uevent']));
            if (!uevent)
                continue;
            const driver = uevent.match(/^DRIVER=(.+)$/m)?.[1];
            if (!driver || driver === 'nvidia')
                continue; // nvidia-smi covers those with real numbers
            cards.push({
                name: driver === 'i915' || driver === 'xe'
                    ? 'Intel Integrated Graphics'
                    : `${driver} GPU`,
                driver,
                detail: null,
            });
        }
        dir.close();
    } catch (e) {
        logError(e, 'cathud: could not enumerate DRM cards');
    }
    return cards;
}

function parseNvidia(stdout) {
    const gpus = [];
    for (const line of stdout.split('\n')) {
        if (!line.trim())
            continue;
        const f = line.split(',').map(s => s.trim());
        if (f.length < 7)
            continue;
        const [name, memUsed, memTotal, temp, clock, clockMax, util] = f;
        gpus.push({
            name,
            driver: 'nvidia',
            detail: {
                memUsed: Number(memUsed),
                memTotal: Number(memTotal),
                memPercent: Number(memTotal) ? (Number(memUsed) / Number(memTotal)) * 100 : 0,
                temp: Number(temp),
                clock: Number(clock),
                clockMax: Number(clockMax),
                util: Number(util),
            },
        });
    }
    return gpus;
}

// Callback-based for the same reason readDisks is: a promise resolved from a
// GIO callback waits for the main loop to wake for some other reason.
// Calls onDone exactly once; never throws.
export function readGpus(onDone, cancellable = null) {
    let proc;
    try {
        proc = Gio.Subprocess.new(NVIDIA_QUERY,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    } catch (e) {
        // No nvidia-smi on this machine; report whatever sysfs knows.
        onDone(integratedCards());
        return;
    }

    proc.communicate_utf8_async(null, cancellable, (source, result) => {
        let nvidia = [];
        try {
            const [, stdout] = source.communicate_utf8_finish(result);
            if (source.get_successful() && stdout)
                nvidia = parseNvidia(stdout);
        } catch (e) {
            // A cancelled or failed query degrades to the sysfs list.
        }
        onDone([...nvidia, ...integratedCards()]);
    });
}
