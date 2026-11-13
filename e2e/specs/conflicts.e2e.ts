import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { browser, expect } from "@wdio/globals";
import { afterEach, before, describe, it } from "mocha";
import { sleep, waitFor } from "../helpers/syncthing.ts";
import {
	clickButton,
	closeModals,
	conflictsOf,
	connectPlugin,
	exists,
	makeConflict,
	modalText,
	note,
	PLUGIN_ID,
	shareVault,
	takeNotices,
	trashed,
	writeOnPeer,
	type SharedVault,
} from "../helpers/vault.ts";

/** The conflicts the plugin lists, by original path. */
async function listed(): Promise<Record<string, string[]>> {
	return browser.executeObsidian(async ({ plugins }) => {
		const { conflicts } = await plugins.syncthingIntegration.syncthingController.getConflicts();
		return Object.fromEntries(
			[...(conflicts as Map<string, { path: string }[]>)].map(([original, files]) => [original, files.map((f) => f.path)]),
		);
	});
}

async function openConflictsModal() {
	await browser.executeObsidianCommand(`${PLUGIN_ID}:syncthing-conflicts-modal`);
	await browser.waitUntil(async () => (await modalText()).length > 0, { timeout: 10_000 });
}

/** Opens the diff of `original` from the conflicts list, as a user does. */
async function openDiff(original: string) {
	await openConflictsModal();
	await browser.waitUntil(
		() =>
			browser.executeObsidian((_, original) => {
				const item = [...document.querySelectorAll(".modal-container details")].find(
					(el) => el.querySelector("summary span")?.textContent?.trim() === original,
				);
				const button = item?.querySelector("button.mod-cta") as HTMLButtonElement | undefined;
				button?.click();
				return !!button;
			}, original),
		{ timeout: 10_000, timeoutMsg: `${original} is not in the conflicts list` },
	);
	await browser.waitUntil(async () => (await modalText()).includes("Quick difference view"), { timeout: 15_000 });
	// The actions are enabled once the diff is shown.
	await browser.waitUntil(
		() =>
			browser.executeObsidian(() =>
				[...document.querySelectorAll(".modal-container button")].some(
					(b) => b.textContent?.trim() === "Accept original" && !(b as HTMLButtonElement).disabled,
				),
			),
		{ timeout: 30_000, timeoutMsg: "the diff never became ready" },
	);
}

const read = (vault: SharedVault, file: string) => readFileSync(path.join(vault.vaultPath, file), "utf8");
const dir = (vault: SharedVault, folder: string) =>
	existsSync(path.join(vault.vaultPath, folder)) ? readdirSync(path.join(vault.vaultPath, folder)) : [];

describe("Conflicts: detection, previews and resolution", function () {
	let vault: SharedVault;

	before(async function () {
		vault = await shareVault("conflicts");
		await connectPlugin(vault);
	});

	afterEach(closeModals);

	describe("Detection", function () {
		it("D1: real conflicts are listed under their exact original path", async function () {
			await makeConflict(vault, "a/Note.md", "# Note in a, edited on A\n", "# Note in a, edited on B\n");
			await makeConflict(vault, "b/Note.md", "# Note in b, edited on A\n", "# Note in b, edited on B\n");
			await makeConflict(vault, "b/My Note.md", "# My Note, A\n", "# My Note, B\n");
			const conflicts = await listed();
			expect(Object.keys(conflicts).sort()).toEqual(["a/Note.md", "b/My Note.md", "b/Note.md"]);
			expect(conflicts["b/Note.md"]).toHaveLength(1);
			expect(conflicts["b/Note.md"][0]).toMatch(/^b\/Note\.sync-conflict-/);
			expect(conflicts["b/My Note.md"][0]).toMatch(/^b\/My Note\.sync-conflict-/);
			await openConflictsModal();
			const text = await modalText();
			for (const original of ["a/Note.md", "b/Note.md", "b/My Note.md"]) expect(text).toContain(original);
		});

		it("D2: files without an extension and with double extensions", async function () {
			await makeConflict(vault, "d2/README", "A\n", "B\n");
			await makeConflict(vault, "d2/backup.tar.gz", randomBytes(2048), randomBytes(2048));
			const conflicts = await listed();
			expect(conflicts["d2/README"]).toHaveLength(1);
			expect(conflicts["d2/README"][0]).toMatch(/^d2\/README\.sync-conflict-\d{8}-\d{6}-[A-Z2-7]{7}$/);
			expect(conflicts["d2/backup.tar.gz"]).toHaveLength(1);
			note("Syncthing makes no conflict copy of a conflict copy, so nested names only come from older versions");
		});

		it("D3: a new conflict appears without a reload, and follows its folder's rename", async function () {
			const conflict = await makeConflict(vault, "d3/Moving.md", "A\n", "B\n");
			expect((await listed())["d3/Moving.md"]).toEqual([conflict]);
			await browser.executeObsidian(async ({ app }) => {
				const folder = app.vault.getAbstractFileByPath("d3");
				if (folder) await app.fileManager.renameFile(folder, "d3-renamed");
			});
			await browser.waitUntil(async () => !!(await listed())["d3-renamed/Moving.md"], { timeout: 10_000 });
			expect((await listed())["d3/Moving.md"]).toBeUndefined();
		});

		it("D5: conflicts in hidden folders are listed when the setting is on", async function () {
			await makeConflict(vault, ".obsidian/e2e.json", '{"from":"A"}', '{"from":"B"}', { inVault: false });
			await makeConflict(vault, ".obsidian_phone/e2e.json", '{"from":"A"}', '{"from":"B"}', { inVault: false });
			// Named like conflicts in folders that are never searched.
			for (const skipped of [".trash", ".git", ".stversions"]) {
				mkdirSync(path.join(vault.vaultPath, skipped), { recursive: true });
				writeFileSync(path.join(vault.vaultPath, skipped, "Old.sync-conflict-20250101-120000-ABCDEFG.md"), "x", {
					flag: "w",
				});
			}
			await browser.executeObsidian(async ({ plugins }) => {
				plugins.syncthingIntegration.settings.hiddenConflicts = true;
				await plugins.syncthingIntegration.saveSettings();
			});
			await openConflictsModal();
			await browser.waitUntil(async () => (await modalText()).includes("In hidden folders"), { timeout: 15_000 });
			const text = await modalText();
			expect(text).toContain(".obsidian/e2e.json");
			expect(text).toContain(".obsidian_phone/e2e.json");
			expect(text).not.toMatch(/\.trash|\.git\/|\.stversions/);
		}).timeout(300_000);

		it("D6: with the setting off the hidden section is gone", async function () {
			await browser.executeObsidian(async ({ plugins }) => {
				plugins.syncthingIntegration.settings.hiddenConflicts = false;
				await plugins.syncthingIntegration.saveSettings();
			});
			await openConflictsModal();
			await sleep(2000);
			expect(await modalText()).not.toContain("In hidden folders");
			const saved = JSON.parse(
				readFileSync(path.join(vault.vaultPath, ".obsidian/plugins", PLUGIN_ID, "data.json"), "utf8"),
			);
			expect(saved.hiddenConflicts).toBe(false);
		});
	});

	describe("Previews", function () {
		const unsafe = [
			"# Test",
			'<img src=x onerror="window.e2eRan=1">',
			'<iframe src="https://example.com/frame"></iframe>',
			"<style>body{display:none}</style>",
			"",
			"![remote](https://example.com/pixel.png)",
			"",
			"[bad](javascript:window.e2eRan=2) [ok](https://example.com)",
			"",
			"- [x] task",
			"",
			"| a | b |",
			"| - | - |",
			"| 1 | 2 |",
			"",
		].join("\n");

		before(async function () {
			await makeConflict(vault, "p/Unsafe.md", "# Test\n\nSafe on A\n", unsafe);
		});

		it("P1: opening the diff runs nothing and loads nothing remote", async function () {
			await browser.executeObsidian(() => {
				const w = window as unknown as { e2eRan?: number; e2eAlert: number };
				w.e2eRan = undefined;
				w.e2eAlert = 0;
				window.alert = () => void w.e2eAlert++;
				performance.clearResourceTimings();
			});
			await openDiff("p/Unsafe.md");
			await browser.waitUntil(
				() => browser.executeObsidian(() => document.querySelectorAll(".modal-container .preview h1").length >= 2),
				{ timeout: 10_000, timeoutMsg: "the previews did not render" },
			);
			await sleep(1500);
			const result = await browser.executeObsidian(() => {
				const previews = [...document.querySelectorAll(".modal-container .preview")];
				return {
					ran: (window as unknown as { e2eRan?: number }).e2eRan ?? null,
					bodyHidden: getComputedStyle(document.body).display === "none",
					remote: performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("example.com")),
					dangerous: previews.flatMap((p) => [...p.querySelectorAll("img, iframe, style, script, svg, object, embed")]).length,
					text: previews.map((p) => (p as HTMLElement).innerText).join("\n"),
				};
			});
			expect(result.ran).toBeNull();
			expect(result.bodyHidden).toBe(false);
			expect(result.remote).toEqual([]);
			expect(result.dangerous).toBe(0);
			expect(result.text).toContain("remote");
		});

		it("P2: only safe links are kept", async function () {
			await openDiff("p/Unsafe.md");
			await browser.waitUntil(
				() => browser.executeObsidian(() => document.querySelectorAll(".modal-container .preview h1").length >= 2),
				{ timeout: 10_000 },
			);
			await browser.waitUntil(
				() => browser.executeObsidian(() => document.querySelectorAll(".modal-container .preview a").length > 0),
				{ timeout: 10_000 },
			).catch(async () => {
				note(await browser.executeObsidian(() => [...document.querySelectorAll(".modal-container .preview")].map((p) => p.innerHTML).join(" || ").slice(0, 600)));
			});
			const links = await browser.executeObsidian(() =>
				[...document.querySelectorAll(".modal-container .preview a")].map((a) => [a.textContent, a.getAttribute("href")]),
			);
			expect(links).toContainEqual(["ok", "https://example.com/"]);
			// A link with an unsafe target keeps its text, without a target to follow.
			expect(links).toContainEqual(["bad", null]);
			expect(links.filter(([, href]) => href !== null && !/^https?:|^mailto:/.test(href))).toEqual([]);
		});

		it("P4: Markdown renders, with a disabled task checkbox", async function () {
			await openDiff("p/Unsafe.md");
			await browser.waitUntil(
				() => browser.executeObsidian(() => document.querySelectorAll(".modal-container .preview table").length >= 1),
				{ timeout: 10_000, timeoutMsg: "the table did not render" },
			);
			const checkbox = await browser.executeObsidian(() => {
				const box = document.querySelector(".modal-container .preview input[type=checkbox]") as HTMLInputElement | null;
				return box && { checked: box.checked, disabled: box.disabled };
			});
			expect(checkbox).toEqual({ checked: true, disabled: true });
		});

		it("P3: the merge preview stays safe and follows typing", async function () {
			await openDiff("p/Unsafe.md");
			await clickButton("Open in Merge Editor");
			await browser.waitUntil(() => browser.executeObsidian(() => !!document.querySelector(".syncthing-merge-editor .cm-content")), {
				timeout: 10_000,
			});
			const before = Date.now();
			await browser.executeObsidian(() => {
				const editor = document.querySelector(".syncthing-merge-editor .cm-merge-a .cm-content") as HTMLElement;
				editor.focus();
			});
			await browser.keys([..."\n<img src=y onerror=\"window.e2eRan=3\">typed-marker"]);
			await browser.waitUntil(
				() => browser.executeObsidian(() => (document.querySelector(".syncthing-merge-editor ~ * .preview, .modal-container .syncthing-merge-editor .preview") as HTMLElement | null)?.innerText.includes("typed-marker") ?? false),
				{ timeout: 5_000, timeoutMsg: "the merge preview did not follow the typing" },
			);
			note(`preview updated within ${Date.now() - before} ms of the last key`);
			expect(await browser.executeObsidian(() => (window as unknown as { e2eRan?: number }).e2eRan ?? null)).toBeNull();
			await clickButton("Cancel merge");
			await clickButton("Yes");
		});
	});

	describe("Resolution", function () {
		it("R1: Accept original trashes the conflict and leaves the original", async function () {
			const conflict = await makeConflict(vault, "r/One.md", "One on A\n", "One on B\n");
			await openDiff("r/One.md");
			await clickButton("Accept original");
			await waitFor("the conflict to go", () => !exists(vault, conflict), 10_000);
			expect(read(vault, "r/One.md")).toBe("One on A\n");
			expect(trashed(vault).some((f) => f.includes(path.basename(conflict)))).toBe(true);
		});

		it("R2: Accept conflict changes keeps the path and links, and trashes the old text", async function () {
			await writeOnPeer(vault, "r/Linker.md", "See [[Two]].\n");
			const conflict = await makeConflict(vault, "r/Two.md", "Two on A\n", "Two on B\n");
			await openDiff("r/Two.md");
			await clickButton("Accept conflict changes");
			await waitFor("the conflict to go", () => !exists(vault, conflict), 10_000);
			expect(read(vault, "r/Two.md")).toBe("Two on B\n");
			expect(read(vault, "r/Linker.md")).toBe("See [[Two]].\n");
			const trash = trashed(vault);
			expect(trash.some((f) => /Two\.before-accepting-conflict-.*\.md$/.test(f))).toBe(true);
			expect(trash.some((f) => f.includes(path.basename(conflict)))).toBe(true);
			note(`trash: ${trash.filter((f) => f.includes("Two")).join(", ")}`);
		});

		it("L3: the backup copy does not reach the other device", async function () {
			await sleep(15_000);
			const leaked = readdirSync(vault.peerPath, { recursive: true }).map(String).filter((f) => f.includes("before-"));
			expect(leaked).toEqual([]);
		});

		it("R3: a merge is saved into the original, with a backup", async function () {
			const conflict = await makeConflict(vault, "r/Three.md", "line A\n", "line B\n");
			await openDiff("r/Three.md");
			await clickButton("Open in Merge Editor");
			await browser.waitUntil(() => browser.executeObsidian(() => !!document.querySelector(".syncthing-merge-editor .cm-content")));
			await browser.executeObsidian(() =>
				(document.querySelector(".syncthing-merge-editor .cm-merge-a .cm-content") as HTMLElement).focus(),
			);
			await browser.keys(["End"]);
			await browser.keys([..." and B"]);
			await clickButton("Save merged file");
			await sleep(500);
			if ((await modalText()).includes("still unresolved")) await clickButton("Yes");
			await waitFor("the conflict to go", () => !exists(vault, conflict), 10_000);
			expect(read(vault, "r/Three.md")).toBe("line A and B\n");
			expect(trashed(vault).some((f) => /Three\.before-merge-.*\.md$/.test(f))).toBe(true);
		});

		it("R4: saving without editing, with differences left, keeps the left side", async function () {
			const conflict = await makeConflict(vault, "r/Four.md", "Four on A\n", "Four on B\n");
			await openDiff("r/Four.md");
			await clickButton("Open in Merge Editor");
			await browser.waitUntil(() => browser.executeObsidian(() => !!document.querySelector(".syncthing-merge-editor .cm-content")));
			await takeNotices();
			await clickButton("Save merged file");
			await browser.waitUntil(async () => (await modalText()).includes("still unresolved"), { timeout: 5_000 });
			await clickButton("Yes");
			await waitFor("the conflict to go", () => !exists(vault, conflict), 10_000);
			expect(read(vault, "r/Four.md")).toBe("Four on A\n");
			expect((await takeNotices()).join(" ")).not.toMatch(/Could not/);
		});

		it("R5: with two conflicts, the next one is shown after the first", async function () {
			const first = await makeConflict(vault, "r/Five.md", "Five A1\n", "Five B1\n");
			await sleep(1100);
			const second = await makeConflict(vault, "r/Five.md", "Five A2\n", "Five B2\n");
			expect(first).not.toBe(second);
			await openDiff("r/Five.md");
			await clickButton("Accept original");
			await waitFor("one conflict to go", () => conflictsOf(path.join(vault.vaultPath, "r"), "Five.md").length === 1, 10_000);
			expect(await modalText()).toContain("Quick difference view");
			await clickButton("Accept original");
			await waitFor("both conflicts to go", () => conflictsOf(path.join(vault.vaultPath, "r"), "Five.md").length === 0, 10_000);
			await browser.waitUntil(async () => !(await modalText()).includes("Quick difference view"), { timeout: 5_000 });
		});

		it("R6: a change to the original while the diff is open is not overwritten", async function () {
			const conflict = await makeConflict(vault, "r/Six.md", "Six on A\n", "Six on B\n");
			await openDiff("r/Six.md");
			await writeOnPeer(vault, "r/Six.md", "Six changed on B meanwhile\n");
			await waitFor("the change to arrive", () => read(vault, "r/Six.md") === "Six changed on B meanwhile\n", 30_000);
			await takeNotices();
			await clickButton("Accept conflict changes");
			await browser.waitUntil(async () => (await takeNotices()).some((n) => n.includes("changed while resolving")), {
				timeout: 10_000,
				timeoutMsg: "no notice that the original changed",
			});
			expect(read(vault, "r/Six.md")).toBe("Six changed on B meanwhile\n");
			expect(exists(vault, conflict)).toBe(true);
		});

		it("R7: Keep both renames the conflict next to the original", async function () {
			const conflict = await makeConflict(vault, "r/Seven.md", "Seven on A\n", "Seven on B\n");
			await openDiff("r/Seven.md");
			await clickButton("Keep both");
			await waitFor("the conflict to be renamed", () => !exists(vault, conflict), 10_000);
			const kept = dir(vault, "r").filter((f) => f.startsWith("Seven (conflict"));
			expect(kept).toHaveLength(1);
			expect(kept[0]).toMatch(/^Seven \(conflict from .+, \d{4}-\d{2}-\d{2} \d{6}\)\.md$/);
			expect(read(vault, `r/${kept[0]}`)).toBe("Seven on B\n");
			note(kept[0]);
		});

		it("R8: an orphaned conflict can be restored or trashed", async function () {
			const restoreMe = await makeConflict(vault, "r/Eight.md", "Eight on A\n", "Eight on B\n");
			const trashMe = await makeConflict(vault, "r/Nine.md", "Nine on A\n", "Nine on B\n");
			for (const original of ["r/Eight.md", "r/Nine.md"]) rmSync(path.join(vault.vaultPath, original));
			await waitFor("Obsidian to see the deletions", () =>
				browser.executeObsidian(({ app }) => !app.vault.getAbstractFileByPath("r/Eight.md") && !app.vault.getAbstractFileByPath("r/Nine.md")),
			);
			await openConflictsModal();
			for (const [original, action] of [["r/Eight.md", "Restore as original"], ["r/Nine.md", "Move to trash"]] as const) {
				await browser.executeObsidian((_, original) => {
					const item = [...document.querySelectorAll(".modal-container details")].find(
						(el) => el.querySelector("summary span")?.textContent?.trim() === original,
					);
					(item?.querySelector("button.mod-cta") as HTMLButtonElement).click();
				}, original);
				await browser.waitUntil(async () => (await modalText()).includes("Original file missing"), { timeout: 10_000 });
				await clickButton(action);
				await sleep(1000);
			}
			expect(read(vault, "r/Eight.md")).toBe("Eight on B\n");
			expect(exists(vault, restoreMe)).toBe(false);
			expect(exists(vault, trashMe)).toBe(false);
			expect(exists(vault, "r/Nine.md")).toBe(false);
		});

		it("R9: a large PDF and an image are compared by details, and kept byte for byte", async function () {
			const pdfA = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(20 * 1024 * 1024)]);
			const pdfB = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(20 * 1024 * 1024)]);
			const conflict = await makeConflict(vault, "r/big.pdf", pdfA, pdfB);
			const opened = Date.now();
			await openDiff("r/big.pdf");
			note(`diff ready in ${Date.now() - opened} ms`);
			const text = await modalText();
			expect(text).not.toContain("Open in Merge Editor");
			await clickButton("Accept conflict changes");
			await waitFor("the conflict to go", () => !exists(vault, conflict), 30_000);
			expect(readFileSync(path.join(vault.vaultPath, "r/big.pdf")).equals(pdfB)).toBe(true);

			const pngA = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(4096)]);
			const pngB = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(4096)]);
			const png = await makeConflict(vault, "r/image.png", pngA, pngB);
			await openDiff("r/image.png");
			await clickButton("Accept original");
			await waitFor("the conflict to go", () => !exists(vault, png), 10_000);
			expect(readFileSync(path.join(vault.vaultPath, "r/image.png")).equals(pngA)).toBe(true);
		}).timeout(300_000);

		it("R10: hidden conflicts can be kept, replaced or trashed", async function () {
			const kept = await makeConflict(vault, ".obsidian/keep.json", '{"v":"A"}', '{"v":"B"}', { inVault: false });
			const replaced = await makeConflict(vault, ".obsidian/replace.json", '{"v":"A"}', '{"v":"B"}', { inVault: false });
			const orphan = await makeConflict(vault, ".obsidian/orphan.json", '{"v":"A"}', '{"v":"B"}', { inVault: false });
			rmSync(path.join(vault.vaultPath, ".obsidian/orphan.json"));
			await browser.executeObsidian(async ({ plugins }) => {
				plugins.syncthingIntegration.settings.hiddenConflicts = true;
				await plugins.syncthingIntegration.saveSettings();
			});
			const act = async (original: string, action: string) => {
				await closeModals();
				await openConflictsModal();
				await browser.waitUntil(async () => (await modalText()).includes(original), { timeout: 15_000 });
				await browser.executeObsidian(
					(_, original, action) => {
						const item = [...document.querySelectorAll(".modal-container .item")].find(
							(el) => el.querySelector(".path")?.textContent?.trim() === original,
						);
						const button = [...(item?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === action);
						(button as HTMLButtonElement).click();
					},
					original,
					action,
				);
				await sleep(1500);
			};
			await takeNotices();
			await act(".obsidian/keep.json", "Keep original");
			await act(".obsidian/replace.json", "Keep conflict");
			await act(".obsidian/orphan.json", "Move conflict to trash");
			expect(exists(vault, kept)).toBe(false);
			expect(read(vault, ".obsidian/keep.json")).toBe('{"v":"A"}');
			expect(exists(vault, replaced)).toBe(false);
			expect(read(vault, ".obsidian/replace.json")).toBe('{"v":"B"}');
			expect(exists(vault, orphan)).toBe(false);
			const notices = (await takeNotices()).join(" | ");
			note(notices);
			expect(notices).toMatch(/reload/i);
		}).timeout(300_000);
	});
});
