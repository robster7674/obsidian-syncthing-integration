import { type App, type TFile } from "obsidian";

/** Files larger than this are not compared as text: the diff would stall Obsidian. */
export const MAX_TEXT_DIFF_BYTES = 1024 * 1024;
/** How much of a file is read to tell text from binary. */
const SNIFF_BYTES = 8192;
const TEXT_EXTENSIONS = new Set([
	"md", "markdown", "txt", "canvas", "base", "json", "css", "js", "ts",
	"html", "xml", "svg", "csv", "tsv", "yaml", "yml", "toml", "ini", "tex",
	"bib", "org", "rst", "adoc", "log",
]);

/**
 * Whether a conflict and its original can be shown as a text diff and
 * merged: both small enough, and both text. A known text extension counts as
 * text; any other file counts as text only when its start holds no NUL byte
 * and is valid UTF-8.
 * @returns `true`, or why they are compared by their details only.
 */
export async function comparableAsText(
	app: App,
	...files: TFile[]
): Promise<true | string> {
	for (const file of files) {
		if (file.stat.size > MAX_TEXT_DIFF_BYTES) {
			return `${file.name} is larger than ${MAX_TEXT_DIFF_BYTES / 1024 / 1024} MB, so it is not compared line by line.`;
		}
	}
	// The vault reads whole files only; they are at most MAX_TEXT_DIFF_BYTES here.
	const binary = await Promise.all(
		files.map(async (file) => {
			if (TEXT_EXTENSIONS.has(file.extension.toLowerCase())) return false;
			const start = new Uint8Array(await app.vault.readBinary(file)).subarray(0, SNIFF_BYTES);
			return !looksLikeText(start);
		})
	);
	const index = binary.indexOf(true);
	if (index >= 0) {
		return `${files[index].name} is not a text file, so it is not compared line by line.`;
	}
	return true;
}

function looksLikeText(bytes: Uint8Array): boolean {
	if (bytes.includes(0)) return false;
	try {
		// A multi-byte character cut off at the end of the sample is still text.
		new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
		return true;
	} catch {
		return false;
	}
}
