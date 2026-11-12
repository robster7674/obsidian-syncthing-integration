import { describe, expect, it } from "vitest";
import { Failure } from "./models/failures";
import { DEFAULT_BASE_URL, parseBaseUrl, parseSettings } from "./settings";

describe("parseSettings", () => {
	it("gives the defaults when nothing was saved", () => {
		expect(parseSettings(null)).toEqual({
			settings: { api_key: "", baseUrl: DEFAULT_BASE_URL, devMode: false },
			legacy: false,
		});
	});

	it("reads the current format", () => {
		const saved = {
			api_key: "key",
			baseUrl: "https://example.org/syncthing",
			devMode: true,
		};

		expect(parseSettings(saved)).toEqual({ settings: saved, legacy: false });
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

	it("turns the old localhost default into 127.0.0.1, as 2.4.0 did on mobile", () => {
		const { settings } = parseSettings({
			configuration: {
				url: { protocol: "http", ip_address: "localhost", port: 8384 },
			},
		});

		expect(settings.baseUrl).toBe("http://127.0.0.1:8384");
	});

	it("brackets an IPv6 address saved by 2.4.0", () => {
		const { settings } = parseSettings({
			configuration: { url: { protocol: "http", ip_address: "::1", port: 8384 } },
		});

		expect(settings.baseUrl).toBe("http://[::1]:8384");
	});

	it("falls back to the default for an unusable saved address", () => {
		const { settings } = parseSettings({ baseUrl: "ftp://host" });

		expect(settings.baseUrl).toBe(DEFAULT_BASE_URL);
	});
});

describe("parseBaseUrl", () => {
	it("keeps a reverse-proxy path and drops the trailing slash", () => {
		expect(parseBaseUrl(" https://example.org/syncthing/ ")).toBe(
			"https://example.org/syncthing",
		);
	});

	it.each([
		["not a url", "is not a URL"],
		["ftp://host", "must start with http"],
		["http://user:pass@host:8384", "Remove the user name and password"],
		["http://host:8384/?a=1", "cannot have a query"],
	])("refuses %s", (text, message) => {
		const result = parseBaseUrl(text);

		expect(result).toBeInstanceOf(Failure);
		expect((result as Failure).message).toContain(message);
	});
});
