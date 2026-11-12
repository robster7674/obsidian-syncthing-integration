import { type DataAdapter } from "obsidian";
import { type ConflictFilename } from "src/models/entities";
import { Failure } from "src/models/failures";
import { parseConflictFilename } from "./utils";

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
const MAX_ENTRIES = 20_000;

/**
 * Finds Syncthing conflicts in the vault's hidden folders, such as the
 * configuration folder or per-device `.obsidian_*` folders (upstream #271).
 * It stops after {@link MAX_ENTRIES} files and folders and says so.
 */
export async function findHiddenConflicts(adapter: DataAdapter): Promise<{
	conflicts: HiddenConflict[];
	unrecognised: string[];
	truncated: boolean;
}> {
	const conflicts: HiddenConflict[] = [];
	const unrecognised: string[] = [];
	let seen = 0;
	const root = await adapter.list("");
	const queue = root.folders.filter((folder) => isSearched(folder));
	while (queue.length > 0) {
		const folder = queue.shift() as string;
		const listed = await adapter.list(folder);
		seen += listed.files.length + listed.folders.length;
		if (seen > MAX_ENTRIES) return { conflicts, unrecognised, truncated: true };
		queue.push(...listed.folders.filter((child) => !SKIPPED.has(nameOf(child))));
		for (const path of listed.files) {
			if (!nameOf(path).includes(".sync-conflict-")) continue;
			const properties = parseConflictFilename(nameOf(path));
			if (properties instanceof Failure) {
				unrecognised.push(path);
				continue;
			}
			const stat = await adapter.stat(path);
			if (!stat) continue;
			const originalPath = path.slice(0, path.length - nameOf(path).length) + properties.originalName;
			const original = await adapter.stat(originalPath);
			conflicts.push({
				path,
				originalPath,
				properties,
				size: stat.size,
				mtime: stat.mtime,
				original:
					original?.type === "file"
						? { size: original.size, mtime: original.mtime }
						: undefined,
			});
		}
	}
	return { conflicts, unrecognised, truncated: false };
}

function isSearched(folder: string): boolean {
	const name = nameOf(folder);
	return name.startsWith(".") && !SKIPPED.has(name);
}

function nameOf(path: string): string {
	return path.split("/").pop() ?? path;
}
