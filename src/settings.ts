import { isRecord } from "./controllers/utils";
import { Failure } from "./models/failures";

/** Syncthing's default GUI and REST API address. */
export const DEFAULT_BASE_URL = "http://127.0.0.1:8384";

/** The secret holding this device's Syncthing API key in Obsidian's keychain. */
export const API_KEY_SECRET = "syncthing-integration-api-key";
/** The key of {@link DeviceSettings} in the vault's local storage on this device. */
export const DEVICE_SETTINGS_KEY = "syncthing-integration-device";

/** Settings saved in `data.json`, which syncs with the vault. */
export interface SyncthingPluginSettings {
	devMode: boolean;
}

/**
 * Settings of the Syncthing on this device. They are kept out of `data.json`,
 * so that each device reaches its own Syncthing, as is the API key.
 */
export interface DeviceSettings {
	/** Where Syncthing's GUI and REST API are served, including any reverse-proxy path. */
	baseUrl: string;
}

/** Fields of 2.4.0 that other devices may still need to take over their settings. */
const SHARED_FIELDS = ["api_key", "baseUrl", "configuration"];
/** Fields of 2.4.0 that nothing uses any more. */
const DROPPED_FIELDS = ["gui_username", "gui_password"];

/**
 * Reads the settings saved by any version of the plugin.
 * Up to 2.4.0, `data.json` held the API key, the address as
 * `configuration.url`, and GUI credentials, which are no longer used.
 * The key and address are kept in `data.json` until the user removes them,
 * so that every device can take them over when it updates.
 * A saved address that cannot be used is kept as it was, so nothing the user
 * typed is lost, and `problem` says why; requests refuse it until it is fixed.
 * @param data the content of `data.json`.
 * @param storedDevice what this device stored under {@link DEVICE_SETTINGS_KEY}.
 */
export function parseSettings(
	data: unknown,
	storedDevice: unknown,
): {
	settings: SyncthingPluginSettings;
	device: DeviceSettings;
	/** Device settings found only in `data.json`, which this device must now store. */
	deviceFromData: boolean;
	/** The API key 2.4.0 left in `data.json`, which belongs in the keychain. */
	sharedApiKey?: string;
	/** The fields of 2.4.0 to keep in `data.json` for other devices. */
	shared: Record<string, unknown>;
	/** Whether `data.json` holds fields that saving drops. */
	rewrite: boolean;
	/** Why a saved value cannot be used, for the user. */
	problem?: string;
} {
	const saved = isRecord(data) ? data : {};
	const deviceFromData =
		!isRecord(storedDevice) && ("baseUrl" in saved || "configuration" in saved);
	const source = isRecord(storedDevice) ? storedDevice : saved;
	const { typed, parsed } =
		typeof source.baseUrl === "string"
			? { typed: source.baseUrl, parsed: parseBaseUrl(source.baseUrl) }
			: isRecord(source.configuration) && isRecord(source.configuration.url)
				? legacyBaseUrl(source.configuration.url)
				: { typed: DEFAULT_BASE_URL, parsed: DEFAULT_BASE_URL };
	return {
		settings: { devMode: saved.devMode === true },
		device: { baseUrl: parsed instanceof Failure ? typed : parsed },
		deviceFromData,
		sharedApiKey:
			typeof saved.api_key === "string" && saved.api_key !== ""
				? saved.api_key
				: undefined,
		shared: Object.fromEntries(
			SHARED_FIELDS.filter((key) => key in saved).map((key) => [key, saved[key]]),
		),
		rewrite: DROPPED_FIELDS.some((key) => key in saved),
		problem:
			parsed instanceof Failure
				? `The saved Syncthing URL cannot be used. ${parsed.message} Set it again in the plugin settings.`
				: undefined,
	};
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
