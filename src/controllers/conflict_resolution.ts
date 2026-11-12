import { type App, normalizePath, type TFile } from "obsidian";
import { type ConflictFilename } from "src/models/entities";
import { folderOf, nameOf } from "./utils";

/**
 * Resolves Syncthing conflicts. Every action moves the content it replaces
 * to the trash (system trash, or Obsidian's `.trash` folder when that fails),
 * and each step only runs when the previous one succeeded, so a failure
 * never loses either version.
 */
export class ConflictResolver {
	constructor(private app: App) {}

	/**
	 * Keeps the original: the conflict file goes to the trash.
	 */
	async keepOriginal(conflict: TFile): Promise<void> {
		await this.app.vault.trash(conflict, true);
	}

	/**
	 * Keeps the conflict: its bytes replace the original's, which go to the trash.
	 * The original keeps its path, so links to it are unaffected.
	 * @param expectedOriginal the original as the user saw it, as text or, for a file not shown as text, its size and modification time; if it changed since, nothing is replaced.
	 * @returns whether a previous version was put in the trash (not when both files were identical).
	 */
	async keepConflict(
		original: TFile,
		conflict: TFile,
		expectedOriginal?: ExpectedOriginal
	): Promise<boolean> {
		return this.replace(
			this.inVault(original),
			this.inVault(conflict),
			await this.app.vault.readBinary(conflict),
			"before-accepting-conflict",
			expectedOriginal
		);
	}

	/**
	 * For a conflict in a hidden folder, which the vault does not index:
	 * the conflict goes to the trash.
	 */
	async keepHiddenOriginal(conflictPath: string): Promise<void> {
		await this.hidden(conflictPath).trash();
	}

	/**
	 * For a conflict in a hidden folder whose original no longer exists: the
	 * conflict takes the original's path, unless something is there.
	 */
	async restoreHiddenAsOriginal(conflictPath: string, originalPath: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(originalPath)) {
			throw new Error(`${originalPath} already exists.`);
		}
		await adapter.rename(conflictPath, originalPath);
	}

	/**
	 * For a conflict in a hidden folder: its bytes replace the original's,
	 * which go to the trash, as {@link keepConflict} does.
	 * @param expectedOriginal the original's size and modification time when it was listed.
	 */
	async keepHiddenConflict(
		originalPath: string,
		conflictPath: string,
		expectedOriginal?: { size: number; mtime: number }
	): Promise<boolean> {
		return this.replace(
			this.hidden(originalPath),
			this.hidden(conflictPath),
			await this.app.vault.adapter.readBinary(conflictPath),
			"before-accepting-conflict",
			expectedOriginal
		);
	}

	/**
	 * Writes `merged` into the original, whose previous content goes to the trash, then trashes the conflict.
	 * @param base the original's text the merge started from; if the original changed since, nothing is replaced.
	 * @returns whether a previous version was put in the trash (not when `merged` equals it).
	 */
	async saveMerge(
		original: TFile,
		conflict: TFile,
		merged: string,
		base?: string
	): Promise<boolean> {
		return this.replace(
			this.inVault(original),
			this.inVault(conflict),
			new TextEncoder().encode(merged).buffer as ArrayBuffer,
			"before-merge",
			base
		);
	}

	/**
	 * For a conflict whose original no longer exists: the conflict takes the original's path.
	 * Refuses when anything is at that path, including a file outside the vault index or one differing only in case.
	 */
	async restoreAsOriginal(conflict: TFile, originalPath: string): Promise<void> {
		await this.renameToFreePath(conflict, originalPath);
	}

	/**
	 * Keeps both versions: the conflict is renamed next to the original, so
	 * Syncthing no longer sees it as a conflict, such as
	 * `Note (conflict from ABCDEFG, 2022-01-01 120000).md`.
	 * @returns the conflict's new path.
	 */
	async keepBoth(conflict: TFile, properties: ConflictFilename): Promise<string> {
		const folder = folderOf(conflict);
		const extension = properties.extension ? `.${properties.extension}` : "";
		const date = `${properties.date.slice(0, 4)}-${properties.date.slice(4, 6)}-${properties.date.slice(6)} ${properties.time}`;
		const from = properties.modifiedBy ? `from ${properties.modifiedBy}, ` : "";
		const path = normalizePath(
			`${folder}${properties.filename} (conflict ${from}${date})${extension}`
		);
		await this.renameToFreePath(conflict, path);
		return path;
	}

	/** Renames `file` to `path`, refusing when anything is there, also differing only in case or outside the vault index. */
	private async renameToFreePath(file: TFile, path: string): Promise<void> {
		const folded = path.toLowerCase();
		const taken =
			this.app.vault
				.getFiles()
				.some((other) => other.path.toLowerCase() === folded) ||
			(await this.app.vault.adapter.exists(path));
		if (taken) {
			throw new Error(`${path} already exists.`);
		}
		await this.app.fileManager.renameFile(file, path);
	}

	/**
	 * Running this again after a failure is safe: once the original holds
	 * `content`, only the conflict is left to trash, whatever was expected.
	 */
	private async replace(
		original: StoredFile,
		conflict: StoredFile,
		content: ArrayBuffer,
		backupLabel: string,
		expectedOriginal?: ExpectedOriginal
	): Promise<boolean> {
		const changedMeanwhile = () =>
			new Error(
				`${original.path} changed while resolving the conflict. Nothing was replaced; review it and try again.`
			);
		const previous = await original.read();
		const changed = !sameBytes(previous, content);
		if (
			changed &&
			expectedOriginal !== undefined &&
			!(await matches(original, previous, expectedOriginal))
		) {
			throw changedMeanwhile();
		}
		if (changed) {
			await this.trashCopy(original.path, previous, backupLabel);
			if (!sameBytes(previous, await original.read())) {
				throw changedMeanwhile();
			}
			await original.write(content);
		}
		try {
			await conflict.trash();
		} catch (error) {
			throw new Error(
				changed
					? `Saved ${original.path}, but could not move ${conflict.path} to the trash: ${error}`
					: `Could not move ${conflict.path} to the trash: ${error}`
			);
		}
		return changed;
	}

	/**
	 * Puts a copy of `content` in the trash under a name derived from `file`.
	 * The copy is written to the config folder, which the vault does not index,
	 * so no other plugin sees it, and it is trashed well within the delay
	 * Syncthing waits before it scans a change (10 s by default).
	 */
	private async trashCopy(
		originalPath: string,
		content: ArrayBuffer,
		label: string
	): Promise<void> {
		const adapter = this.app.vault.adapter;
		const path = normalizePath(
			`${this.app.vault.configDir}/${backupName(originalPath, label)}`
		);
		await adapter.writeBinary(path, content);
		try {
			await this.trashPath(path);
		} catch (error) {
			await adapter.remove(path).catch((cleanupError) =>
				console.error(`Could not remove ${path}`, cleanupError)
			);
			throw error;
		}
	}

	/** Moves a file the vault does not index to the system trash, or to Obsidian's `.trash` folder. */
	private async trashPath(path: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.trashSystem(path))) {
			await adapter.trashLocal(path);
		}
	}

	/** A vault file, changed through the vault so that Obsidian and other plugins see it. */
	private inVault(file: TFile): StoredFile {
		const vault = this.app.vault;
		return {
			path: file.path,
			read: () => vault.readBinary(file),
			write: (data) => vault.modifyBinary(file, data),
			trash: () => vault.trash(file, true),
			mtime: async () => file.stat.mtime,
		};
	}

	/** A file in a hidden folder, which only the adapter reaches. */
	private hidden(path: string): StoredFile {
		const adapter = this.app.vault.adapter;
		return {
			path,
			read: () => adapter.readBinary(path),
			write: (data) => adapter.writeBinary(path, data),
			trash: () => this.trashPath(path),
			mtime: async () => (await adapter.stat(path))?.mtime,
		};
	}
}

/** A file that a resolution reads, replaces or trashes. */
interface StoredFile {
	path: string;
	read(): Promise<ArrayBuffer>;
	write(data: ArrayBuffer): Promise<void>;
	trash(): Promise<void>;
	mtime(): Promise<number | undefined>;
}

/** The original as the user saw it: its text, or its size and modification time. */
export type ExpectedOriginal = string | { size: number; mtime: number };

async function matches(
	original: StoredFile,
	content: ArrayBuffer,
	expected: ExpectedOriginal
): Promise<boolean> {
	if (typeof expected !== "string") {
		return (
			content.byteLength === expected.size &&
			(await original.mtime()) === expected.mtime
		);
	}
	return withoutBom(new TextDecoder().decode(content)) === withoutBom(expected);
}

function withoutBom(text: string): string {
	return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
	if (a.byteLength !== b.byteLength) return false;
	const left = new Uint8Array(a);
	const right = new Uint8Array(b);
	return left.every((byte, index) => byte === right[index]);
}

function backupName(path: string, label: string): string {
	const stamp = new Date().toISOString().replace(/[-:.]/g, "");
	const name = nameOf(path);
	const dot = name.lastIndexOf(".");
	const [basename, extension] =
		dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
	return `${basename}.${label}-${stamp}${extension}`;
}
