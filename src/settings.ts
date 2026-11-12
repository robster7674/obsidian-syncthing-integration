import { isRecord } from "./controllers/utils";
import { Failure } from "./models/failures";

/** Syncthing's default GUI and REST API address. */
export const DEFAULT_BASE_URL = "http://127.0.0.1:8384";

export interface SyncthingPluginSettings {
	api_key: string;
	/** Where Syncthing's GUI and REST API are served, including any reverse-proxy path. */
	baseUrl: string;
	devMode: boolean;
}

/**
 * Reads the settings saved by any version of the plugin.
 * Versions up to 2.4.0 saved the address as `configuration.url` and kept GUI
 * credentials, which are no longer used.
 * @returns the settings, and whether `data` holds fields that saving drops.
 * A saved address that cannot be used is kept as it was, so nothing the user
 * typed is lost, and `problem` says why; requests refuse it until it is fixed.
 */
export function parseSettings(data: unknown): {
	settings: SyncthingPluginSettings;
	legacy: boolean;
	/** Why a saved value was replaced by its default, for the user. */
	problem?: string;
} {
	const saved = isRecord(data) ? data : {};
	const settings: SyncthingPluginSettings = {
		api_key: typeof saved.api_key === "string" ? saved.api_key : "",
		baseUrl: DEFAULT_BASE_URL,
		devMode: saved.devMode === true,
	};
	const { typed, parsed } =
		typeof saved.baseUrl === "string"
			? { typed: saved.baseUrl, parsed: parseBaseUrl(saved.baseUrl) }
			: isRecord(saved.configuration) && isRecord(saved.configuration.url)
				? legacyBaseUrl(saved.configuration.url)
				: { typed: DEFAULT_BASE_URL, parsed: DEFAULT_BASE_URL };
	let problem: string | undefined;
	if (parsed instanceof Failure) {
		settings.baseUrl = typed;
		problem = `The saved Syncthing URL cannot be used. ${parsed.message} Set it again in the plugin settings.`;
	} else {
		settings.baseUrl = parsed;
	}
	const legacy = ["configuration", "gui_username", "gui_password"].some(
		(key) => key in saved,
	);
	return { settings, legacy, problem };
}

/**
 * Checks a Syncthing address typed by the user and normalises it, without a trailing slash.
 * Credentials are refused: the plugin authenticates with the API key, and a
 * `user:password@` URL would end up in the browser's history.
 */
export function parseBaseUrl(text: string): string | Failure {
	const typed = text.trim();
	if (typed === "") return DEFAULT_BASE_URL;
	let url: URL;
	try {
		url = new URL(typed);
	} catch {
		return new Failure(`"${typed}" is not a URL, such as ${DEFAULT_BASE_URL}.`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return new Failure("The Syncthing URL must start with http:// or https://.");
	}
	if (url.username || url.password) {
		return new Failure(
			"Remove the user name and password from the Syncthing URL. The plugin uses the API key.",
		);
	}
	if (url.search || url.hash || /[?#]/.test(typed)) {
		return new Failure("The Syncthing URL cannot have a query or a fragment.");
	}
	return (url.origin + url.pathname).replace(/\/+$/, "");
}

/**
 * Whether requests to `baseUrl` send the API key unencrypted over a network,
 * that is over http:// to a host other than this device.
 */
export function sendsKeyInClear(baseUrl: string): boolean {
	const url = new URL(baseUrl);
	return url.protocol === "http:" && !isLoopback(url.hostname);
}

function isLoopback(hostname: string): boolean {
	return (
		/^localhost\.?$/i.test(hostname) ||
		/^127(\.\d{1,3}){3}$/.test(hostname) ||
		hostname === "[::1]" ||
		/^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(hostname)
	);
}

/**
 * Converts the address saved by 2.4.0, whose host field also accepted a
 * port or a path. Its untouched default, `http://localhost:8384`, becomes
 * Syncthing's default address {@link DEFAULT_BASE_URL}.
 */
function legacyBaseUrl(saved: Record<string, unknown>): {
	typed: string;
	parsed: string | Failure;
} {
	const protocol = saved.protocol === "https" ? "https" : "http";
	const host = typeof saved.ip_address === "string" ? saved.ip_address.trim() : "";
	const port = typeof saved.port === "number" ? String(saved.port) : "";
	const ipv6 = (host.match(/:/g) ?? []).length > 1 && !host.startsWith("[");
	const authority = (ipv6 ? `[${host}]` : host).split("/")[0];
	const hasPort = /(^[^:]*|\]):\d+$/.test(authority);
	const text = `${protocol}://${ipv6 ? `[${host}]` : host}`;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return {
			typed: port ? `${text}:${port}` : text,
			parsed: new Failure(`"${host}" is not a host name or address.`),
		};
	}
	if (!hasPort && port) url.port = port;
	const typed = (url.origin + url.pathname).replace(/\/+$/, "");
	return {
		typed,
		parsed: parseBaseUrl(typed === "http://localhost:8384" ? DEFAULT_BASE_URL : typed),
	};
}
