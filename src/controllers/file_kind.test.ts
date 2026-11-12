import { describe, expect, it } from "vitest";
import { makeMemoryVault } from "../../test/helpers/vault";
import { comparableAsText, MAX_TEXT_DIFF_BYTES } from "./file_kind";

describe("comparableAsText", () => {
	it("compares text files", async () => {
		const memory = makeMemoryVault({ "a.md": "text", "b.unknown": "plain words, é" });

		await expect(
			comparableAsText(memory.app, memory.file("a.md"), memory.file("b.unknown")),
		).resolves.toBe(true);
	});

	it("does not compare a binary file", async () => {
		const memory = makeMemoryVault({
			"a.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]),
			"b.pdf": new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe]),
		});

		await expect(comparableAsText(memory.app, memory.file("a.png"))).resolves.toContain(
			"not a text file",
		);
		await expect(comparableAsText(memory.app, memory.file("b.pdf"))).resolves.toContain(
			"not a text file",
		);
	});

	it("does not compare a large file, without reading it", async () => {
		const memory = makeMemoryVault({ "big.md": "x" });
		memory.file("big.md").stat.size = MAX_TEXT_DIFF_BYTES + 1;

		await expect(comparableAsText(memory.app, memory.file("big.md"))).resolves.toContain(
			"larger than 1 MB",
		);
		expect(memory.app.vault.readBinary).not.toHaveBeenCalled();
	});
});
