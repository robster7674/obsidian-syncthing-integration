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
 * @returns the settings, and whether `data` holds fields or values that saving drops.
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
	let problem: string | undefined;
	const baseUrl =
		typeof saved.baseUrl === "string"
			? parseBaseUrl(saved.baseUrl)
			: isRecord(saved.configuration) && isRecord(saved.configuration.url)
				? legacyBaseUrl(saved.configuration.url)
				: DEFAULT_BASE_URL;
	if (baseUrl instanceof Failure) {
		problem = `The saved Syncthing URL could not be used, so ${DEFAULT_BASE_URL} is used instead. ${baseUrl.message}`;
	} else {
		settings.baseUrl = baseUrl;
	}
	const legacy =
		problem !== undefined ||
		["configuration", "gui_username", "gui_password"].some((key) => key in saved);
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
	return (
		url.protocol === "http:" &&
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
	);
}

/**
 * Converts the address saved by 2.4.0. Its untouched default,
 * `http://localhost:8384`, becomes Syncthing's default address
 * {@link DEFAULT_BASE_URL}, which 2.4.0 already used on mobile; any other
 * address is kept as typed.
 */
function legacyBaseUrl(url: Record<string, unknown>): string | Failure {
	const protocol = url.protocol === "https" ? "https" : "http";
	const host = typeof url.ip_address === "string" ? url.ip_address : "";
	const port = typeof url.port === "number" ? `:${url.port}` : "";
	const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	const typed = `${protocol}://${bracketed}${port}`;
	return parseBaseUrl(typed === "http://localhost:8384" ? DEFAULT_BASE_URL : typed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
