import GLib from 'gi://GLib';

const OS_RELEASE = '/etc/os-release';
const UPTIME = '/proc/uptime';

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch (e) {
        return null;
    }
}

// Cached: none of this changes while the shell is running.
let cachedStatic = null;

function osPrettyName() {
    const text = readText(OS_RELEASE);
    if (!text)
        return 'Linux';
    const match = text.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    return match ? match[1] : 'Linux';
}

// AccountsService stores the login picture here; it is world-readable, unlike
// the user record beside it. ~/.face is the older fallback.
function avatarPath(username) {
    const candidates = [
        `/var/lib/AccountsService/icons/${username}`,
        GLib.build_filenamev([GLib.get_home_dir(), '.face']),
        GLib.build_filenamev([GLib.get_home_dir(), '.face.icon']),
    ];
    for (const path of candidates) {
        if (GLib.file_test(path, GLib.FileTest.EXISTS))
            return path;
    }
    return null;
}

export function readStatic() {
    if (cachedStatic)
        return cachedStatic;

    const username = GLib.get_user_name();

    cachedStatic = {
        username,
        realName: GLib.get_real_name(),
        hostname: GLib.get_host_name(),
        avatar: avatarPath(username),
        os: osPrettyName(),
        kernel: readKernel(),
        arch: GLib.getenv('HOSTTYPE') || readArch(),
    };
    return cachedStatic;
}

function readKernel() {
    try {
        const [, out] = GLib.spawn_command_line_sync('uname -sr');
        return new TextDecoder().decode(out).trim();
    } catch (e) {
        return 'Linux';
    }
}

function readArch() {
    try {
        const [, out] = GLib.spawn_command_line_sync('uname -m');
        return new TextDecoder().decode(out).trim();
    } catch (e) {
        return '';
    }
}

// Seconds since boot, plus a d/h/m/s breakdown ready for display.
export function readUptime() {
    const text = readText(UPTIME);
    const seconds = text ? Math.floor(Number(text.split(/\s+/)[0])) : 0;

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return {
        seconds,
        text: `${days}d ${hours}h ${minutes}m ${secs}s`,
    };
}
