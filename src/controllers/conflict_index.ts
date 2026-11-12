import { type TAbstractFile, TFile, TFolder, type Vault } from "obsidian";
import { Failure } from "src/models/failures";
import { originalPathOf } from "./utils";

/**
 * The vault's Syncthing conflicts, grouped by the path of their original.
 * It is built from the vault once, then kept up to date from vault events,
 * so looking up a file's conflicts does not scan the vault.
 */
export class ConflictIndex {
	private byOriginal = new Map<string, Set<TFile>>();
	private unrecognised = new Set<TFile>();
	/** Where each indexed file is listed, so a rename or delete finds it by its old path. */
	private listed = new Map<string, { file: TFile; originalPath?: string }>();
	private built = false;

	constructor(private vault: Vault) {}

	/** The conflicts of the file at `originalPath`. */
	conflictsOf(originalPath: string): TFile[] {
		this.build();
		return [...(this.byOriginal.get(originalPath) ?? [])];
	}

	/**
	 * All conflicts by the path of their original, and the files containing
	 * `.sync-conflict-` that are not named the way Syncthing names conflicts.
	 */
	all(): { conflicts: Map<string, TFile[]>; unrecognised: TFile[] } {
		this.build();
		return {
			conflicts: new Map(
				[...this.byOriginal].map(([path, files]) => [path, [...files]])
			),
			unrecognised: [...this.unrecognised],
		};
	}

	/** Follows a file created in the vault. */
	created(file: TAbstractFile) {
		if (!this.built || !(file instanceof TFile)) return;
		this.add(file);
	}

	/** Follows a file or folder deleted from the vault, with everything in it. */
	deleted(file: TAbstractFile) {
		if (this.built) this.dropTree(file.path);
	}

	/** Follows a file or folder renamed or moved in the vault, with everything in it. */
	renamed(file: TAbstractFile, oldPath: string) {
		if (!this.built) return;
		this.dropTree(oldPath);
		this.addTree(file);
	}

	private dropTree(path: string) {
		const prefix = `${path}/`;
		for (const listed of [...this.listed.keys()]) {
			if (listed === path || listed.startsWith(prefix)) this.drop(listed);
		}
	}

	private addTree(file: TAbstractFile) {
		if (file instanceof TFile) this.add(file);
		else if (file instanceof TFolder) file.children.forEach((child) => this.addTree(child));
	}

	private build() {
		if (this.built) return;
		this.built = true;
		for (const file of this.vault.getFiles()) this.add(file);
	}

	private add(file: TFile) {
		this.drop(file.path);
		if (!file.name.contains(".sync-conflict-")) return;
		const originalPath = originalPathOf(file);
		if (originalPath instanceof Failure) {
			this.unrecognised.add(file);
			this.listed.set(file.path, { file });
			return;
		}
		const group = this.byOriginal.get(originalPath) ?? new Set();
		group.add(file);
		this.byOriginal.set(originalPath, group);
		this.listed.set(file.path, { file, originalPath });
	}

	private drop(path: string) {
		const entry = this.listed.get(path);
		if (!entry) return;
		this.listed.delete(path);
		if (entry.originalPath === undefined) {
			this.unrecognised.delete(entry.file);
			return;
		}
		const group = this.byOriginal.get(entry.originalPath);
		group?.delete(entry.file);
		if (group?.size === 0) this.byOriginal.delete(entry.originalPath);
	}
}
