import { type DataAdapter } from "obsidian";
import { type ConflictFilename } from "src/models/entities";
import { Failure } from "src/models/failures";
import { folderOf, nameOf, parseConflictFilename } from "./utils";

/** A Syncthing conflict in a hidden folder, which the vault does not index. */
export interface HiddenConflict {
	path: string;
	originalPath: string;
	properties: ConflictFilename;
	size: number;
	mtime: number;
	/** The original's size and modification time, or `undefined` when it does not exist. */
	original?: { size: number; mtime: number };
}

/**
 * Hidden folders not searched: Obsidian's trash, version control, and
 * Syncthing's own folders, where conflicts are not the user's files.
 */
const SKIPPED = new Set([".trash", ".git", ".stversions", ".stfolder", "node_modules"]);
const MAX_ENTRIES = 100_000;

/**
 * Finds Syncthing conflicts that the vault does not index: in folders whose
 * names start with a dot at any depth, such as the configuration folder or
 * per-device `.obsidian_*` folders (upstream #271), and dot-files. It walks
 * the vault through the adapter and stops after {@link MAX_ENTRIES} files
 * and folders, saying so.
 */
export async function findHiddenConflicts(adapter: DataAdapter): Promise<{
	conflicts: HiddenConflict[];
	unrecognised: string[];
	truncated: boolean;
}> {
	const conflicts: HiddenConflict[] = [];
	const unrecognised: string[] = [];
	let seen = 0;
	let truncated = false;
	const queue = [""];
	while (queue.length > 0 && !truncated) {
		const listed = await adapter.list(queue.shift() as string);
		seen += listed.files.length + listed.folders.length;
		truncated = seen > MAX_ENTRIES;
		if (!truncated) {
			queue.push(...listed.folders.filter((child) => !SKIPPED.has(nameOf(child))));
		}
		const found = listed.files.filter(
			(path) => isHidden(path) && nameOf(path).includes(".sync-conflict-")
		);
		const described = await Promise.all(found.map((path) => describe(adapter, path)));
		for (const [index, conflict] of described.entries()) {
			if (conflict instanceof Failure) unrecognised.push(found[index]);
			else if (conflict) conflicts.push(conflict);
		}
	}
	return { conflicts, unrecognised, truncated };
}

/** The conflict at `path` with its original's details, `undefined` when it is gone, or a Failure for a name Syncthing does not write. */
async function describe(
	adapter: DataAdapter,
	path: string
): Promise<HiddenConflict | Failure | undefined> {
	const name = nameOf(path);
	const properties = parseConflictFilename(name);
	if (properties instanceof Failure) return properties;
	const originalPath = folderOf({ path, name }) + properties.originalName;
	const [stat, original] = await Promise.all([adapter.stat(path), adapter.stat(originalPath)]);
	if (!stat) return undefined;
	return {
		path,
		originalPath,
		properties,
		size: stat.size,
		mtime: stat.mtime,
		original:
			original?.type === "file" ? { size: original.size, mtime: original.mtime } : undefined,
	};
}

/** Whether the vault leaves `path` out of its index: any segment starts with a dot. */
function isHidden(path: string): boolean {
	return path.split("/").some((segment) => segment.startsWith("."));
}
