import { type App, CapacitorAdapter, FileSystemAdapter, Platform } from "obsidian";
import { type SyncthingFolder } from "src/models/entities";
import { Failure } from "src/models/failures";

/** The Syncthing folder that holds the vault. */
export interface VaultFolder {
	folder: SyncthingFolder;
	/** Where the vault is inside the folder, `""` when the vault is the folder's root. */
	vaultPath: string;
	/** Whether the user chose the folder rather than it being found by path. */
	chosen: boolean;
}

/**
 * The absolute path of the vault on this device, or `undefined` when the
 * adapter does not tell it.
 */
export function vaultBasePath(app: App): string | undefined {
	const adapter = app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
	if (adapter instanceof CapacitorAdapter) return adapter.getFullPath("");
	return undefined;
}

/**
 * Finds the Syncthing folder that holds the vault: the one chosen for this
 * device, else the deepest folder whose path is the vault's or contains it.
 * Paths are compared as Syncthing stores them, with `~` expanded, either
 * separator, and without case on Windows and macOS.
 * @param chosenId the folder ID chosen for this device, or `""`.
 */
export function findVaultFolder(
	folders: SyncthingFolder[],
	vaultPath: string | undefined,
	chosenId: string,
	home: string | undefined = homeDirectory()
): VaultFolder | Failure {
	if (chosenId) {
		const folder = folders.find((candidate) => candidate.id === chosenId);
		if (!folder) {
			return new Failure(
				`Syncthing has no folder with the ID ${chosenId}, which was chosen for this vault.`
			);
		}
		const inside = vaultPath ? relativeInside(folder.path, vaultPath, home) : undefined;
		return { folder, vaultPath: inside ?? "", chosen: true };
	}
	if (!vaultPath) {
		return new Failure(
			"The vault's location on this device is unknown. Choose its Syncthing folder in the settings."
		);
	}
	const matches = folders
		.map((folder) => ({ folder, inside: relativeInside(folder.path, vaultPath, home) }))
		.filter(
			(match): match is { folder: SyncthingFolder; inside: string } =>
				match.inside !== undefined
		)
		.sort((a, b) => a.inside.length - b.inside.length);
	if (matches.length === 0) {
		return new Failure(
			`No Syncthing folder holds the vault at ${vaultPath}. Share it with Syncthing, or choose its folder in the settings.`
		);
	}
	return { folder: matches[0].folder, vaultPath: matches[0].inside, chosen: false };
}

/**
 * Where `path` is inside `root`, as a `/`-separated relative path, `""` for
 * the root itself, or `undefined` when it is outside.
 */
function relativeInside(
	root: string,
	path: string,
	home: string | undefined
): string | undefined {
	const parent = normalise(expandHome(root, home));
	const child = normalise(path);
	if (!parent || !child) return undefined;
	const fold = Platform.isWin || Platform.isMacOS;
	const [a, b] = fold ? [parent.toLowerCase(), child.toLowerCase()] : [parent, child];
	if (a === b) return "";
	const prefix = a.endsWith("/") ? a : `${a}/`;
	return b.startsWith(prefix) ? child.slice(prefix.length) : undefined;
}

function expandHome(path: string, home: string | undefined): string {
	if (!home || !/^~([\\/]|$)/.test(path)) return path;
	return home + path.slice(1);
}

/** Uses `/`, and drops a trailing separator other than the root's. */
function normalise(path: string): string {
	const slashed = path.trim().replace(/\\/g, "/");
	return slashed.length > 1 ? slashed.replace(/\/+$/, "") || "/" : slashed;
}

function homeDirectory(): string | undefined {
	if (!Platform.isDesktopApp) return undefined;
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return require("os").homedir();
	} catch {
		return undefined;
	}
}
