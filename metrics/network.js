import GLib from 'gi://GLib';

const NET_ROOT = '/sys/class/net';

function readValue(iface, file) {
    const path = GLib.build_filenamev([NET_ROOT, iface, file]);
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return null;
        return new TextDecoder().decode(bytes).trim();
    } catch (e) {
        // Interfaces come and go (VPNs, docks); a vanished one is not an error.
        return null;
    }
}

function interfaces() {
    const dir = GLib.Dir.open(NET_ROOT, 0);
    const names = [];
    let name;
    while ((name = dir.read_name()) !== null) {
        if (name === 'lo')
            continue;
        // Only count links that are actually carrying traffic. "unknown" is
        // included because tun/wireguard devices report that even when up.
        const state = readValue(name, 'operstate');
        if (state === 'up' || state === 'unknown')
            names.push(name);
    }
    dir.close();
    return names;
}

export class NetworkMonitor {
    constructor() {
        // Byte counters are cumulative, so like /proc/stat the first sample
        // only establishes a baseline.
        this._prev = null;
        this._prevTime = 0;
    }

    // Returns bytes/second since the previous call, aggregated across every
    // active interface, plus the per-interface totals.
    read() {
        const now = GLib.get_monotonic_time() / 1e6; // seconds
        const sample = {};

        let names;
        try {
            names = interfaces();
        } catch (e) {
            logError(e, 'cathud: could not enumerate network interfaces');
            return {rx: 0, tx: 0, interfaces: [], ready: false};
        }

        for (const name of names) {
            const rx = Number(readValue(name, 'statistics/rx_bytes'));
            const tx = Number(readValue(name, 'statistics/tx_bytes'));
            if (!Number.isNaN(rx) && !Number.isNaN(tx))
                sample[name] = {rx, tx};
        }

        const prev = this._prev;
        const elapsed = now - this._prevTime;
        this._prev = sample;
        this._prevTime = now;

        if (!prev || elapsed <= 0)
            return {rx: 0, tx: 0, interfaces: [], ready: false};

        let rxRate = 0;
        let txRate = 0;
        const perInterface = [];

        for (const [name, counts] of Object.entries(sample)) {
            const before = prev[name];
            // A newly appeared interface has no baseline yet; counting its
            // since-boot total as one second of traffic would spike the graph.
            if (!before)
                continue;
            // Counters reset when an interface is brought down and back up.
            const rx = Math.max(0, counts.rx - before.rx) / elapsed;
            const tx = Math.max(0, counts.tx - before.tx) / elapsed;
            rxRate += rx;
            txRate += tx;
            perInterface.push({name, rx, tx});
        }

        perInterface.sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx));
        return {rx: rxRate, tx: txRate, interfaces: perInterface, ready: true};
    }
}
