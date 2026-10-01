import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Index order has to match the enum nicks in the gschema.
const MASCOT_KEYS = ['cat', 'raccoon'];
const MASCOT_LABELS = ['Cat', 'Raccoon'];

const PANEL_KEYS = ['greeting', 'activity', 'stats', 'custom'];
const PANEL_LABELS = ['Greetings', 'Activity', 'CPU / RAM figures', 'Custom text'];

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
