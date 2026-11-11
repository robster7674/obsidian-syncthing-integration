import { type App, type TFile } from "obsidian";

/**
 * Resolves Syncthing conflicts. Every action moves the content it replaces
 * to the trash (system trash, or Obsidian's `.trash` folder when that fails),
 * and each step only runs when the previous one succeeded, so a failure
 * leaves both files in place.
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
	 * Keeps the conflict: the original goes to the trash and the conflict takes its path.
	 */
	async keepConflict(original: TFile, conflict: TFile): Promise<void> {
		const originalPath = original.path;
		await this.app.vault.trash(original, true);
		await this.app.fileManager.renameFile(conflict, originalPath);
	}

	/**
	 * Writes `merged` into the original, after trashing a copy of its previous
	 * content, then trashes the conflict.
	 */
	async saveMerge(
		original: TFile,
		conflict: TFile,
		merged: string
	): Promise<void> {
		const previous = await this.app.vault.read(original);
		if (previous !== merged) {
			const backup = await this.app.vault.create(
				backupPath(original),
				previous
			);
			await this.app.vault.trash(backup, true);
			await this.app.vault.modify(original, merged);
		}
		await this.app.vault.trash(conflict, true);
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
}

function backupPath(file: TFile): string {
	const folder = file.path.slice(0, file.path.length - file.name.length);
	const stamp = new Date().toISOString().replace(/[-:.]/g, "");
	const extension = file.extension ? `.${file.extension}` : "";
	return `${folder}${file.basename}.before-merge-${stamp}${extension}`;
}
