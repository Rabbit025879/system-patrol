// Panel text. The top bar stays to one short line instead of raw numbers.
//
// GREETINGS is the author's own set, carried over from an earlier customisation
// of System Info HUD's welcome label -- raccoon and rabbit flavour, TuTzuOS
// branding. These are the default.
//
// ACTIVITY is the alternative: a line tied to how hard the machine is working,
// using the same thresholds as mascotIcon's animation tiers so the words and the
// mascot's gait always agree.

const GREETINGS = [
    '🦝 The raccoon has finished today\'s patrol.',
    '🐇 Rabbit, welcome back.',
    '🦝 Trash inspection complete. Desktop looks edible.',
    '🐇 Ready to hop into work?',
    '🦝 Coffee status: assumed sufficient.',
    '🐇 Small hops become big discoveries.',
    '🦝 Your local raccoon assistant reporting in.',
    '🐇 Brain status: loading...',
    '🦝 You survived another reboot.',
    '🐇 I dug absolutely no new rabbit holes.',
    '🦝 Trash is clean, but your desktop isn\'t.',
    '🐇 TuTzuOS ready',
    '🤖 Welcome back, Tu.',
];

const SLEEP_MAX = 5;
const CALM_MAX = 30;
const BUSY_MAX = 70;

const ACTIVITY = {
    cat: {
        sleep: ['🐈 The cat is fast asleep.', '🐈 Do not disturb: cat napping.', '🐇 All quiet in the burrow.'],
        calm: ['🐈 The cat is sunbathing.', '🐈 The cat strolls past.', '🐇 Rabbit is daydreaming.'],
        busy: ['🐈 The cat is trotting.', '🐈 The cat found something.', '🐇 Rabbit perked up.'],
        sprint: ['🐈 The cat is sprinting!', '🐈 The cat has gone feral.', '🐇 Rabbit bolted.'],
    },
    raccoon: {
        sleep: ['🦝 The raccoon is fast asleep.', '🦝 Do not disturb: raccoon napping.', '🐇 All quiet in the burrow.'],
        calm: ['🦝 The raccoon is washing up.', '🦝 The raccoon ambles around.', '🐇 Rabbit is daydreaming.'],
        busy: ['🦝 The raccoon is rummaging.', '🦝 The raccoon found a box.', '🐇 Rabbit perked up.'],
        sprint: ['🦝 The raccoon is tearing around!', '🦝 Trash can down!', '🐇 Rabbit bolted.'],
    },
};

const MASCOT_NAMES = {cat: 'cat', raccoon: 'raccoon'};

// How long a single line stays up before the next one is typed out.
export const ROTATE_SECONDS = 90;

function tierFor(cpuPercent) {
    if (cpuPercent < SLEEP_MAX)
        return 'sleep';
    if (cpuPercent <= CALM_MAX)
        return 'calm';
    if (cpuPercent <= BUSY_MAX)
        return 'busy';
    return 'sprint';
}

// Stepping by a number coprime with the list length walks the whole set before
// repeating, which a plain random pick does not guarantee.
const GREETING_STEP = 5;

export function greetingFor(rotation) {
    return GREETINGS[(rotation * GREETING_STEP) % GREETINGS.length];
}

export function activityFor(mascot, cpuPercent, rotation) {
    const set = ACTIVITY[mascot] ?? ACTIVITY.cat;
    const variants = set[tierFor(cpuPercent)];
    return variants[rotation % variants.length];
}

// Placeholders available to a user-supplied panel string.
export function formatCustom(template, {cpu, ram, mascot, host}) {
    return template
        .replace(/\{cpu\}/g, `${Math.round(cpu)}`)
        .replace(/\{ram\}/g, `${Math.round(ram)}`)
        .replace(/\{mascot\}/g, MASCOT_NAMES[mascot] ?? mascot)
        .replace(/\{host\}/g, host);
}
