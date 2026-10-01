import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Index order has to match the enum nicks in the gschema.
const MASCOT_KEYS = ['cat', 'raccoon'];
const MASCOT_LABELS = ['Cat', 'Raccoon'];

export default class CatHudPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Panel',
            description: 'The mascot runs faster as CPU load rises, ' +
                'and curls up asleep below 5%.',
        });

        const current = MASCOT_KEYS.indexOf(settings.get_string('mascot'));
        const row = new Adw.ComboRow({
            title: 'Mascot',
            subtitle: 'Changes take effect immediately',
            model: Gtk.StringList.new(MASCOT_LABELS),
            // An unrecognised stored value falls back to the first entry
            // rather than leaving the row blank.
            selected: current < 0 ? 0 : current,
        });

        row.connect('notify::selected', () => {
            settings.set_string('mascot', MASCOT_KEYS[row.selected]);
        });

        group.add(row);
        page.add(group);
        window.add(page);
    }
}
