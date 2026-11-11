import { describe, expect, it, vi } from "vitest";
import { makeMemoryVault, trashedText } from "../../test/helpers/vault";
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
		expect(trashedText(memory)).toEqual([{ path: CONFLICT, content: "remote" }]);
		expect(memory.content("a/Note.md")).toBe("other folder");
	});
});

const BACKUP = /^\.obsidian\/Note\.before-merge-\d{8}T\d{9}Z\.md$/;

describe("ConflictResolver.keepConflict", () => {
	it("puts the conflict's content in the original and both old versions in the trash", async () => {
		const { memory, resolver } = setup();
		const original = memory.file(ORIGINAL);

		await resolver.keepConflict(original, memory.file(CONFLICT));

		expect(memory.file(ORIGINAL)).toBe(original);
		expect(memory.content(ORIGINAL)).toBe("remote");
		expect(memory.content(CONFLICT)).toBeUndefined();
		expect(trashedText(memory)).toEqual([
			{ path: expect.stringMatching(BACKUP), content: "local" },
			{ path: CONFLICT, content: "remote" },
		]);
		expect(memory.hidden.size).toBe(0);
		expect(memory.content("a/Note.md")).toBe("other folder");
	});

	it("leaves both files untouched when the backup cannot be trashed", async () => {
		const { memory, resolver } = setup();
		memory.app.vault.adapter.trashSystem = async () => {
			throw new Error("trash unavailable");
		};

		await expect(
			resolver.keepConflict(memory.file(ORIGINAL), memory.file(CONFLICT)),
		).rejects.toThrow("trash unavailable");

		expect(memory.content(ORIGINAL)).toBe("local");
		expect(memory.content(CONFLICT)).toBe("remote");
		expect(memory.hidden.size).toBe(0);
		expect(memory.app.vault.modifyBinary).not.toHaveBeenCalled();
	});

	it("falls back to Obsidian's trash folder when the system trash is off", async () => {
		const { memory, resolver } = setup();
		memory.app.vault.adapter.trashSystem = vi.fn(async () => false);

		await resolver.keepConflict(memory.file(ORIGINAL), memory.file(CONFLICT));

		expect(memory.app.vault.adapter.trashLocal).toHaveBeenCalledWith(
			expect.stringMatching(BACKUP),
		);
		expect(memory.content(ORIGINAL)).toBe("remote");
	});
});

describe("ConflictResolver with binary files", () => {
	it("keeps a binary conflict byte for byte, and backs up the original exactly", async () => {
		const local = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0xfe]);
		const remote = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x80, 0xc0, 0x01]);
		const memory = makeMemoryVault({
			"photo.png": local,
			"photo.sync-conflict-20220101-000000-BBBBBBB.png": remote,
		});
		const resolver = new ConflictResolver(memory.app);

		await resolver.keepConflict(
			memory.file("photo.png"),
			memory.file("photo.sync-conflict-20220101-000000-BBBBBBB.png"),
		);

		expect(memory.bytes("photo.png")).toEqual(remote);
		expect(memory.trashed.map((entry) => entry.bytes)).toEqual([
			local,
			remote,
		]);
	});
});

describe("ConflictResolver when the original changes during resolution", () => {
	it("refuses to overwrite content it has not backed up", async () => {
		const { memory, resolver } = setup();
		const original = memory.file(ORIGINAL);
		const writeBinary = memory.app.vault.adapter.writeBinary;
		memory.app.vault.adapter.writeBinary = async (path, data) => {
			await writeBinary(path, data);
			await memory.app.vault.modify(original, "synced meanwhile");
		};

		await expect(
			resolver.keepConflict(original, memory.file(CONFLICT)),
		).rejects.toThrow("changed while resolving");

		expect(memory.content(ORIGINAL)).toBe("synced meanwhile");
		expect(memory.content(CONFLICT)).toBe("remote");
	});
});

describe("ConflictResolver.saveMerge", () => {
	it("trashes the previous content, writes the merge, then trashes the conflict", async () => {
		const { memory, resolver } = setup();

		await resolver.saveMerge(
			memory.file(ORIGINAL),
			memory.file(CONFLICT),
			"merged",
		);

		expect(memory.content(ORIGINAL)).toBe("merged");
		expect(memory.content(CONFLICT)).toBeUndefined();
		expect(trashedText(memory)).toEqual([
			{ path: expect.stringMatching(BACKUP), content: "local" },
			{ path: CONFLICT, content: "remote" },
		]);
		expect(memory.app.vault.create).not.toHaveBeenCalled();
	});

	it("does not back up an original that the merge leaves unchanged", async () => {
		const { memory, resolver } = setup();

		const backedUp = await resolver.saveMerge(
			memory.file(ORIGINAL),
			memory.file(CONFLICT),
			"local",
		);

		expect(backedUp).toBe(false);
		expect(memory.app.vault.modifyBinary).not.toHaveBeenCalled();
		expect(trashedText(memory)).toEqual([{ path: CONFLICT, content: "remote" }]);
	});

	it("keeps the conflict when writing the merge fails", async () => {
		const { memory, resolver } = setup();
		memory.app.vault.modifyBinary = async () => {
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

	it("says the merge was saved when only trashing the conflict fails, and can be retried", async () => {
		const { memory, resolver } = setup();
		const trash = memory.app.vault.trash;
		memory.app.vault.trash = async () => {
			throw new Error("trash unavailable");
		};

		await expect(
			resolver.saveMerge(
				memory.file(ORIGINAL),
				memory.file(CONFLICT),
				"merged",
			),
		).rejects.toThrow(`Saved ${ORIGINAL}, but could not move ${CONFLICT}`);
		expect(memory.content(ORIGINAL)).toBe("merged");

		memory.app.vault.trash = trash;
		await resolver.saveMerge(
			memory.file(ORIGINAL),
			memory.file(CONFLICT),
			"merged",
		);

		expect(memory.content(CONFLICT)).toBeUndefined();
		expect(memory.trashed.map((entry) => entry.content)).toEqual([
			"local",
			"remote",
		]);
	});
});

describe("ConflictResolver with an expected original", () => {
	it("refuses to save a merge whose base is out of date", async () => {
		const { memory, resolver } = setup();

		await expect(
			resolver.saveMerge(
				memory.file(ORIGINAL),
				memory.file(CONFLICT),
				"merged",
				"what the editor opened with",
			),
		).rejects.toThrow("changed while resolving");

		expect(memory.content(ORIGINAL)).toBe("local");
		expect(memory.content(CONFLICT)).toBe("remote");
		expect(memory.trashed).toEqual([]);
	});

	it("saves when the base still matches", async () => {
		const { memory, resolver } = setup();

		await resolver.saveMerge(
			memory.file(ORIGINAL),
			memory.file(CONFLICT),
			"merged",
			"local",
		);

		expect(memory.content(ORIGINAL)).toBe("merged");
	});

	it("does not claim a save when nothing was written and the trash fails", async () => {
		const { memory, resolver } = setup();
		memory.app.vault.trash = async () => {
			throw new Error("trash unavailable");
		};

		const attempt = resolver.saveMerge(
			memory.file(ORIGINAL),
			memory.file(CONFLICT),
			"local",
		);

		await expect(attempt).rejects.toThrow(`Could not move ${CONFLICT}`);
		await expect(attempt).rejects.not.toThrow("Saved");
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
