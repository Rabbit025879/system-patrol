import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Index order has to match the enum nicks in the gschema.
const MASCOT_KEYS = ['cat', 'raccoon'];
const MASCOT_LABELS = ['Cat', 'Raccoon'];

const PANEL_KEYS = ['greeting', 'activity', 'stats', 'custom'];
const PANEL_LABELS = ['Greetings', 'Activity', 'CPU / RAM figures', 'Custom text'];

function sliderFor(settings, key, title, subtitle) {
    const row = new Adw.ActionRow({title, subtitle});
    const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 100, 1);
    scale.set_value(settings.get_int(key));
    scale.set_hexpand(true);
    scale.set_valign(Gtk.Align.CENTER);
    scale.set_size_request(220, -1);
    scale.set_draw_value(true);
    scale.set_value_pos(Gtk.PositionType.RIGHT);
    scale.connect('value-changed', () => settings.set_int(key, Math.round(scale.get_value())));
    row.add_suffix(scale);
    return row;
}

function comboFor(settings, key, keys, labels, title, subtitle) {
    const current = keys.indexOf(settings.get_string(key));
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(labels),
        // An unrecognised stored value falls back to the first entry
        // rather than leaving the row blank.
        selected: current < 0 ? 0 : current,
    });
    row.connect('notify::selected', () => settings.set_string(key, keys[row.selected]));
    return row;
}

export default class SystemPatrolPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        const hud = new Adw.PreferencesGroup({
            title: 'HUD',
            description: 'The mascot runs in the HUD, faster as CPU load rises, ' +
                'and curls up asleep below 5%.',
        });
        hud.add(comboFor(settings, 'mascot', MASCOT_KEYS, MASCOT_LABELS,
            'Mascot', 'Changes take effect immediately'));
        page.add(hud);

        const glass = new Adw.PreferencesGroup({
            title: 'Glass',
            description: 'The liquid glass look of the HUD. Changes apply live.',
        });
        glass.add(sliderFor(settings, 'glass-tint', 'Tint', 'Lower is clearer glass'));
        glass.add(sliderFor(settings, 'glass-blur', 'Blur', 'Set to 0 to turn the blur off'));
        glass.add(sliderFor(settings, 'glass-brightness', 'Backdrop brightness',
            'How bright the blurred background is'));
        page.add(glass);

        const panel = new Adw.PreferencesGroup({
            title: 'Top bar',
            description: 'What the single line in the top bar says.',
        });
        panel.add(comboFor(settings, 'panel-mode', PANEL_KEYS, PANEL_LABELS,
            'Content',
            'Greetings rotate on their own; Activity follows system load'));

        const custom = new Adw.EntryRow({
            title: 'Custom text',
            text: settings.get_string('panel-custom-text'),
        });
        // Only meaningful when the mode above is set to Custom.
        custom.connect('changed',
            () => settings.set_string('panel-custom-text', custom.text));
        panel.add(custom);

        const hint = new Adw.ActionRow({
            title: 'Placeholders',
            subtitle: '{cpu}  {ram}  {mascot}  {host}',
        });
        panel.add(hint);
        page.add(panel);

        const privacy = new Adw.PreferencesGroup({
            title: 'Privacy',
        });
        const publicIp = new Adw.SwitchRow({
            title: 'Show public IP',
            subtitle: 'Queries api.ipify.org every 10 minutes while the HUD is ' +
                'open. This is the only part of the HUD that leaves your machine.',
            active: settings.get_boolean('show-public-ip'),
        });
        publicIp.connect('notify::active',
            () => settings.set_boolean('show-public-ip', publicIp.active));
        privacy.add(publicIp);
        page.add(privacy);

        window.add(page);
    }
}
