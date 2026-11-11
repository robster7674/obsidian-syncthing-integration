import { describe, expect, it } from "vitest";
import { makeMemoryVault } from "../../test/helpers/vault";
import { ConflictResolver } from "./conflict_resolution";

const ORIGINAL = "b/Note.md";
const CONFLICT = "b/Note.sync-conflict-20220101-000000-BBBBBBB.md";

function setup() {
	const memory = makeMemoryVault({
		"a/Note.md": "other folder",
		[ORIGINAL]: "local",
		[CONFLICT]: "remote",
	});
	return { memory, resolver: new ConflictResolver(memory.app) };
}

describe("ConflictResolver.keepOriginal", () => {
	it("moves only the conflict to the trash", async () => {
		const { memory, resolver } = setup();

		await resolver.keepOriginal(memory.file(CONFLICT));

		expect(memory.content(ORIGINAL)).toBe("local");
		expect(memory.content(CONFLICT)).toBeUndefined();
		expect(memory.trashed).toEqual([{ path: CONFLICT, content: "remote" }]);
		expect(memory.content("a/Note.md")).toBe("other folder");
	});
});

describe("ConflictResolver.keepConflict", () => {
	it("trashes the original, then gives the conflict its path", async () => {
		const { memory, resolver } = setup();
		const conflict = memory.file(CONFLICT);

		await resolver.keepConflict(memory.file(ORIGINAL), conflict);

		expect(memory.content(ORIGINAL)).toBe("remote");
		expect(memory.content(CONFLICT)).toBeUndefined();
		expect(conflict.path).toBe(ORIGINAL);
		expect(memory.trashed).toEqual([{ path: ORIGINAL, content: "local" }]);
		expect(memory.content("a/Note.md")).toBe("other folder");
	});

	it("leaves both files in place when trashing the original fails", async () => {
		const { memory, resolver } = setup();
		memory.app.vault.trash = async () => {
			throw new Error("trash unavailable");
		};

		await expect(
			resolver.keepConflict(memory.file(ORIGINAL), memory.file(CONFLICT)),
		).rejects.toThrow("trash unavailable");

		expect(memory.content(ORIGINAL)).toBe("local");
		expect(memory.content(CONFLICT)).toBe("remote");
		expect(memory.app.fileManager.renameFile).not.toHaveBeenCalled();
	});
});

describe("ConflictResolver.saveMerge", () => {
	it("trashes a copy of the previous content, writes the merge, then trashes the conflict", async () => {
		const { memory, resolver } = setup();

		await resolver.saveMerge(
			memory.file(ORIGINAL),
			memory.file(CONFLICT),
			"merged",
		);

		expect(memory.content(ORIGINAL)).toBe("merged");
		expect(memory.content(CONFLICT)).toBeUndefined();
		expect(memory.trashed).toEqual([
			{
				path: expect.stringMatching(
					/^b\/Note\.before-merge-\d{8}T\d{9}Z\.md$/,
				),
				content: "local",
			},
			{ path: CONFLICT, content: "remote" },
		]);
	});

	it("does not back up an original that the merge leaves unchanged", async () => {
		const { memory, resolver } = setup();

		await resolver.saveMerge(
			memory.file(ORIGINAL),
			memory.file(CONFLICT),
			"local",
		);

		expect(memory.app.vault.modify).not.toHaveBeenCalled();
		expect(memory.trashed).toEqual([{ path: CONFLICT, content: "remote" }]);
	});

	it("keeps the conflict when writing the merge fails", async () => {
		const { memory, resolver } = setup();
		memory.app.vault.modify = async () => {
			throw new Error("disk full");
		};

		await expect(
			resolver.saveMerge(
				memory.file(ORIGINAL),
				memory.file(CONFLICT),
				"merged",
			),
		).rejects.toThrow("disk full");

		expect(memory.content(ORIGINAL)).toBe("local");
		expect(memory.content(CONFLICT)).toBe("remote");
	});
});

describe("ConflictResolver.restoreAsOriginal", () => {
	it("gives an orphaned conflict its original path", async () => {
		const memory = makeMemoryVault({ [CONFLICT]: "remote" });
		const resolver = new ConflictResolver(memory.app);

		await resolver.restoreAsOriginal(memory.file(CONFLICT), ORIGINAL);

		expect(memory.content(ORIGINAL)).toBe("remote");
		expect(memory.content(CONFLICT)).toBeUndefined();
	});

	it("refuses to overwrite an existing file", async () => {
		const { memory, resolver } = setup();

		await expect(
			resolver.restoreAsOriginal(memory.file(CONFLICT), ORIGINAL),
		).rejects.toThrow("already exists");

		expect(memory.content(ORIGINAL)).toBe("local");
		expect(memory.content(CONFLICT)).toBe("remote");
	});
});
