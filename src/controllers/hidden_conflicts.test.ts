import { describe, expect, it, vi } from "vitest";
import type { DataAdapter } from "obsidian";
import { findHiddenConflicts } from "./hidden_conflicts";

/** An adapter over a list of file paths, each with a size of its path's length. */
function adapter(paths: string[]): DataAdapter {
	const folders = new Set<string>();
	for (const path of paths) {
		const parts = path.split("/");
		for (let index = 1; index < parts.length; index++) folders.add(parts.slice(0, index).join("/"));
	}
	const children = (folder: string, of: Iterable<string>) =>
		[...of].filter((path) => {
			const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
			return parent === folder;
		});
	return {
		list: vi.fn(async (folder: string) => ({
			files: children(folder, paths),
			folders: children(folder, folders),
		})),
		stat: vi.fn(async (path: string) =>
			paths.includes(path)
				? { type: "file", ctime: 0, mtime: 7, size: path.length }
				: folders.has(path)
					? { type: "folder", ctime: 0, mtime: 0, size: 0 }
					: null,
		),
	} as unknown as DataAdapter;
}

describe("findHiddenConflicts", () => {
	it("finds conflicts in hidden folders, at any depth, with their originals", async () => {
		const result = await findHiddenConflicts(
			adapter([
				".obsidian/app.json",
				".obsidian/app.sync-conflict-20220101-000000-BBBBBBB.json",
				".obsidian_phone/plugins/x/data.sync-conflict-20220101-000000-CCCCCCC.json",
				".obsidian/odd.sync-conflict-x.json",
				"notes/Note.sync-conflict-20220101-000000-BBBBBBB.md",
			]),
		);

		expect(result.truncated).toBe(false);
		expect(result.unrecognised).toEqual([".obsidian/odd.sync-conflict-x.json"]);
		expect(result.conflicts.map(({ path, originalPath, original }) => ({ path, originalPath, original }))).toEqual([
			{
				path: ".obsidian/app.sync-conflict-20220101-000000-BBBBBBB.json",
				originalPath: ".obsidian/app.json",
				original: { size: 18, mtime: 7 },
			},
			{
				path: ".obsidian_phone/plugins/x/data.sync-conflict-20220101-000000-CCCCCCC.json",
				originalPath: ".obsidian_phone/plugins/x/data.json",
				original: undefined,
			},
		]);
	});

	it("finds dot-folders and dot-files below ordinary folders, but not indexed files", async () => {
		const result = await findHiddenConflicts(
			adapter([
				"Projects/.excalidraw/x.sync-conflict-20260101-120000-ABCDEFG.json",
				".gitignore.sync-conflict-20260101-120000-ABCDEFG",
				"notes/Note.sync-conflict-20220101-000000-BBBBBBB.md",
			]),
		);

		expect(result.conflicts.map((conflict) => conflict.originalPath).sort()).toEqual([
			".gitignore",
			"Projects/.excalidraw/x.json",
		]);
	});

	it("does not search the trash, version control or Syncthing's own folders", async () => {
		const result = await findHiddenConflicts(
			adapter([
				".trash/a.sync-conflict-20220101-000000-BBBBBBB.md",
				".git/b.sync-conflict-20220101-000000-BBBBBBB",
				".stversions/c.sync-conflict-20220101-000000-BBBBBBB.md",
				".obsidian/plugins/p/node_modules/d.sync-conflict-20220101-000000-BBBBBBB.js",
			]),
		);

		expect(result.conflicts).toEqual([]);
	});
});
