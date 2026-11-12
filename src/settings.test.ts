import { describe, expect, it } from "vitest";
import { Failure } from "./models/failures";
import {
	DEFAULT_BASE_URL,
	parseBaseUrl,
	parseSettings,
	sendsKeyInClear,
} from "./settings";

describe("parseSettings", () => {
	it("gives the defaults when nothing was saved", () => {
		expect(parseSettings(null)).toEqual({
			settings: { api_key: "", baseUrl: DEFAULT_BASE_URL, devMode: false },
			legacy: false,
			problem: undefined,
		});
	});

	it("reads the current format", () => {
		const saved = {
			api_key: "key",
			baseUrl: "https://example.org/syncthing",
			devMode: true,
		};

		expect(parseSettings(saved)).toEqual({
			settings: saved,
			legacy: false,
			problem: undefined,
		});
	});

	it("converts the address saved by 2.4.0 and drops the GUI credentials", () => {
		const { settings, legacy } = parseSettings({
			api_key: "key",
			gui_username: "user",
			gui_password: "secret",
			configuration: {
				url: { protocol: "https", ip_address: "192.168.1.5", port: 8443 },
			},
			devMode: false,
		});

		expect(settings).toEqual({
			api_key: "key",
			baseUrl: "https://192.168.1.5:8443",
			devMode: false,
		});
		expect(JSON.stringify(settings)).not.toContain("secret");
		expect(legacy).toBe(true);
	});

	it("turns 2.4.0's untouched default into Syncthing's default address", () => {
		const { settings } = parseSettings({
			configuration: {
				url: { protocol: "http", ip_address: "localhost", port: 8384 },
			},
		});

		expect(settings.baseUrl).toBe(DEFAULT_BASE_URL);
	});

	it("keeps any other localhost address as typed", () => {
		const { settings } = parseSettings({
			configuration: {
				url: { protocol: "http", ip_address: "localhost", port: 8385 },
			},
		});

		expect(settings.baseUrl).toBe("http://localhost:8385");
	});

	it("brackets an IPv6 address saved by 2.4.0", () => {
		const { settings } = parseSettings({
			configuration: { url: { protocol: "http", ip_address: "::1", port: 8384 } },
		});

		expect(settings.baseUrl).toBe("http://[::1]:8384");
	});

	it("salvages a 2.4.0 host field that also held a port or a path", () => {
		const parse = (ip_address: string) =>
			parseSettings({ configuration: { url: { protocol: "https", ip_address, port: 8384 } } })
				.settings.baseUrl;

		expect(parse("192.168.1.5:8443")).toBe("https://192.168.1.5:8443");
		expect(parse("sync.example.org/syncthing")).toBe(
			"https://sync.example.org:8384/syncthing",
		);
	});

	it("replaces an unusable saved address in memory only, and says so", () => {
		const { settings, legacy, problem } = parseSettings({
			baseUrl: "http://user:pw@host:8384",
		});

		expect(settings.baseUrl).toBe(DEFAULT_BASE_URL);
		expect(legacy).toBe(false);
		expect(problem).toContain("Remove the user name and password");
		expect(problem).not.toContain("pw");
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
		["https://example.org/syncthing", false],
		["http://192.168.1.5:8384", true],
	])("%s: %s", (url, expected) => {
		expect(sendsKeyInClear(url)).toBe(expected);
	});
});
