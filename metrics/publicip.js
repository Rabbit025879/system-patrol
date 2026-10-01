import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

// Plain-text echo service: the response body is the address and nothing else.
// This is the one piece of the HUD that leaves the machine, which is why it
// sits behind the 'show-public-ip' setting and refreshes only every 10 minutes.
const ENDPOINT = 'https://api.ipify.org';
const REFRESH_INTERVAL_US = 10 * 60 * 1e6;
const TIMEOUT_SECONDS = 10;

export class PublicIpMonitor {
    constructor() {
        this._session = new Soup.Session({timeout: TIMEOUT_SECONDS});
        this._cancellable = new Gio.Cancellable();
        this._value = null;
        this._fetchedAt = 0;
        this._inFlight = false;
    }

    get value() {
        return this._value;
    }

    // Calls onDone(address|null) when a fresh value arrives. A cached value
    // younger than the refresh interval is returned without a request.
    fetch(onDone) {
        const now = GLib.get_monotonic_time();
        if (this._value && now - this._fetchedAt < REFRESH_INTERVAL_US) {
            onDone(this._value);
            return;
        }
        if (this._inFlight)
            return;

        this._inFlight = true;
        const message = Soup.Message.new('GET', ENDPOINT);

        this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, result) => {
                this._inFlight = false;
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.get_status() !== Soup.Status.OK) {
                        onDone(null);
                        return;
                    }
                    const text = new TextDecoder().decode(bytes.get_data()).trim();
                    // Guard against a captive portal returning an HTML page.
                    if (!/^[0-9a-fA-F:.]+$/.test(text) || text.length > 45) {
                        onDone(null);
                        return;
                    }
                    this._value = text;
                    this._fetchedAt = GLib.get_monotonic_time();
                    onDone(text);
                } catch (e) {
                    // Offline, blocked or cancelled -- the HUD just shows a dash.
                    onDone(null);
                }
            });
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
    }
}
