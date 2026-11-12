import { describe, expect, it } from "vitest";
import { Failure } from "src/models/failures";
import { IgnoreFile, obsidianIgnoreTemplate } from "./stignore";

const added = (text: string, ...lines: string[]) => {
	const result = IgnoreFile.parse(text).add(...lines);
	if (result instanceof Failure) throw new Error(result.message);
	return result.toString();
};

describe("IgnoreFile", () => {
	it("appends after existing patterns, so ! exceptions keep applying first", () => {
		expect(added("!/keep.md\n*.md\n", "/notes/a.md")).toBe("!/keep.md\n*.md\n/notes/a.md\n");
	});

	it("keeps comments, blank lines and Windows line endings", () => {
		expect(added("// mine\r\n\r\n/a\r\n", "/b")).toBe("// mine\r\n\r\n/a\r\n/b\r\n");
	});

	it("keeps each line's own ending and a byte order mark", () => {
		const text = "\uFEFF/a\n/b\r\n/c\r";

		expect(added(text, "/d")).toBe("\uFEFF/a\n/b\r\n/c\r/d\r");
		expect(IgnoreFile.parse(text).has("/a")).toBe(true);
		expect(IgnoreFile.parse(text).remove("/a").toString()).toBe("\uFEFF/b\r\n/c\r");
	});

	it("escapes glob characters in a vault path", () => {
		const file = IgnoreFile.parse("");

		expect(file.patternFor("notes/[draft] *.md", false)).toBe("/notes/\\[draft\\] \\*.md");
		expect(file.patternFor("a\\b.md", false)).toBe("/a\\\\b.md");
		expect(file.patternFor("notes/{x}?.md", true)).toBe("/notes/|{x|}|?.md");
		expect(IgnoreFile.parse("#escape=~\n").patternFor("a*.md", false)).toBe("/a~*.md");
	});

	it("adds a line break before appending to a file without a final one", () => {
		expect(added("/a", "/b")).toBe("/a\n/b\n");
	});

	it("creates the content of a missing file", () => {
		expect(added("", "/a")).toBe("/a\n");
	});

	it.each([
		["/a\n", ["/a"], "already in .stignore"],
		["", [""], "Enter a pattern"],
		["", ["// only a comment"], "Enter a pattern"],
		["", ["/a\n/b"], "cannot span several lines"],
	])("refuses %j + %j", (text, lines, message) => {
		const result = IgnoreFile.parse(text).add(...lines);

		expect(result).toBeInstanceOf(Failure);
		expect((result as Failure).message).toContain(message);
	});

	it("removes only the exact line, keeping the rest as it was", () => {
		const text = "// keep\r\n/a\r\n/ab\r\n/a\r\n";

		expect(IgnoreFile.parse(text).remove("/a").toString()).toBe("// keep\r\n/ab\r\n");
	});

	it("lists the patterns without comments and blank lines", () => {
		expect(IgnoreFile.parse("// c\n\n/a\n#include x\n").patterns()).toEqual([
			"/a",
			"#include x",
		]);
	});
});

describe("obsidianIgnoreTemplate", () => {
	it("anchors the per-device files in the configuration folder", () => {
		expect(obsidianIgnoreTemplate(".config")).toEqual([
			expect.stringMatching(/^\/\/ /),
			"/.config/workspace.json",
			"/.config/workspace-mobile.json",
		]);
	});

	it("adds only what is missing, once", () => {
		const template = obsidianIgnoreTemplate(".obsidian");
		const once = added("/.obsidian/workspace.json\n", ...template);

		expect(once).toBe(
			`/.obsidian/workspace.json\n${template[0]}\n/.obsidian/workspace-mobile.json\n`,
		);
		expect(IgnoreFile.parse(once).add(...template)).toBeInstanceOf(Failure);
	});
});
