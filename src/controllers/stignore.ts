import { Failure } from "src/models/failures";

interface Line {
	text: string;
	/** The line break after it, `""` for a last line without one. */
	eol: string;
}

/**
 * Edits the text of a `.stignore` file line by line, keeping its comments,
 * blank lines, order, byte order mark and each line's ending. Syncthing
 * applies the first pattern that matches, so new patterns go at the end,
 * after any `!` exception.
 * @see https://docs.syncthing.net/users/ignoring.html
 */
export class IgnoreFile {
	private constructor(
		private lines: Line[],
		private bom: string
	) {}

	static parse(text: string): IgnoreFile {
		const bom = text.startsWith("﻿") ? "﻿" : "";
		const parts = text.slice(bom.length).split(/(\r\n|\n|\r)/);
		const lines: Line[] = [];
		for (let index = 0; index < parts.length; index += 2) {
			lines.push({ text: parts[index], eol: parts[index + 1] ?? "" });
		}
		if (lines.at(-1)?.text === "" && lines.at(-1)?.eol === "") lines.pop();
		return new IgnoreFile(lines, bom);
	}

	/** The patterns, without comments and blank lines. */
	patterns(): string[] {
		return this.lines.map((line) => line.text).filter(isPattern);
	}

	has(pattern: string): boolean {
		return this.lines.some((line) => line.text === pattern);
	}

	/**
	 * The pattern that ignores exactly the vault file or folder at `path`,
	 * anchored at the folder root, with glob characters escaped.
	 * @param windows whether Syncthing runs on Windows, where its default escape character is `|`.
	 */
	patternFor(path: string, windows: boolean): string {
		const escape = this.escapeCharacter() ?? (windows ? "|" : "\\");
		const relative = path.replace(/^\/+/, "");
		const special = (character: string) =>
			"*?[]{}".includes(character) || character === escape;
		return `/${Array.from(relative, (character) =>
			special(character) ? escape + character : character
		).join("")}`;
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
		const eol = [...this.lines].reverse().find((line) => line.eol)?.eol ?? "\n";
		const kept = this.lines.map((line, index) =>
			index === this.lines.length - 1 && !line.eol ? { ...line, eol } : line
		);
		return new IgnoreFile(
			[...kept, ...added.map((text) => ({ text, eol }))],
			this.bom
		);
	}

	/** Removes every line that is exactly `pattern`. */
	remove(pattern: string): IgnoreFile {
		return new IgnoreFile(
			this.lines.filter((line) => line.text !== pattern),
			this.bom
		);
	}

	toString(): string {
		if (this.lines.length === 0) return "";
		return this.bom + this.lines.map((line) => line.text + line.eol).join("");
	}

	/** The character set by a `#escape=` line, if any. */
	private escapeCharacter(): string | undefined {
		const line = this.lines.find((candidate) => candidate.text.startsWith("#escape"));
		return line?.text.replace(/^#escape\s*=?\s*/, "").trim().charAt(0) || undefined;
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
