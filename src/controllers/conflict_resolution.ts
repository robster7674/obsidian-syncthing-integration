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
	 * Keeps the conflict: its content replaces the original's, which goes to the trash.
	 * The original keeps its path, so links to it are unaffected.
	 */
	async keepConflict(original: TFile, conflict: TFile): Promise<void> {
		await this.replace(original, conflict, await this.app.vault.read(conflict));
	}

	/**
	 * Writes `merged` into the original, whose previous content goes to the trash, then trashes the conflict.
	 */
	async saveMerge(
		original: TFile,
		conflict: TFile,
		merged: string
	): Promise<void> {
		await this.replace(original, conflict, merged);
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
	 * `content`, only the conflict is left to trash.
	 */
	private async replace(
		original: TFile,
		conflict: TFile,
		content: string
	): Promise<void> {
		const previous = await this.app.vault.read(original);
		if (previous !== content) {
			await this.trashCopy(original, previous);
			await this.app.vault.modify(original, content);
		}
		try {
			await this.app.vault.trash(conflict, true);
		} catch (error) {
			throw new Error(
				`Saved ${original.path}, but could not move ${conflict.path} to the trash: ${error}`
			);
		}
	}

	/**
	 * Puts a copy of `content` in the trash under a name derived from `file`.
	 * The copy is written to the config folder, which the vault does not index,
	 * so no other plugin sees it, and it is trashed well within the delay
	 * Syncthing waits before it scans a change (10 s by default).
	 */
	private async trashCopy(file: TFile, content: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const path = normalizePath(
			`${this.app.vault.configDir}/${backupName(file)}`
		);
		await adapter.write(path, content);
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

function backupName(file: TFile): string {
	const stamp = new Date().toISOString().replace(/[-:.]/g, "");
	const extension = file.extension ? `.${file.extension}` : "";
	return `${file.basename}.before-merge-${stamp}${extension}`;
}
