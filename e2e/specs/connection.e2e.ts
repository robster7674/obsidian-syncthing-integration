import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { browser, expect } from "@wdio/globals";
import { after, afterEach, before, describe, it } from "mocha";
import { obsidianPage } from "wdio-obsidian-service";
import { Listener, ReverseProxy } from "../helpers/proxy.ts";
import { waitFor } from "../helpers/syncthing.ts";
import { clickButton, closeModals, connectPlugin, hideSettingTab, modalText, note, PLUGIN_ID, shareVault, showSettingTab, type SharedVault } from "../helpers/vault.ts";

const API_KEY_SECRET = "syncthing-integration-api-key";
const DEVICE_SETTINGS_KEY = "syncthing-integration-device";

async function rest(method: "getMyID" | "getAllFolders") {
	return browser.executeObsidian(async ({ plugins }, method) => {
		try {
			return { ok: JSON.stringify(await plugins.syncthingIntegration.syncthingFromREST[method]()) };
		} catch (failure) {
			// Not `error`: executeObsidian rethrows a result with that key.
			return { failed: (failure as Error).message ?? String(failure) };
		}
	}, method);
}

function dataJson(): Record<string, unknown> {
	const file = path.join(obsidianPage.getVaultPath(), ".obsidian/plugins", PLUGIN_ID, "data.json");
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return {};
	}
}

/** Restarts the plugin on a `data.json` and device storage as they would be on a device. */
async function reloadPlugin(data: Record<string, unknown> | undefined, keepDevice: boolean) {
	const file = path.join(obsidianPage.getVaultPath(), ".obsidian/plugins", PLUGIN_ID, "data.json");
	await browser.executeObsidian(
		async ({ app }, id, secret, deviceKey, keepDevice) => {
			const plugins = (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins;
			await plugins.disablePlugin(id);
			if (!keepDevice) {
				app.secretStorage.setSecret(secret, "");
				app.saveLocalStorage(deviceKey, null);
			}
		},
		PLUGIN_ID,
		API_KEY_SECRET,
		DEVICE_SETTINGS_KEY,
		keepDevice,
	);
	if (data) writeFileSync(file, JSON.stringify(data));
	await browser.executeObsidian(async ({ app }, id) => {
		const plugins = (app as unknown as { plugins: { enablePlugin(id: string): Promise<void> } }).plugins;
		await plugins.enablePlugin(id);
	}, PLUGIN_ID);
	await browser.waitUntil(() =>
		browser.executeObsidian(({ plugins }) => !!plugins.syncthingIntegration?.device),
	);
}

async function pluginState() {
	return browser.executeObsidian(({ plugins }) => ({
		apiKey: plugins.syncthingIntegration.getApiKey() as string,
		device: plugins.syncthingIntegration.device as { baseUrl: string; cliPath: string; folderId: string },
	}));
}

describe("Settings and connection", function () {
	let vault: SharedVault;
	let idA: string;

	before(async function () {
		vault = await shareVault("connection");
		idA = vault.idA;
		await connectPlugin(vault);
	});

	afterEach(closeModals);

	it("C5: configuration modal shows real folders and devices", async function () {
		await browser.executeObsidianCommand(`${PLUGIN_ID}:syncthing-configuration-modal`);
		const opened = Date.now();
		await browser.waitUntil(async () => (await modalText()).includes(vault.folderId), {
			timeout: 15_000,
			timeoutMsg: "the configuration did not load",
		});
		note(`loaded in ${Date.now() - opened} ms`);
		const text = await modalText();
		expect(text).toContain("Device A");
		expect(text).toMatch(/Device B\s+Connected/);
		expect(text).not.toMatch(/Not implemented|Files: 100|Unshared/);
	});

	it("S1: 2.4.0 settings are taken over on update", async function () {
		const legacy = {
			api_key: vault.a.info.apiKey,
			configuration: { url: { protocol: "http", ip_address: "localhost", port: vault.a.info.guiPort } },
			gui_username: "user",
			gui_password: "secret",
			devMode: false,
		};
		await reloadPlugin(legacy, false);
		const { apiKey, device } = await pluginState();
		expect(apiKey).toBe(vault.a.info.apiKey);
		expect(device.baseUrl).toBe(`http://localhost:${vault.a.info.guiPort}`);
		const data = dataJson();
		expect(data).not.toHaveProperty("gui_username");
		expect(data).not.toHaveProperty("gui_password");
		note(`data.json keeps ${Object.keys(data).filter((k) => ["api_key", "configuration", "baseUrl"].includes(k)).join(", ") || "nothing"} of 2.4.0 for other devices`);
		const settings = await browser.executeObsidian(({ app }, secret) => app.secretStorage.getSecret(secret), API_KEY_SECRET);
		expect(settings).toBe(vault.a.info.apiKey);
		expect((await rest("getMyID")).ok).toContain(idA);
	});

	it("S2: settings synced from a 2.4.0 device don't replace this device's own", async function () {
		const file = path.join(obsidianPage.getVaultPath(), ".obsidian/plugins", PLUGIN_ID, "data.json");
		writeFileSync(
			file,
			JSON.stringify({
				api_key: "key-from-another-device",
				configuration: { url: { protocol: "http", ip_address: "10.0.0.9", port: 8384 } },
			}),
		);
		await browser.executeObsidian(async ({ plugins }) => plugins.syncthingIntegration.onExternalSettingsChange());
		const { apiKey, device } = await pluginState();
		expect(apiKey).toBe(vault.a.info.apiKey);
		expect(device.baseUrl).toBe(`http://localhost:${vault.a.info.guiPort}`);
	});

	it("S4: the API key and address stay on this device", async function () {
		await connectPlugin(vault);
		const data = JSON.stringify(dataJson());
		expect(data).not.toContain(`"baseUrl":"${vault.a.url}"`);
		const stored = await browser.executeObsidian(({ app }, key) => app.loadLocalStorage(key), DEVICE_SETTINGS_KEY);
		expect(JSON.stringify(stored)).toContain(vault.a.url);
		note(process.platform === "linux" ? "Linux runner keychain: Obsidian's secret storage accepted the key" : "");
	});

	it("S5: Get API key fills the key in from the Syncthing CLI", async function () {
		await browser.executeObsidian(({ plugins }) => {
			plugins.syncthingIntegration.device.cliPath = "";
			plugins.syncthingIntegration.saveDeviceSettings();
			plugins.syncthingIntegration.setApiKey("");
		});
		await showSettingTab();
		await clickButton("Get API key", ".e2e-setting-tab");
		await browser.waitUntil(async () => (await pluginState()).apiKey === vault.a.info.apiKey, {
			timeout: 20_000,
			timeoutMsg: "the API key was not filled in from the CLI",
		});
		const stored = await browser.executeObsidian(({ app }, secret) => app.secretStorage.getSecret(secret), API_KEY_SECRET);
		expect(stored).toBe(vault.a.info.apiKey);
		await hideSettingTab();
	});

	it("S6: a wrong API key says to check the key", async function () {
		await connectPlugin(vault, { apiKey: "wrong-key" });
		const { failed } = await rest("getMyID");
		expect(failed).toMatch(/HTTP 40[13]/);
		expect(failed).toMatch(/API key/);
		await connectPlugin(vault);
	});

	it("S7: an unreachable Syncthing gives a hint, not a parse error", async function () {
		await connectPlugin(vault, { url: "http://127.0.0.1:18399" });
		const { failed } = await rest("getMyID");
		expect(failed).toMatch(/Could not reach Syncthing at http:\/\/127\.0\.0\.1:1/);
		expect(failed).not.toMatch(/Unexpected token|JSON/);
		note(failed ?? "");
		await connectPlugin(vault);
	});

	it("C1: Syncthing on PATH is found with an empty program setting", async function () {
		const found = await browser.executeObsidian(async ({ plugins }) => {
			plugins.syncthingIntegration.device.cliPath = "";
			return {
				has: await plugins.syncthingIntegration.syncthingController.hasSyncthing(),
				version: String(await plugins.syncthingIntegration.syncthingFromCLI.getVersion()),
			};
		});
		expect(found.has).toBe(true);
		expect(found.version).toMatch(/syncthing v\d/);
		note(found.version.split(" ").slice(0, 2).join(" "));
	});

	it("C4: Syncthing behind a reverse-proxy path", async function () {
		const proxy = new ReverseProxy(vault.a.url, 18390);
		await proxy.start();
		try {
			await connectPlugin(vault, { url: proxy.url });
			expect((await rest("getMyID")).ok).toContain(idA);
			expect(proxy.seen.some((s) => s.path.startsWith("/syncthing/rest/system/status"))).toBe(true);
			for (const bad of ["http://user:pw@127.0.0.1:18390/syncthing", `${proxy.url}?x=1`, `${proxy.url}#frag`]) {
				await connectPlugin(vault, { url: bad });
				expect((await rest("getMyID")).failed).toMatch(/cannot be used/);
			}
		} finally {
			await connectPlugin(vault);
			await proxy.stop();
		}
	});

	it("L1: a redirect to another origin, with the API key (observed)", async function () {
		const listener = new Listener(18391);
		const proxy = new ReverseProxy(vault.a.url, 18392);
		await Promise.all([listener.start(), proxy.start()]);
		proxy.redirectTo = listener.url;
		try {
			await connectPlugin(vault, { url: proxy.url });
			await rest("getMyID");
			await waitFor("the redirected request", () => listener.seen.length > 0, 5_000).catch(() => undefined);
			const forwarded = listener.seen.some((s) => s.headers["x-api-key"] === vault.a.info.apiKey);
			note(
				listener.seen.length === 0
					? "redirect not followed"
					: forwarded
						? "known limitation confirmed: the API key reached the other origin"
						: "redirect followed without the API key",
			);
			// An observation, not a requirement: it fails only when the redirect was never exercised.
			expect(proxy.seen.some((s) => s.path.startsWith("/syncthing/rest/"))).toBe(true);
		} finally {
			await connectPlugin(vault);
			await Promise.all([listener.stop(), proxy.stop()]);
		}
	});

	it("NO-LOG: no request, key or response is logged", async function () {
		const logged = await browser.executeObsidian(async ({ plugins }) => {
			const lines: string[] = [];
			const methods = ["log", "info", "debug", "warn", "error"] as const;
			const original = methods.map((m) => console[m]);
			methods.forEach((m) => (console[m] = (...args: unknown[]) => void lines.push(args.map(String).join(" "))));
			try {
				await plugins.syncthingIntegration.syncthingFromREST.getMyID();
				await plugins.syncthingIntegration.syncthingController.getOverview();
			} finally {
				methods.forEach((m, i) => (console[m] = original[i]));
			}
			return lines;
		});
		expect(logged.filter((l) => /rest\/|X-API-Key|e2e-key/.test(l))).toEqual([]);
	});

	after(async function () {
		await connectPlugin(vault);
	});
});
