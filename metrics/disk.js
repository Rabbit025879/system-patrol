import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MOUNTS_PATH = '/proc/mounts';
const FS_ATTRS = 'filesystem::size,filesystem::used,filesystem::free';

// Pseudo and virtual filesystems have no meaningful capacity, and listing every
// snap loopback mount would bury the real disks.
const SKIP_TYPES = new Set([
    'autofs', 'binfmt_misc', 'bpf', 'cgroup', 'cgroup2', 'configfs', 'debugfs',
    'devpts', 'devtmpfs', 'efivarfs', 'fuse.gvfsd-fuse', 'fuse.portal',
    'fusectl', 'hugetlbfs', 'mqueue', 'proc', 'pstore', 'ramfs', 'securityfs',
    'squashfs', 'sysfs', 'tmpfs', 'tracefs',
]);

function mountPoints() {
    let text;
    try {
        const [ok, bytes] = GLib.file_get_contents(MOUNTS_PATH);
        if (!ok)
            return [];
        text = new TextDecoder().decode(bytes);
    } catch (e) {
        logError(e, 'system-patrol: could not read /proc/mounts');
        return [];
    }

    const seen = new Set();
    const points = [];
    for (const line of text.split('\n')) {
        const [device, rawTarget, type] = line.split(/\s+/);
        if (!device || !rawTarget || !type)
            continue;
        // Requiring a /dev/ backing device also drops every network mount
        // (nfs, cifs, sshfs), which is what makes the query safe to run.
        if (SKIP_TYPES.has(type) || !device.startsWith('/dev/'))
            continue;

        // /proc/mounts octal-escapes spaces and friends in the mount path.
        const target = rawTarget.replace(/\\(\d{3})/g,
            (_, oct) => String.fromCharCode(parseInt(oct, 8)));

        // Bind mounts make the same filesystem appear more than once.
        if (seen.has(target))
            continue;
        seen.add(target);
        points.push(target);
    }
    return points;
}

function parseInfo(path, info) {
    const size = info.get_attribute_uint64('filesystem::size');
    if (!size)
        return null;
    // Not every backend fills in ::used, but ::free is reliable.
    const free = info.get_attribute_uint64('filesystem::free');
    const used = info.get_attribute_uint64('filesystem::used') ||
        Math.max(0, size - free);
    return {path, size, used, free, percent: (used / size) * 100};
}

// Deliberately callback-based rather than promise-based. A promise resolved
// from inside a GIO callback only settles once the main loop next wakes for
// some other reason -- measured at seconds of delay on an idle loop -- whereas
// a plain callback runs the moment GIO dispatches it.
//
// Calls onDone exactly once with one entry per real filesystem, largest first.
// Never throws: an unreadable mount is simply omitted.
export function readDisks(onDone, cancellable = null) {
    const points = mountPoints();
    if (!points.length) {
        onDone([]);
        return;
    }

    const results = [];
    let pending = points.length;

    const finish = () => {
        if (--pending > 0)
            return;
        results.sort((a, b) => b.size - a.size);
        onDone(results);
    };

    for (const path of points) {
        Gio.File.new_for_path(path).query_filesystem_info_async(
            FS_ATTRS, GLib.PRIORITY_DEFAULT, cancellable, (file, result) => {
                try {
                    const info = parseInfo(path, file.query_filesystem_info_finish(result));
                    if (info)
                        results.push(info);
                } catch (e) {
                    // A disconnected or cancelled mount is normal; skip it
                    // rather than failing the whole disk section.
                }
                finish();
            });
    }
}
