// Panel phrases. The top bar shows one short line instead of raw numbers, and
// which line depends on how hard the machine is working -- so the sentence is
// still a reading, just a friendlier one.
//
// Thresholds match catIcon's animation tiers, so the words and the mascot's
// gait always agree.
const SLEEP_MAX = 5;
const CALM_MAX = 30;
const BUSY_MAX = 70;

// Rotate between the variants of a tier so the panel does not read as frozen.
const ROTATE_SECONDS = 45;

const PHRASES = {
    cat: {
        sleep: ['貓睡成一團', '別吵，貓在睡', '兔子窩很安靜'],
        calm: ['貓在曬太陽', '貓慢慢走著', '兔子在發呆'],
        busy: ['貓在小跑步', '貓開始忙了', '兔子跳起來了'],
        sprint: ['貓衝刺中！', '貓跑瘋了', '兔子全速逃跑'],
    },
    raccoon: {
        sleep: ['浣熊睡著了', '別吵，浣熊在睡', '兔子窩很安靜'],
        calm: ['浣熊在洗手', '浣熊慢慢晃', '兔子在發呆'],
        busy: ['浣熊在翻箱子', '浣熊忙起來了', '兔子跳起來了'],
        sprint: ['浣熊暴衝中！', '浣熊翻垃圾桶', '兔子全速逃跑'],
    },
};

const MASCOT_NAMES = {cat: '貓', raccoon: '浣熊'};

function tierFor(cpuPercent) {
    if (cpuPercent < SLEEP_MAX)
        return 'sleep';
    if (cpuPercent <= CALM_MAX)
        return 'calm';
    if (cpuPercent <= BUSY_MAX)
        return 'busy';
    return 'sprint';
}

// elapsedSeconds drives the rotation; callers pass their own uptime-ish clock
// so the phrase does not jump every refresh.
export function phraseFor(mascot, cpuPercent, elapsedSeconds) {
    const set = PHRASES[mascot] ?? PHRASES.cat;
    const variants = set[tierFor(cpuPercent)];
    const index = Math.floor(elapsedSeconds / ROTATE_SECONDS) % variants.length;
    return variants[index];
}

// Placeholders available to a user-supplied panel string.
export function formatCustom(template, {cpu, ram, mascot, host}) {
    return template
        .replace(/\{cpu\}/g, `${Math.round(cpu)}`)
        .replace(/\{ram\}/g, `${Math.round(ram)}`)
        .replace(/\{mascot\}/g, MASCOT_NAMES[mascot] ?? mascot)
        .replace(/\{host\}/g, host);
}
