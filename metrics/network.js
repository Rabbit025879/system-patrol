import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const NET_ROOT = '/sys/class/net';

// Container and virtualisation bridges carry no traffic the user cares about,
// and docker0's 172.17.x address is not a useful "local IP".
const VIRTUAL_PREFIXES = ['docker', 'br-', 'veth', 'virbr', 'vmnet', 'tap'];

function isVirtual(name) {
    return VIRTUAL_PREFIXES.some(prefix => name.startsWith(prefix));
}

function readValue(iface, file) {
    const path = GLib.build_filenamev([NET_ROOT, iface, file]);
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch (e) {
        // Interfaces come and go (VPNs, docks); a vanished one is not an error.
        return null;
    }
}

function activeInterfaces() {
    const dir = GLib.Dir.open(NET_ROOT, 0);
    const names = [];
    let name;
    while ((name = dir.read_name()) !== null) {
        if (name === 'lo' || isVirtual(name))
            continue;
        // Only count links actually carrying traffic. "unknown" is included
        // because tun/wireguard devices report that even when up.
        const state = readValue(name, 'operstate');
        if (state === 'up' || state === 'unknown')
            names.push(name);
    }
    dir.close();
    return names;
}

export function isWireless(iface) {
    return GLib.file_test(
        GLib.build_filenamev([NET_ROOT, iface, 'wireless']), GLib.FileTest.EXISTS);
}

export class NetworkMonitor {
    constructor() {
        // Byte counters are cumulative, so the first sample only establishes
        // a baseline.
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
            names = activeInterfaces();
        } catch (e) {
            logError(e, 'system-patrol: could not enumerate network interfaces');
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
            perInterface.push({name, rx, tx, wireless: isWireless(name)});
        }

        perInterface.sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx));
        return {rx: rxRate, tx: txRate, interfaces: perInterface, ready: true};
    }
}

function runCommand(argv, cancellable, onDone) {
    let proc;
    try {
        proc = Gio.Subprocess.new(argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    } catch (e) {
        onDone(null);
        return;
    }
    proc.communicate_utf8_async(null, cancellable, (source, result) => {
        try {
            const [, stdout] = source.communicate_utf8_finish(result);
            onDone(source.get_successful() ? (stdout ?? '').trim() : null);
        } catch (e) {
            onDone(null);
        }
    });
}

// SSID and addresses change rarely and both need a subprocess, so the HUD
// refreshes these on a much slower cadence than the byte counters.
// Calls onDone exactly once with {ssid, addresses: [{iface, addr}]}.
export function readLinkInfo(onDone, cancellable = null) {
    const result = {ssid: null, addresses: []};
    let pending = 2;
    const finish = () => {
        if (--pending === 0)
            onDone(result);
    };

    runCommand(['ip', '-4', '-o', 'addr', 'show', 'scope', 'global'], cancellable, out => {
        if (out) {
            for (const line of out.split('\n')) {
                // "3: wlp0s20f3    inet 192.168.0.92/24 brd ..."
                const match = line.match(/^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)/);
                if (match && !isVirtual(match[1]))
                    result.addresses.push({iface: match[1], addr: match[2]});
            }
        }
        finish();
    });

    runCommand(['iwgetid', '-r'], cancellable, out => {
        if (out) {
            result.ssid = out;
            finish();
            return;
        }
        // iwgetid is not installed everywhere; NetworkManager usually is.
        runCommand(['nmcli', '-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi'], cancellable, nm => {
            if (nm) {
                const active = nm.split('\n').find(l => l.startsWith('yes:'));
                if (active)
                    result.ssid = active.slice(4);
            }
            finish();
        });
    });
}
