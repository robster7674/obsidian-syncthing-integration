import { type SyncthingFromREST } from "src/data/syncthing_remote_datasource";
import { type SyncthingFolder } from "src/models/entities";
import { Failure } from "src/models/failures";
import {
	type Completion,
	type FolderStatus,
	parseCompletion,
	parseFolderStatus,
	type SyncthingEvent,
} from "src/models/sync_state";
import { type VaultFolder } from "./vault_folder";

/** Another device the vault's folder is shared with. */
export interface Peer {
	id: string;
	name: string;
	connected: boolean;
	paused: boolean;
	/** As this Syncthing last knew it; `undefined` until it is known. */
	completion?: Completion;
}

export type SyncStatus =
	| { kind: "unknown"; message: string }
	| { kind: "error"; message: string }
	| { kind: "paused" }
	| { kind: "scanning" }
	| { kind: "syncing"; needFiles: number; needBytes: number }
	| { kind: "waiting"; devices: string[] }
	| { kind: "behind"; devices: string[] }
	| { kind: "synced" };

/**
 * The vault's sync state, from this device's view of its folder and of the
 * other devices. It is "synced", and safe to close, only when this device
 * has everything and every other device sharing the folder has all of it,
 * as far as this Syncthing knows; paused devices and devices that do not
 * share the folder back are left out.
 */
export function summarise(folder: FolderStatus, peers: Peer[]): SyncStatus {
	if (folder.state === "error" || folder.error) {
		return { kind: "error", message: folder.error || "The folder stopped with an error." };
	}
	if (folder.state === "paused") return { kind: "paused" };
	if (folder.errors > 0) {
		return {
			kind: "error",
			message: `${folder.errors} ${folder.errors === 1 ? "item" : "items"} could not be synced.`,
		};
	}
	if (folder.state.startsWith("scan")) return { kind: "scanning" };
	if (folder.state.startsWith("sync") || folder.needFiles > 0) {
		return { kind: "syncing", needFiles: folder.needFiles, needBytes: folder.needBytes };
	}
	const counted = peers.filter(
		(peer) =>
			!peer.paused &&
			peer.completion?.remoteState !== "paused" &&
			peer.completion?.remoteState !== "notSharing"
	);
	const incomplete = counted.filter((peer) => (peer.completion?.completion ?? 0) < 100);
	const waiting = incomplete.filter((peer) => peer.connected).map((peer) => peer.name);
	if (waiting.length > 0) return { kind: "waiting", devices: waiting };
	const behind = incomplete.map((peer) => peer.name);
	if (behind.length > 0) return { kind: "behind", devices: behind };
	return { kind: "synced" };
}

/** A short text for the status bar, and a longer one that says whether it is safe to close. */
export function describe(status: SyncStatus): { text: string; detail: string } {
	switch (status.kind) {
		case "unknown":
			return { text: "Sync status unknown", detail: status.message };
		case "error":
			return { text: "Sync error", detail: status.message };
		case "paused":
			return { text: "Sync paused", detail: "The vault's Syncthing folder is paused." };
		case "scanning":
			return { text: "Scanning", detail: "Syncthing is looking for changes in the vault." };
		case "syncing":
			return {
				text: `Syncing ${status.needFiles} ${status.needFiles === 1 ? "file" : "files"}`,
				detail: "This device is receiving changes. Wait before closing.",
			};
		case "waiting":
			return {
				text: `Waiting for ${status.devices.join(", ")}`,
				detail: `${status.devices.join(", ")} ${status.devices.length === 1 ? "is" : "are"} still receiving changes from the vault. Wait before closing.`,
			};
		case "behind":
			return {
				text: `Not on ${status.devices.join(", ")}`,
				detail: `${status.devices.join(", ")} ${status.devices.length === 1 ? "is" : "are"} offline and ${status.devices.length === 1 ? "does" : "do"} not have every change yet. If you close now, the changes stay on this device until both are online.`,
			};
		case "synced":
			return {
				text: "Synced",
				detail: "Every device sharing the vault has all of it. It is safe to close.",
			};
	}
}

const EVENT_TYPES = [
	"FolderSummary",
	"FolderCompletion",
	"StateChanged",
	"DeviceConnected",
	"DeviceDisconnected",
	"DevicePaused",
	"DeviceResumed",
	"ConfigSaved",
] as const;
const LONG_POLL_SECONDS = 60;
const MAX_RETRY_MS = 60_000;

export interface MonitorDependencies {
	rest: Pick<
		SyncthingFromREST,
		| "getEvents"
		| "getFolderStatus"
		| "getCompletion"
		| "getDevices"
		| "getMyID"
		| "getConnectedDevices"
	>;
	/** Finds the vault's folder; fetched again after Syncthing's configuration changes. */
	findFolder: () => Promise<VaultFolder | Failure>;
	onChange: (status: SyncStatus) => void;
	/** Whether Obsidian's window is hidden, when nothing is requested. */
	hidden: () => boolean;
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Follows the vault's sync state through Syncthing's event stream: one
 * snapshot, then a long-poll of `/rest/events`, so nothing is polled on a
 * timer. While the window is hidden no request is started, and the state is
 * read again when it is shown. After a failure it retries with a growing delay.
 */
export class SyncStatusMonitor {
	private generation = 0;
	private running = false;
	private wake?: () => void;
	private folder?: SyncthingFolder;
	private status?: FolderStatus;
	private peers = new Map<string, Peer>();
	private since = 0;
	private sleep: (ms: number) => Promise<void>;

	constructor(private deps: MonitorDependencies) {
		this.sleep =
			deps.sleep ?? ((ms) => new Promise((resolve) => window.setTimeout(resolve, ms)));
	}

	start() {
		if (this.running) return;
		this.running = true;
		void this.run(++this.generation);
	}

	stop() {
		this.running = false;
		this.generation++;
		this.wake?.();
	}

	/** Reads the state again, for example after the URL, API key or folder changed. */
	restart() {
		this.stop();
		this.start();
	}

	/** Called when the window is shown again. */
	visible() {
		this.wake?.();
	}

	private async run(generation: number) {
		let retry = 1000;
		let snapshotNeeded = true;
		const current = () => this.running && generation === this.generation;
		while (current()) {
			if (this.deps.hidden()) {
				await new Promise<void>((resolve) => (this.wake = resolve));
				snapshotNeeded = true;
				continue;
			}
			try {
				if (snapshotNeeded) {
					const ready = await this.snapshot(current);
					if (!current()) return;
					if (!ready) {
						// Nothing to follow until a setting changes or the window is shown again.
						await new Promise<void>((resolve) => (this.wake = resolve));
						continue;
					}
					snapshotNeeded = false;
					retry = 1000;
				}
				const events = await this.deps.rest.getEvents(
					this.since,
					LONG_POLL_SECONDS,
					EVENT_TYPES
				);
				if (!current()) return;
				for (const event of events) {
					this.since = Math.max(this.since, event.id);
					if (this.apply(event) === "reload") snapshotNeeded = true;
				}
				if (!snapshotNeeded) this.emit();
			} catch (error) {
				if (!current()) return;
				this.deps.onChange({
					kind: "unknown",
					message: `Syncthing could not be asked: ${(error as Error)?.message ?? error}`,
				});
				snapshotNeeded = true;
				await Promise.race([
					this.sleep(retry),
					new Promise<void>((resolve) => (this.wake = resolve)),
				]);
				retry = Math.min(retry * 2, MAX_RETRY_MS);
			}
		}
	}

	/**
	 * Reads the folder, this device's state and every other device's.
	 * Subscribes to the events first, so none is missed in between.
	 * @returns false when there is no folder to follow, or a newer run took over.
	 */
	private async snapshot(current: () => boolean): Promise<boolean> {
		const latest = await this.deps.rest.getEvents(0, 0, EVENT_TYPES);
		this.since = latest.reduce((max, event) => Math.max(max, event.id), 0);
		const found = await this.deps.findFolder();
		if (!current()) return false;
		if (found instanceof Failure) {
			this.deps.onChange({ kind: "unknown", message: found.message });
			return false;
		}
		const folder = found.folder;
		const [status, devices, myID, connected] = await Promise.all([
			this.deps.rest.getFolderStatus(folder.id),
			this.deps.rest.getDevices(),
			this.deps.rest.getMyID(),
			this.deps.rest.getConnectedDevices(),
		]);
		const peers = new Map<string, Peer>();
		for (const { deviceID } of folder.devices) {
			if (deviceID === myID) continue;
			const device = devices.find((candidate) => candidate.deviceID === deviceID);
			peers.set(deviceID, {
				id: deviceID,
				name: device?.name || deviceID.slice(0, 7),
				connected: connected.has(deviceID),
				paused: device?.paused ?? false,
			});
		}
		await Promise.all(
			[...peers.values()].map(async (peer) => {
				peer.completion = await this.deps.rest.getCompletion(folder.id, peer.id);
			})
		);
		if (!current()) return false;
		this.folder = folder;
		this.status = status;
		this.peers = peers;
		this.emit();
		return true;
	}

	/** Updates the state from one event, or asks for a new snapshot. */
	private apply(event: SyncthingEvent): "reload" | undefined {
		const data = event.data;
		const ours = data.folder === this.folder?.id;
		const peer = (id: unknown) => (typeof id === "string" ? this.peers.get(id) : undefined);
		switch (event.type) {
			case "ConfigSaved":
				return "reload";
			case "FolderSummary": {
				const status = ours ? parseFolderStatus(data.summary) : undefined;
				if (status) this.status = status;
				return;
			}
			case "StateChanged":
				if (ours && this.status && typeof data.to === "string") {
					this.status = { ...this.status, state: data.to };
				}
				return;
			case "FolderCompletion": {
				const target = ours ? peer(data.device) : undefined;
				const completion = parseCompletion(data);
				if (target && completion) target.completion = completion;
				return;
			}
			case "DeviceConnected":
			case "DeviceDisconnected": {
				const target = peer(data.id);
				if (target) target.connected = event.type === "DeviceConnected";
				return;
			}
			case "DevicePaused":
			case "DeviceResumed": {
				const target = peer(data.device);
				if (target) target.paused = event.type === "DevicePaused";
				return;
			}
		}
	}

	private emit() {
		if (this.status) this.deps.onChange(summarise(this.status, [...this.peers.values()]));
	}
}
