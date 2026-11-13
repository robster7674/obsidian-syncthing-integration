import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { browser, expect } from "@wdio/globals";
import { after, before, describe, it } from "mocha";
import {
	clickButton,
	connectPlugin,
	hideSettingTab,
	note,
	shareVault,
	showSettingTab,
	takeNotices,
	type SharedVault,
} from "../helpers/vault.ts";

async function vaultFolder() {
	return browser.executeObsidian(async ({ plugins }) => {
		const { vaultFolder } = await plugins.syncthingIntegration.syncthingController.getVaultFolder();
		return "folder" in vaultFolder
			? { id: vaultFolder.folder.id as string, vaultPath: vaultFolder.vaultPath as string | undefined, chosen: vaultFolder.chosen as boolean }
			: { failure: vaultFolder.message as string };
	});
}

async function settingText(): Promise<string> {
	return browser.executeObsidian(() => (document.querySelector(".e2e-setting-tab") as HTMLElement).innerText);
}

/** Types into the input with `placeholder` in the settings tab. */
async function typeInto(placeholder: string, text: string) {
	await browser.executeObsidian(
		(_, placeholder, text) => {
			const input = document.querySelector(`.e2e-setting-tab input[placeholder="${placeholder}"]`) as HTMLInputElement;
			input.value = text;
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
		},
		placeholder,
		text,
	);
}

describe("Vault folder and .stignore", function () {
	let vault: SharedVault;
	const stignore = () => path.join(vault.vaultPath, ".stignore");
	// Obsidian truncates a file before writing it, so wait for the whole content.
	const waitForContent = async (expected: string) => {
		await browser
			.waitUntil(() => existsSync(stignore()) && readFileSync(stignore(), "utf8") === expected, { timeout: 10_000 })
			.catch(() => undefined);
		expect(readFileSync(stignore(), "utf8")).toBe(expected);
	};

	before(async function () {
		vault = await shareVault("folder");
		await connectPlugin(vault);
	});

	it("F1: the vault is matched to its Syncthing folder by path", async function () {
		expect(await vaultFolder()).toEqual({ id: vault.folderId, vaultPath: "", chosen: false });
	});

	it("F2: a folder that starts above the vault is matched, and the editor explains", async function () {
		// The vault's parent, paused so Syncthing never scans or writes it.
		const parent = path.dirname(vault.vaultPath);
		const marker = path.join(parent, ".stfolder");
		const markerBefore = existsSync(marker);
		await vault.a.request("PUT", "/rest/config/folders/e2e-parent", {
			id: "e2e-parent",
			label: "e2e-parent",
			path: parent,
			type: "receiveonly",
			paused: true,
			devices: [{ deviceID: vault.idA }],
		});
		const vaultConfig = await vault.a.request("GET", `/rest/config/folders/${vault.folderId}`);
		await vault.a.removeFolder(vault.folderId);
		try {
			expect(await vaultFolder()).toEqual({ id: "e2e-parent", vaultPath: path.basename(vault.vaultPath), chosen: false });
			await showSettingTab();
			await browser.waitUntil(async () => (await settingText()).includes("outside the vault"), {
				timeout: 15_000,
				timeoutMsg: "the editor did not say the .stignore is outside the vault",
			});
			expect(await settingText()).not.toContain("Add pattern");
		} finally {
			await hideSettingTab();
			await vault.a.removeFolder("e2e-parent");
			await vault.a.request("PUT", `/rest/config/folders/${vault.folderId}`, vaultConfig);
			await vault.a.waitInSync(vault.folderId, vault.idB);
		}
		expect(existsSync(marker)).toBe(markerBefore);
	});

	it("F4: a chosen folder is used, and its removal is explained", async function () {
		await vault.b.shareFolder("e2e-other", path.join(process.env.E2E_WORK_DIR ?? ".e2e", "other-b"), []);
		await vault.a.shareFolder("e2e-other", path.join(process.env.E2E_WORK_DIR ?? ".e2e", "other-a"), []);
		try {
			await connectPlugin(vault, { folderId: "e2e-other" });
			expect(await vaultFolder()).toMatchObject({ id: "e2e-other", chosen: true });
			const stored = await browser.executeObsidian(({ app }) => app.loadLocalStorage("syncthing-integration-device"));
			expect(JSON.stringify(stored)).toContain("e2e-other");
			await vault.a.removeFolder("e2e-other");
			const { failure } = (await vaultFolder()) as { failure?: string };
			expect(failure).toBeTruthy();
			note(failure ?? "");
		} finally {
			await vault.a.removeFolder("e2e-other");
			await vault.b.removeFolder("e2e-other");
			await connectPlugin(vault);
		}
	});

	it("F7: a vault without .stignore shows an empty list, and adding creates it", async function () {
		rmSync(stignore(), { force: true });
		await showSettingTab();
		try {
			await browser.waitUntil(async () => (await settingText()).includes("Add pattern"), { timeout: 15_000 });
			expect(await settingText()).not.toContain("No .stignore file found");
			await clickButton("Add", ".e2e-setting-tab");
			await browser.waitUntil(() => existsSync(stignore()), { timeout: 10_000 });
			const lines = readFileSync(stignore(), "utf8").split("\n");
			expect(lines).toContain("/.obsidian/workspace.json");
			expect(lines).toContain("/.obsidian/workspace-mobile.json");
		} finally {
			await hideSettingTab();
		}
	});

	it("F5: Add pattern appends, keeping comments, blank lines, CRLF and exceptions", async function () {
		const original = "// keep my notes\r\n!/notes/keep.md\r\n\r\n/notes/*\r\n";
		writeFileSync(stignore(), original);
		await showSettingTab();
		try {
			await browser.waitUntil(async () => (await settingText()).includes("!/notes/keep.md"), { timeout: 15_000 });
			await typeInto("Enter a pattern…", "*.tmp");
			await clickButton("Add pattern", ".e2e-setting-tab");
			await waitForContent(original + "*.tmp\r\n");
			await vault.a.scan(vault.folderId);
			const { ignore } = await vault.a.request<{ ignore: string[] }>("GET", `/rest/db/ignores?folder=${vault.folderId}`);
			expect(ignore).toEqual(["// keep my notes", "!/notes/keep.md", "", "/notes/*", "*.tmp"]);
		} finally {
			await hideSettingTab();
		}
	});

	it("F6: files are anchored, duplicates refused, and removal is exact", async function () {
		writeFileSync(stignore(), "/notes/*\n*.tmp\n");
		await showSettingTab();
		try {
			await browser.waitUntil(async () => (await settingText()).includes("*.tmp"), { timeout: 15_000 });
			await typeInto("Type to search for a file", "a/Note.md");
			await browser.pause(1000);
			await clickButton("Add file/folder", ".e2e-setting-tab");
			await waitForContent("/notes/*\n*.tmp\n/a/Note.md\n");

			await takeNotices();
			await typeInto("Enter a pattern…", "*.tmp");
			await clickButton("Add pattern", ".e2e-setting-tab");
			await browser.waitUntil(async () => (await takeNotices()).length > 0, { timeout: 5_000 });
			expect(readFileSync(stignore(), "utf8")).toBe("/notes/*\n*.tmp\n/a/Note.md\n");

			await browser.executeObsidian(() => {
				const item = [...document.querySelectorAll(".e2e-setting-tab .setting-item")].find(
					(el) => el.querySelector(".setting-item-name")?.textContent?.trim() === "*.tmp",
				);
				(item?.querySelector("button") as HTMLButtonElement).click();
			});
			await waitForContent("/notes/*\n/a/Note.md\n");
		} finally {
			await hideSettingTab();
		}
	});

	after(async function () {
		writeFileSync(stignore(), "");
	});
});
