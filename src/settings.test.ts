import { describe, expect, it } from "vitest";
import { Failure } from "./models/failures";
import { Platform } from "obsidian";
import {
	ANDROID_BASE_URL,
	DEFAULT_BASE_URL,
	defaultBaseUrl,
	parseBaseUrl,
	parseSettings,
	sendsKeyInClear,
} from "./settings";

describe("parseSettings", () => {
	it("gives the defaults when nothing was saved", () => {
		expect(parseSettings(null, null)).toEqual({
			settings: { devMode: false },
			device: { baseUrl: DEFAULT_BASE_URL, cliPath: "" },
			takeOver: false,
			sharedApiKey: undefined,
			shared: {},
			rewrite: false,
			problem: undefined,
		});
	});

	it("reads the synced settings and this device's settings apart", () => {
		const loaded = parseSettings(
			{ devMode: true },
			{ baseUrl: "https://example.org/syncthing", cliPath: "/opt/syncthing" },
		);

		expect(loaded.settings).toEqual({ devMode: true });
		expect(loaded.device).toEqual({
			baseUrl: "https://example.org/syncthing",
			cliPath: "/opt/syncthing",
		});
		expect(loaded.rewrite).toBe(false);
	});

	it("takes over 2.4.0's key and address, keeps them for other devices, and drops the GUI credentials", () => {
		const loaded = parseSettings(
			{
				api_key: "key",
				gui_username: "user",
				gui_password: "secret",
				configuration: {
					url: { protocol: "https", ip_address: "192.168.1.5", port: 8443 },
				},
				devMode: false,
			},
			null,
		);

		expect(loaded).toMatchObject({
			settings: { devMode: false },
			device: { baseUrl: "https://192.168.1.5:8443" },
			takeOver: true,
			sharedApiKey: "key",
			shared: {
				api_key: "key",
				configuration: {
					url: { protocol: "https", ip_address: "192.168.1.5", port: 8443 },
				},
			},
			rewrite: true,
		});
		expect(JSON.stringify(loaded.settings)).not.toContain("secret");
	});

	it("keeps this device's address over the one in data.json", () => {
		const loaded = parseSettings(
			{ baseUrl: "http://192.168.1.5:8384" },
			{ baseUrl: "http://127.0.0.1:8385" },
		);

		expect(loaded.device.baseUrl).toBe("http://127.0.0.1:8385");
		expect(loaded.takeOver).toBe(false);
		expect(loaded.rewrite).toBe(false);
	});

	it("turns 2.4.0's untouched default into Syncthing's default address", () => {
		const { device } = parseSettings(
			{ configuration: { url: { protocol: "http", ip_address: "localhost", port: 8384 } } },
			null,
		);

		expect(device.baseUrl).toBe(DEFAULT_BASE_URL);
	});

	it("keeps any other localhost address as typed", () => {
		const { device } = parseSettings(
			{ configuration: { url: { protocol: "http", ip_address: "localhost", port: 8385 } } },
			null,
		);

		expect(device.baseUrl).toBe("http://localhost:8385");
	});

	it("salvages a 2.4.0 host field that also held a port or a path", () => {
		const parse = (ip_address: string) =>
			parseSettings(
				{ configuration: { url: { protocol: "https", ip_address, port: 8384 } } },
				null,
			).device.baseUrl;

		expect(parse("192.168.1.5:8443")).toBe("https://192.168.1.5:8443");
		expect(parse("sync.example.org:443")).toBe("https://sync.example.org");
		expect(parse("[fd00::5]:8443")).toBe("https://[fd00::5]:8443");
		expect(parse("fd00::5")).toBe("https://[fd00::5]:8384");
		expect(parse("sync.example.org/syncthing")).toBe(
			"https://sync.example.org:8384/syncthing",
		);
	});

	it("keeps an unusable saved address as it was, and says why", () => {
		const { device, problem } = parseSettings(null, {
			baseUrl: "http://user:pw@host:8384",
		});

		expect(device.baseUrl).toBe("http://user:pw@host:8384");
		expect(problem).toContain("Remove the user name and password");
		expect(problem).not.toContain("pw");
	});

	it("keeps an unusable 2.4.0 address in the new format", () => {
		const { device, problem } = parseSettings(
			{ configuration: { url: { protocol: "http", ip_address: "my nas", port: 8384 } } },
			null,
		);

		expect(device.baseUrl).toBe("http://my nas:8384");
		expect(problem).toContain("is not a host name");
	});
});

describe("defaultBaseUrl", () => {
	it("is Syncthing-Fork's HTTPS address on Android", () => {
		Platform.isAndroidApp = true;

		expect(defaultBaseUrl()).toBe(ANDROID_BASE_URL);
		expect(parseSettings(null, null).device.baseUrl).toBe(ANDROID_BASE_URL);
	});

	it("is Syncthing's default address elsewhere", () => {
		expect(defaultBaseUrl()).toBe(DEFAULT_BASE_URL);
	});
});

describe("parseBaseUrl", () => {
	it("keeps a reverse-proxy path and drops the trailing slash", () => {
		expect(parseBaseUrl(" https://example.org/syncthing/ ")).toBe(
			"https://example.org/syncthing",
		);
	});

	it("gives the default for an empty field", () => {
		expect(parseBaseUrl("  ")).toBe(DEFAULT_BASE_URL);
	});

	it.each([
		["not a url", "is not a URL"],
		["http://host:8384/?", "cannot have a query"],
		["ftp://host", "must start with http"],
		["http://user:pass@host:8384", "Remove the user name and password"],
		["http://host:8384/?a=1", "cannot have a query"],
	])("refuses %s", (text, message) => {
		const result = parseBaseUrl(text);

		expect(result).toBeInstanceOf(Failure);
		expect((result as Failure).message).toContain(message);
	});
});

describe("sendsKeyInClear", () => {
	it.each([
		["http://127.0.0.1:8384", false],
		["http://localhost:8384", false],
		["http://[::1]:8384", false],
		["http://127.0.0.2:8384", false],
		["http://localhost.:8384", false],
		["http://[::ffff:127.0.0.1]:8384", false],
		["https://example.org/syncthing", false],
		["http://192.168.1.5:8384", true],
	])("%s: %s", (url, expected) => {
		expect(sendsKeyInClear(url)).toBe(expected);
	});
});
