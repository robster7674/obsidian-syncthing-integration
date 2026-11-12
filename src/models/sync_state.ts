import { isRecord } from "src/controllers/utils";

/**
 * A folder's sync state on this device, from `/rest/db/status` or a
 * `FolderSummary` event.
 */
export interface FolderStatus {
	/** Such as `idle`, `scanning`, `syncing`, `error` or `paused`. */
	state: string;
	/** Files, directories, symlinks and deletions this device still needs. */
	needItems: number;
	needBytes: number;
	/** Items that failed to sync. */
	errors: number;
	/** Why the folder stopped, when it did. */
	error: string;
}

/** How much of a folder another device has, from `/rest/db/completion` or a `FolderCompletion` event. */
export interface Completion {
	completion: number;
	needItems: number;
	/** `valid`, `notSharing`, `paused` or `unknown`. */
	remoteState: string;
}

export interface SyncthingEvent {
	id: number;
	type: string;
	data: Record<string, unknown>;
}

export function parseFolderStatus(value: unknown): FolderStatus | undefined {
	if (!isRecord(value) || typeof value.state !== "string") return undefined;
	return {
		state: value.state,
		needItems:
			count(value.needTotalItems) ||
			count(value.needFiles) +
				count(value.needDirectories) +
				count(value.needSymlinks) +
				count(value.needDeletes),
		needBytes: count(value.needBytes),
		errors: count(value.errors) || count(value.pullErrors),
		error: typeof value.error === "string" ? value.error : "",
	};
}

export function parseCompletion(value: unknown): Completion | undefined {
	if (!isRecord(value) || typeof value.completion !== "number") return undefined;
	return {
		completion: value.completion,
		needItems: count(value.needItems),
		remoteState: typeof value.remoteState === "string" ? value.remoteState : "unknown",
	};
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
