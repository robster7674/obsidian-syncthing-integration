import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { sleep, Syncthing, waitFor, type InstanceInfo } from "./syncthing.ts";

export const PLUGIN_ID = "syncthing-integration";

export interface SharedVault {
	a: Syncthing;
	b: Syncthing;
	idA: string;
	idB: string;
	folderId: string;
	/** The vault opened in Obsidian, synced by Device A. */
	vaultPath: string;
	/** Device B's copy of the vault. */
	peerPath: string;
}

export function syncthings(): [Syncthing, Syncthing] {
	const infos: InstanceInfo[] = JSON.parse(process.env.E2E_SYNCTHING ?? "[]");
	return [new Syncthing(infos[0]), new Syncthing(infos[1])];
}

/** Adds an observation to the current test's row in the results. */
export function note(text: string) {
	const notes = ((globalThis as { e2eNotes?: string[] }).e2eNotes ??= []);
	notes.push(text);
}

/**
 * Waits until Obsidian's `requestUrl` answers promptly: right after launch it
 * holds every request for a while, which is Obsidian's, not the plugin's.
 */
export async function requestUrlReady(url: string) {
	await waitFor(
		"Obsidian's requestUrl to answer promptly",
		() =>
			browser.executeObsidian(async ({ obsidian }, url) => {
				const t = Date.now();
				await Promise.race([
					obsidian.requestUrl({ url: `${url}/rest/noauth/health`, throw: false }),
					new Promise((resolve) => setTimeout(resolve, 2000)),
				]);
				return Date.now() - t < 1000;
			}, url),
		120_000,
	);
}

/** Shares the vault Obsidian opened between Device A and a fresh folder on Device B. */
export async function shareVault(name: string, stignore = ""): Promise<SharedVault> {
	const [a, b] = syncthings();
	const [idA, idB] = [await a.myId(), await b.myId()];
	// Each Obsidian session gets a fresh vault, so a folder of its own.
	for (const device of [a, b]) {
		const folders = await device.request<{ id: string }[]>("GET", "/rest/config/folders");
		for (const { id } of folders.filter(({ id }) => id.startsWith("vault-"))) await device.removeFolder(id);
	}
	const folderId = `vault-${name}-${Date.now()}`;
	const vaultPath = obsidianPage.getVaultPath();
	const peerPath = path.join(process.env.E2E_WORK_DIR ?? ".e2e", `peer-${folderId}`);
	writeFileSync(path.join(vaultPath, ".stignore"), stignore);
	await b.shareFolder(folderId, peerPath, [idA]);
	await a.shareFolder(folderId, vaultPath, [idB]);
	await a.waitInSync(folderId, idB);
	await b.waitInSync(folderId, idA);
	await requestUrlReady(a.url);
	return { a, b, idA, idB, folderId, vaultPath, peerPath };
}

/** Gives the plugin an address and API key, as a user would in the settings. */
export async function connectPlugin(
	vault: SharedVault,
	{ url = vault.a.url, apiKey = vault.a.info.apiKey, folderId = "" } = {},
) {
	await browser.executeObsidian(
		({ plugins }, url, apiKey, folderId) => {
			const plugin = plugins.syncthingIntegration;
			plugin.device.baseUrl = url;
			plugin.device.folderId = folderId;
			// Restarts the sync status once, with both changes; saving then changes nothing it follows.
			plugin.setApiKey(apiKey);
			plugin.saveDeviceSettings();
		},
		url,
		apiKey,
		folderId,
	);
}

export function conflictsOf(dir: string, name: string): string[] {
	const { name: stem } = path.parse(name);
	return existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(`${stem}.sync-conflict-`)) : [];
}

function write(root: string, file: string, data: string | Uint8Array) {
	mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
	writeFileSync(path.join(root, file), data);
}

/** Writes `file` on Device B and waits until Obsidian's vault has it. */
export async function writeOnPeer(vault: SharedVault, file: string, data: string | Uint8Array) {
	write(vault.peerPath, file, data);
	await vault.b.scan(vault.folderId);
	await waitFor(`${file} to arrive`, () => existsSync(path.join(vault.vaultPath, file)), 60_000);
	await vault.a.waitInSync(vault.folderId, vault.idB);
}

/**
 * Makes Syncthing itself produce a conflict on `file`: both devices change it
 * while disconnected, then reconnect. Resolves with the conflict's vault path
 * once Obsidian sees it.
 */
export async function makeConflict(
	vault: SharedVault,
	file: string,
	onA: string | Uint8Array,
	onB: string | Uint8Array,
	{ inVault = true } = {},
): Promise<string> {
	const { a, b, idA, idB, folderId } = vault;
	const dir = path.posix.dirname(file);
	const earlier = new Set(conflictsOf(path.join(vault.vaultPath, dir), path.basename(file)));
	await a.setDevicePaused(idB, true);
	await waitFor("devices to disconnect", async () => !(await a.connected(idB)));
	write(vault.peerPath, file, onB);
	await b.scan(folderId);
	// The later change wins, so the conflict copy holds Device B's version.
	await sleep(1100);
	write(vault.vaultPath, file, onA);
	await a.scan(folderId);
	await a.setDevicePaused(idB, false);
	const conflict = await waitFor(
		`a conflict of ${file}`,
		() => conflictsOf(path.join(vault.vaultPath, dir), path.basename(file)).find((name) => !earlier.has(name)),
		90_000,
	);
	const conflictPath = dir === "." ? conflict : `${dir}/${conflict}`;
	if (inVault) {
		await waitFor(`Obsidian to see ${conflictPath}`, () =>
			browser.executeObsidian(({ app }, p) => !!app.vault.getAbstractFileByPath(p), conflictPath),
		);
	}
	await a.waitInSync(folderId, idB, 90_000);
	await b.waitInSync(folderId, idA, 90_000);
	return conflictPath;
}

/** The texts of the notices shown since the last call. */
export async function takeNotices(): Promise<string[]> {
	return browser.executeObsidian(() => {
		const texts = [...document.querySelectorAll(".notice")].map((el) => el.textContent ?? "");
		document.querySelectorAll(".notice").forEach((el) => el.remove());
		return texts;
	});
}

export async function closeModals() {
	for (let i = 0; i < 5; i++) {
		const open = await browser.executeObsidian(() => document.querySelectorAll(".modal-container").length);
		if (open === 0) return;
		await browser.keys("Escape");
		await browser.pause(200);
	}
}

/** The text of the topmost modal. */
export async function modalText(): Promise<string> {
	return browser.executeObsidian(() => {
		const modals = document.querySelectorAll(".modal-container .modal");
		return (modals[modals.length - 1] as HTMLElement | undefined)?.innerText ?? "";
	});
}

/**
 * Clicks the enabled button labelled `text` inside the last `scope` element
 * (the topmost modal by default), once there is one.
 */
export async function clickButton(text: string, scope = ".modal-container .modal") {
	await browser.waitUntil(
		() =>
			browser.executeObsidian(
				(_, text, scope) => {
					const scopes = document.querySelectorAll(scope);
					const root = scopes[scopes.length - 1];
					const button = [...(root?.querySelectorAll("button") ?? [])].find(
						(b) => b.textContent?.trim() === text && !b.disabled,
					);
					button?.click();
					return !!button;
				},
				text,
				scope,
			),
		{ timeout: 20_000 },
	).catch(async () => {
		const seen = await browser.executeObsidian(
			(_, scope) => {
				const scopes = document.querySelectorAll(scope);
				const root = scopes[scopes.length - 1];
				return [...(root?.querySelectorAll("button") ?? [])].map((b) => b.textContent?.trim()).join(" | ");
			},
			scope,
		);
		throw new Error(`No enabled button "${text}" in ${scope}; its buttons: ${seen || "none"}`);
	});
}

export function exists(vault: SharedVault, file: string): boolean {
	return existsSync(path.join(vault.vaultPath, file));
}

/**
 * Files in the trash: Obsidian's `.trash`, or the system trash (this run's on
 * Linux, the user's on macOS). Pass an earlier result to get only what was added since.
 */
export function trashed(vault: SharedVault, before: string[] = []): string[] {
	const dirs = [
		path.join(vault.vaultPath, ".trash"),
		process.platform === "darwin"
			? path.join(process.env.HOME ?? "", ".Trash")
			: path.join(process.env.XDG_DATA_HOME ?? "", "Trash", "files"),
	];
	const earlier = new Set(before);
	return dirs
		.flatMap((dir) => {
			try {
				return readdirSync(dir, { recursive: true }).map(String);
			} catch {
				return [];
			}
		})
		.filter((file) => !earlier.has(file));
}

/** Renders the plugin's settings tab, as Obsidian does when it is opened. */
export async function showSettingTab() {
	await browser.executeObsidian(async ({ plugins }) => {
		const tab = plugins.syncthingIntegration.settingTab;
		if (!tab) throw new Error("The plugin has no settings tab");
		tab.containerEl.addClass("e2e-setting-tab");
		document.body.appendChild(tab.containerEl);
		await tab.display();
	});
}

export async function hideSettingTab() {
	await browser.executeObsidian(({ plugins }) => {
		const tab = plugins.syncthingIntegration.settingTab;
		tab?.hide();
		tab?.containerEl.remove();
	});
}
