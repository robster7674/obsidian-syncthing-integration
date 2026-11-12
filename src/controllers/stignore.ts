import { Failure } from "src/models/failures";

/**
 * Edits the text of a `.stignore` file line by line, keeping its comments,
 * blank lines, order and line endings. Syncthing applies the first pattern
 * that matches, so new patterns go at the end, after any `!` exception.
 * @see https://docs.syncthing.net/users/ignoring.html
 */
export class IgnoreFile {
	private constructor(
		private lines: string[],
		private eol: string,
		private finalEol: boolean
	) {}

	static parse(text: string): IgnoreFile {
		const eol = text.includes("\r\n") ? "\r\n" : "\n";
		const finalEol = text === "" || text.endsWith("\n");
		const lines = text === "" ? [] : text.split(/\r?\n/);
		if (finalEol && lines.length > 0) lines.pop();
		return new IgnoreFile(lines, eol, finalEol);
	}

	/** The patterns, without comments and blank lines. */
	patterns(): string[] {
		return this.lines.filter(isPattern);
	}

	has(pattern: string): boolean {
		return this.lines.includes(pattern);
	}

	/**
	 * Adds the lines not in the file yet at the end. Refuses when no pattern
	 * would be added, or a line holds a line break.
	 */
	add(...lines: string[]): IgnoreFile | Failure {
		if (lines.some((line) => /[\r\n]/.test(line))) {
			return new Failure("A pattern cannot span several lines.");
		}
		if (!lines.some(isPattern)) return new Failure("Enter a pattern to ignore.");
		const added = lines.filter((line) => !this.has(line));
		if (!added.some(isPattern)) {
			return new Failure(
				`${lines.filter(isPattern).join(", ")} is already in .stignore.`
			);
		}
		return new IgnoreFile([...this.lines, ...added], this.eol, true);
	}

	/** Removes every line that is exactly `pattern`. */
	remove(pattern: string): IgnoreFile {
		return new IgnoreFile(
			this.lines.filter((line) => line !== pattern),
			this.eol,
			this.finalEol
		);
	}

	toString(): string {
		if (this.lines.length === 0) return "";
		return this.lines.join(this.eol) + (this.finalEol ? this.eol : "");
	}
}

function isPattern(line: string): boolean {
	return line.trim() !== "" && !line.startsWith("//");
}

/**
 * Patterns for files Obsidian keeps per device, which conflict whenever two
 * devices have the vault open: the window and pane layout.
 * They are anchored to the folder root, which is the vault's root.
 * @param configDir the vault's configuration folder, usually `.obsidian`.
 */
export function obsidianIgnoreTemplate(configDir: string): string[] {
	return [
		"// Obsidian: per-device window layout (added by Syncthing Integration)",
		`/${configDir}/workspace.json`,
		`/${configDir}/workspace-mobile.json`,
	];
}
