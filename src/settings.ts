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
 */
export function parseSettings(data: unknown): {
	settings: SyncthingPluginSettings;
	legacy: boolean;
} {
	const saved = isRecord(data) ? data : {};
	const settings: SyncthingPluginSettings = {
		api_key: typeof saved.api_key === "string" ? saved.api_key : "",
		baseUrl: DEFAULT_BASE_URL,
		devMode: saved.devMode === true,
	};
	if (typeof saved.baseUrl === "string") {
		const baseUrl = parseBaseUrl(saved.baseUrl);
		if (!(baseUrl instanceof Failure)) settings.baseUrl = baseUrl;
	} else if (isRecord(saved.configuration) && isRecord(saved.configuration.url)) {
		const baseUrl = legacyBaseUrl(saved.configuration.url);
		if (!(baseUrl instanceof Failure)) settings.baseUrl = baseUrl;
	}
	const legacy = ["configuration", "gui_username", "gui_password"].some(
		(key) => key in saved,
	);
	return { settings, legacy };
}

/**
 * Checks a Syncthing address typed by the user and normalises it, without a trailing slash.
 * Credentials are refused: the plugin authenticates with the API key, and a
 * `user:password@` URL would end up in the browser's history.
 */
export function parseBaseUrl(text: string): string | Failure {
	let url: URL;
	try {
		url = new URL(text.trim());
	} catch {
		return new Failure(`${text} is not a URL, such as ${DEFAULT_BASE_URL}.`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return new Failure("The Syncthing URL must start with http:// or https://.");
	}
	if (url.username || url.password) {
		return new Failure(
			"Remove the user name and password from the Syncthing URL. The plugin uses the API key.",
		);
	}
	if (url.search || url.hash) {
		return new Failure("The Syncthing URL cannot have a query or a fragment.");
	}
	return url.href.replace(/\/+$/, "");
}

/**
 * Earlier versions replaced `localhost` with `127.0.0.1` on mobile when they
 * sent a request; the address is now used as typed, so the migration does it once.
 */
function legacyBaseUrl(url: Record<string, unknown>): string | Failure {
	const protocol = url.protocol === "https" ? "https" : "http";
	const typed = typeof url.ip_address === "string" ? url.ip_address : "";
	const host = typed === "localhost" ? "127.0.0.1" : typed;
	const port = typeof url.port === "number" ? `:${url.port}` : "";
	const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	return parseBaseUrl(`${protocol}://${bracketed}${port}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
