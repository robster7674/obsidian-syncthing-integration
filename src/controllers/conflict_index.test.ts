import { describe, expect, it, vi } from "vitest";
import type { TFile, Vault } from "obsidian";
import { makeFile } from "../../test/helpers/files";
import { ConflictIndex } from "./conflict_index";

const CONFLICT = "b/Note.sync-conflict-20220101-000000-BBBBBBB.md";

function setup(paths: string[]) {
	const files = paths.map((path) => makeFile(path));
	const vault = { getFiles: vi.fn(() => files) } as unknown as Vault;
	return { files, vault, index: new ConflictIndex(vault) };
}

describe("ConflictIndex", () => {
	it("groups conflicts by their original's path, scanning the vault only once", () => {
		const { index, vault, files } = setup(["a/Note.md", "b/Note.md", CONFLICT, "c/odd.sync-conflict-x.md"]);

		expect(index.conflictsOf("b/Note.md")).toEqual([files[2]]);
		expect(index.conflictsOf("a/Note.md")).toEqual([]);
		expect(index.all()).toEqual({
			conflicts: new Map([["b/Note.md", [files[2]]]]),
			unrecognised: [files[3]],
		});
		expect(vault.getFiles).toHaveBeenCalledTimes(1);
	});

	it("follows created, deleted and renamed files", () => {
		const { index } = setup(["b/Note.md"]);
		expect(index.conflictsOf("b/Note.md")).toEqual([]);

		const conflict = makeFile(CONFLICT);
		index.created(conflict);
		expect(index.conflictsOf("b/Note.md")).toEqual([conflict]);

		const oldPath = conflict.path;
		Object.assign(conflict, makeFile("b/Note (kept).md"), { stat: conflict.stat });
		index.renamed(conflict as TFile, oldPath);
		expect(index.conflictsOf("b/Note.md")).toEqual([]);
		expect(index.all().conflicts.size).toBe(0);

		const second = makeFile("b/Note.sync-conflict-20230101-000000-CCCCCCC.md");
		index.created(second);
		index.deleted(second);
		expect(index.conflictsOf("b/Note.md")).toEqual([]);
	});

	it("moves a conflict renamed into another folder to that folder's original", () => {
		const { index, files } = setup(["b/Note.md", CONFLICT]);
		index.conflictsOf("b/Note.md");
		const moved = files[1];

		Object.assign(moved, { path: "c/Note.sync-conflict-20220101-000000-BBBBBBB.md" });
		index.renamed(moved, CONFLICT);

		expect(index.conflictsOf("b/Note.md")).toEqual([]);
		expect(index.conflictsOf("c/Note.md")).toEqual([moved]);
	});

	it("ignores events until it is first used, then reads the whole vault", () => {
		const { index, files } = setup([]);
		const early = makeFile(CONFLICT);
		index.created(early);
		files.push(early);

		expect(index.conflictsOf("b/Note.md")).toEqual([early]);
	});
});

describe("ConflictIndex with folders", () => {
	it("drops the conflicts of a deleted folder and moves those of a renamed one", async () => {
		const { TFolder } = await import("obsidian");
		const { index, files } = setup(["b/Note.md", CONFLICT]);
		index.conflictsOf("b/Note.md");
		const folder = new TFolder();
		folder.path = "c";
		const moved = files[1];
		Object.assign(moved, { path: "c/Note.sync-conflict-20220101-000000-BBBBBBB.md" });
		folder.children = [moved];

		index.renamed(folder, "b");
		expect(index.conflictsOf("b/Note.md")).toEqual([]);
		expect(index.conflictsOf("c/Note.md")).toEqual([moved]);

		index.deleted(folder);
		expect(index.all().conflicts.size).toBe(0);
	});
});
