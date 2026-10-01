import GLib from 'gi://GLib';

const SUPPLY_ROOT = '/sys/class/power_supply';

function readValue(device, key) {
    try {
        const [ok, bytes] = GLib.file_get_contents(
            GLib.build_filenamev([SUPPLY_ROOT, device, key]));
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch (e) {
        return null;
    }
}

function readNumber(device, key) {
    const raw = readValue(device, key);
    if (raw === null)
        return null;
    const value = Number(raw);
    return Number.isNaN(value) ? null : value;
}

function findBattery() {
    try {
        const dir = GLib.Dir.open(SUPPLY_ROOT, 0);
        let name;
        while ((name = dir.read_name()) !== null) {
            // Skip peripherals -- a wireless mouse also registers here as
            // hidpp_battery_N and is not what "battery" means on a laptop.
            if (readValue(name, 'type') === 'Battery' && name.startsWith('BAT')) {
                dir.close();
                return name;
            }
        }
        dir.close();
    } catch (e) {
        logError(e, 'system-patrol: could not enumerate power supplies');
    }
    return null;
}

function acOnline() {
    try {
        const dir = GLib.Dir.open(SUPPLY_ROOT, 0);
        let name;
        while ((name = dir.read_name()) !== null) {
            if (readValue(name, 'type') === 'Mains') {
                dir.close();
                return readValue(name, 'online') === '1';
            }
        }
        dir.close();
    } catch (e) {
        // Desktops with no mains device are simply always "plugged in".
    }
    return true;
}

// Returns null on machines with no battery (desktops).
export function readPower() {
    const battery = findBattery();
    if (!battery)
        return null;

    const status = readValue(battery, 'status') ?? 'Unknown';
    const percent = readNumber(battery, 'capacity') ?? 0;

    // Kernels expose either energy_* (µWh/µW) or charge_* (µAh/µA); this
    // laptop reports charge_*, so watts have to come from V x A.
    const voltage = readNumber(battery, 'voltage_now');
    const current = readNumber(battery, 'current_now');
    let watts = readNumber(battery, 'power_now');
    if (watts !== null)
        watts /= 1e6;
    else if (voltage !== null && current !== null)
        watts = (voltage * current) / 1e12;

    const chargeNow = readNumber(battery, 'charge_now') ?? readNumber(battery, 'energy_now');
    const chargeFull = readNumber(battery, 'charge_full') ?? readNumber(battery, 'energy_full');

    // Remaining runtime only means anything while actually discharging.
    let timeText = 'N/A';
    if (status === 'Discharging' && current && chargeNow) {
        const hours = chargeNow / current;
        timeText = `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;
    }

    return {
        status,
        percent,
        watts: watts ?? 0,
        timeText,
        onAc: acOnline(),
        healthPercent: chargeFull && chargeNow !== null
            ? (chargeNow / chargeFull) * 100
            : null,
    };
}
