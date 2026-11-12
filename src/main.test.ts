import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice } from "obsidian";
import type { Notice as MockNotice } from "../test/mocks/obsidian";
import SyncthingPlugin from "./main";
import { API_KEY_SECRET, DEVICE_SETTINGS_KEY } from "./settings";

const LEGACY_DATA = {
	api_key: "key-from-data-json",
	gui_username: "user",
	gui_password: "secret",
	configuration: {
		url: { protocol: "http", ip_address: "192.168.1.5", port: 8384 },
	},
	devMode: true,
};

function makeDevice(data: unknown) {
	const app = new App();
	const plugin = new SyncthingPlugin(app as never, {} as never);
	let saved = structuredClone(data);
	plugin.loadData = vi.fn(async () => structuredClone(saved));
	plugin.saveData = vi.fn(async (next: unknown) => {
		saved = structuredClone(next);
	});
	return { app, plugin, saved: () => saved };
}

const notices = () => (Notice as unknown as typeof MockNotice).instances;

beforeEach(() => {
	notices().length = 0;
});

describe("SyncthingPlugin.loadSettings", () => {
	it("moves the API key and address out of data.json, then rewrites it", async () => {
		const { app, plugin, saved } = makeDevice(LEGACY_DATA);

		await plugin.loadSettings();

		expect(app.secretStorage.getSecret(API_KEY_SECRET)).toBe("key-from-data-json");
		expect(app.loadLocalStorage(DEVICE_SETTINGS_KEY)).toEqual({
			baseUrl: "http://192.168.1.5:8384",
		});
		expect(saved()).toEqual({ devMode: true });
		expect(plugin.getApiKey()).toBe("key-from-data-json");
		expect(plugin.device.baseUrl).toBe("http://192.168.1.5:8384");
	});

	it("keeps this device's own key when data.json still holds another device's", async () => {
		const { app, plugin, saved } = makeDevice(LEGACY_DATA);
		app.secretStorage.setSecret(API_KEY_SECRET, "this-device-key");

		await plugin.loadSettings();

		expect(plugin.getApiKey()).toBe("this-device-key");
		expect(saved()).toEqual({ devMode: true });
	});

	it("leaves data.json alone when the keychain refuses the key", async () => {
		const { app, plugin, saved } = makeDevice(LEGACY_DATA);
		app.secretStorage.setSecret = vi.fn(() => {
			throw new Error("Secure storage is not available.");
		});

		await plugin.loadSettings();

		expect(saved()).toEqual(LEGACY_DATA);
		expect(plugin.getApiKey()).toBe("key-from-data-json");
		expect(notices().map((notice) => notice.message)).toEqual([
			expect.stringContaining("stays in data.json"),
		]);
	});

	it("migrates again when another device syncs an old data.json", async () => {
		const { app, plugin, saved } = makeDevice({ devMode: false });
		await plugin.loadSettings();
		plugin.loadData = vi.fn(async () => structuredClone(LEGACY_DATA));

		await plugin.onExternalSettingsChange();

		expect(app.secretStorage.getSecret(API_KEY_SECRET)).toBe("key-from-data-json");
		expect(saved()).toEqual({ devMode: true });
	});

	it("does not write anything for settings already in the current format", async () => {
		const { app, plugin } = makeDevice({ devMode: false });

		await plugin.loadSettings();

		expect(plugin.saveData).not.toHaveBeenCalled();
		expect(app.saveLocalStorage).not.toHaveBeenCalled();
		expect(plugin.getApiKey()).toBe("");
	});
});
