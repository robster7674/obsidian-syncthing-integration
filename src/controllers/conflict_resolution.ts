import { type App, normalizePath, type TFile } from "obsidian";

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
	 * @param expectedOriginal the original's text as the user saw it; if it changed since, nothing is replaced.
	 * @returns whether a previous version was put in the trash (not when both files were identical).
	 */
	async keepConflict(
		original: TFile,
		conflict: TFile,
		expectedOriginal?: string
	): Promise<boolean> {
		return this.replace(
			original,
			conflict,
			await this.app.vault.readBinary(conflict),
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
			original,
			conflict,
			new TextEncoder().encode(merged).buffer as ArrayBuffer,
			base
		);
	}

	/**
	 * For a conflict whose original no longer exists: the conflict takes the original's path.
	 */
	async restoreAsOriginal(conflict: TFile, originalPath: string): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(originalPath)) {
			throw new Error(`${originalPath} already exists.`);
		}
		await this.app.fileManager.renameFile(conflict, originalPath);
	}

	/**
	 * Running this again after a failure is safe: once the original holds
	 * `content`, only the conflict is left to trash, whatever was expected.
	 */
	private async replace(
		original: TFile,
		conflict: TFile,
		content: ArrayBuffer,
		expectedOriginal?: string
	): Promise<boolean> {
		const vault = this.app.vault;
		const changedMeanwhile = () =>
			new Error(
				`${original.path} changed while resolving the conflict. Nothing was replaced; review it and try again.`
			);
		const previous = await vault.readBinary(original);
		const changed = !sameBytes(previous, content);
		if (
			changed &&
			expectedOriginal !== undefined &&
			withoutBom(new TextDecoder().decode(previous)) !==
				withoutBom(expectedOriginal)
		) {
			throw changedMeanwhile();
		}
		if (changed) {
			await this.trashCopy(original, previous);
			if (!sameBytes(previous, await vault.readBinary(original))) {
				throw changedMeanwhile();
			}
			await vault.modifyBinary(original, content);
		}
		try {
			await vault.trash(conflict, true);
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
	private async trashCopy(file: TFile, content: ArrayBuffer): Promise<void> {
		const adapter = this.app.vault.adapter;
		const path = normalizePath(
			`${this.app.vault.configDir}/${backupName(file)}`
		);
		await adapter.writeBinary(path, content);
		try {
			if (!(await adapter.trashSystem(path))) {
				await adapter.trashLocal(path);
			}
		} catch (error) {
			await adapter.remove(path).catch((cleanupError) =>
				console.error(`Could not remove ${path}`, cleanupError)
			);
			throw error;
		}
	}
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

function backupName(file: TFile): string {
	const stamp = new Date().toISOString().replace(/[-:.]/g, "");
	const extension = file.extension ? `.${file.extension}` : "";
	return `${file.basename}.before-merge-${stamp}${extension}`;
}
