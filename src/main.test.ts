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

const SHARED_DATA = {
	api_key: LEGACY_DATA.api_key,
	configuration: LEGACY_DATA.configuration,
	devMode: true,
};

describe("SyncthingPlugin.loadSettings", () => {
	it("takes over 2.4.0's key and address, and drops only the GUI credentials", async () => {
		const { app, plugin, saved } = makeDevice(LEGACY_DATA);

		await plugin.loadSettings();

		expect(app.secretStorage.getSecret(API_KEY_SECRET)).toBe("key-from-data-json");
		expect(app.loadLocalStorage(DEVICE_SETTINGS_KEY)).toEqual({
			baseUrl: "http://192.168.1.5:8384",
		});
		expect(saved()).toEqual(SHARED_DATA);
		expect(plugin.getApiKey()).toBe("key-from-data-json");
		expect(plugin.device.baseUrl).toBe("http://192.168.1.5:8384");
		expect(plugin.hasSharedSettings()).toBe(true);
	});

	it("lets a second device take over the same settings after the first one updated", async () => {
		const first = makeDevice(LEGACY_DATA);
		await first.plugin.loadSettings();
		const second = makeDevice(first.saved());

		await second.plugin.loadSettings();

		expect(second.plugin.getApiKey()).toBe("key-from-data-json");
		expect(second.plugin.device.baseUrl).toBe("http://192.168.1.5:8384");
	});

	it("keeps the shared fields when other settings are saved", async () => {
		const { plugin, saved } = makeDevice(LEGACY_DATA);
		await plugin.loadSettings();

		plugin.settings.devMode = false;
		await plugin.saveSettings();

		expect(saved()).toEqual({ ...SHARED_DATA, devMode: false });
	});

	it("removes the shared fields when asked", async () => {
		const { plugin, saved } = makeDevice(LEGACY_DATA);
		await plugin.loadSettings();

		await plugin.removeSharedSettings();

		expect(saved()).toEqual({ devMode: true });
		expect(plugin.hasSharedSettings()).toBe(false);
		expect(plugin.getApiKey()).toBe("key-from-data-json");
	});

	it("keeps this device's own key and URL over the shared ones", async () => {
		const { app, plugin, saved } = makeDevice(LEGACY_DATA);
		app.secretStorage.setSecret(API_KEY_SECRET, "this-device-key");
		app.saveLocalStorage(DEVICE_SETTINGS_KEY, { baseUrl: "http://127.0.0.1:8385" });

		await plugin.loadSettings();

		expect(plugin.getApiKey()).toBe("this-device-key");
		expect(plugin.device.baseUrl).toBe("http://127.0.0.1:8385");
		expect(saved()).toEqual(SHARED_DATA);
	});

	it("uses the key in data.json, and refuses to remove it, when the keychain refuses it", async () => {
		const { app, plugin, saved } = makeDevice(LEGACY_DATA);
		app.secretStorage.setSecret = vi.fn(() => {
			throw new Error("Secure storage is not available.");
		});

		await plugin.loadSettings();
		plugin.settings.devMode = false;
		await plugin.saveSettings();

		expect(plugin.getApiKey()).toBe("key-from-data-json");
		expect(saved()).toMatchObject({ api_key: "key-from-data-json" });
		expect(notices().map((notice) => notice.message)).toEqual([
			expect.stringContaining("the one in data.json is used"),
		]);
		await expect(plugin.removeSharedSettings()).rejects.toThrow("keychain");
		expect(saved()).toMatchObject({ api_key: "key-from-data-json" });
	});

	it("takes over the settings when another device syncs an old data.json", async () => {
		const { app, plugin } = makeDevice({ devMode: false });
		await plugin.loadSettings();
		plugin.loadData = vi.fn(async () => structuredClone(LEGACY_DATA));

		await plugin.onExternalSettingsChange();

		expect(app.secretStorage.getSecret(API_KEY_SECRET)).toBe("key-from-data-json");
	});

	it("shows a problem with the saved URL once, not on every sync", async () => {
		const { app, plugin } = makeDevice({ devMode: false });
		app.saveLocalStorage(DEVICE_SETTINGS_KEY, { baseUrl: "ftp://host" });

		await plugin.loadSettings();
		await plugin.onExternalSettingsChange();

		expect(notices()).toHaveLength(1);
	});

	it("does not write anything for settings already in the current format", async () => {
		const { app, plugin } = makeDevice({ devMode: false });

		await plugin.loadSettings();

		expect(plugin.saveData).not.toHaveBeenCalled();
		expect(app.saveLocalStorage).not.toHaveBeenCalled();
		expect(plugin.getApiKey()).toBe("");
	});
});
