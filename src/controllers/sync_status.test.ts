import { describe as group, expect, it, vi } from "vitest";
import { type SyncthingFolder } from "src/models/entities";
import { Failure } from "src/models/failures";
import { type FolderStatus, type SyncthingEvent } from "src/models/sync_state";
import {
	describe,
	type MonitorDependencies,
	type Peer,
	summarise,
	type SyncStatus,
	SyncStatusMonitor,
} from "./sync_status";

const IDLE: FolderStatus = { state: "idle", needItems: 0, needBytes: 0, errors: 0, error: "" };
const peer = (name: string, completion: number, connected = true, extra: Partial<Peer> = {}): Peer => ({
	id: name.toUpperCase(),
	name,
	connected,
	paused: false,
	completion: { completion, needItems: completion < 100 ? 1 : 0, remoteState: "valid" },
	...extra,
});

group("summarise", () => {
	it("is synced, and safe to close, when every device has everything", () => {
		const status = summarise(IDLE, [peer("phone", 100), peer("nas", 100, false)]);

		expect(status).toEqual({ kind: "synced" });
		expect(describe(status).detail).toContain("safe to close");
	});

	it("waits for a connected device that is still receiving", () => {
		expect(summarise(IDLE, [peer("phone", 40), peer("nas", 10, false)])).toEqual({
			kind: "waiting",
			devices: ["phone"],
		});
	});

	it("says which offline devices lack changes", () => {
		const status = summarise(IDLE, [peer("phone", 100), peer("nas", 99.5, false)]);

		expect(status).toEqual({ kind: "behind", devices: ["nas"] });
		expect(describe(status).detail).toContain("stay on this device");
	});

	it("counts a device whose completion is not known yet as not having everything", () => {
		expect(summarise(IDLE, [peer("phone", 0, true, { completion: undefined })])).toEqual({
			kind: "waiting",
			devices: ["phone"],
		});
	});

	it("leaves out paused devices and devices that do not share the folder back", () => {
		const notSharing = peer("laptop", 0, true, {
			completion: { completion: 0, needItems: 3, remoteState: "notSharing" },
		});

		expect(summarise(IDLE, [peer("old", 0, false, { paused: true }), notSharing])).toEqual({
			kind: "synced",
		});
	});

	it.each<[Partial<FolderStatus>, SyncStatus["kind"]]>([
		[{ state: "syncing", needItems: 12 }, "syncing"],
		[{ state: "idle", needItems: 2 }, "syncing"],
		[{ state: "scanning" }, "scanning"],
		[{ state: "scan-waiting" }, "scanning"],
		[{ state: "paused" }, "paused"],
		[{ state: "error", error: "folder path missing" }, "error"],
		[{ state: "idle", errors: 3 }, "error"],
	])("reports %j on this device as %s", (folder, kind) => {
		expect(summarise({ ...IDLE, ...folder }, [peer("phone", 100)]).kind).toBe(kind);
	});

	it("writes short texts for the status bar", () => {
		expect(describe({ kind: "syncing", needItems: 1, needBytes: 5 }).text).toBe("Syncing 1 item");
		expect(describe({ kind: "waiting", devices: ["phone", "nas"] }).text).toBe(
			"Waiting for phone, nas",
		);
	});
});

const FOLDER = {
	id: "vault",
	label: "Vault",
	path: "/v",
	devices: [{ deviceID: "ME" }, { deviceID: "PHONE" }],
} as unknown as SyncthingFolder;

/** A fake Syncthing whose event long-polls wait until the test sends events. */
function fakeSyncthing() {
	let pending: ((events: SyncthingEvent[]) => void) | undefined;
	let fail: ((error: Error) => void) | undefined;
	const rest = {
		getEvents: vi.fn((since: number, timeout: number) =>
			timeout === 0
				? Promise.resolve({ events: [], lastId: 7 })
				: new Promise<{ events: SyncthingEvent[]; lastId: number }>((resolve, reject) => {
						pending = (events) =>
							resolve({
								events,
								lastId: events.reduce((max, event) => Math.max(max, event.id), since),
							});
						fail = reject;
					}),
		),
		getFolderStatus: vi.fn(async () => ({ ...IDLE })),
		getCompletion: vi.fn(async () => ({ completion: 100, needItems: 0, remoteState: "valid" })),
		getLastScan: vi.fn(async (): Promise<number | undefined> => 1_000),
		getDeviceStates: vi.fn(async () => ({
			devices: [{ deviceID: "PHONE", name: "phone", paused: false }],
			myID: "ME",
			connected: new Set(["PHONE"]),
		})),
	};
	const statuses: SyncStatus[] = [];
	let hidden = false;
	const deps: MonitorDependencies = {
		rest: rest as unknown as MonitorDependencies["rest"],
		findFolder: vi.fn(async () => ({ folder: FOLDER, vaultPath: "", chosen: false })),
		onChange: (status) => statuses.push(status),
		hidden: () => hidden,
		sleep: () => new Promise(() => undefined),
	};
	const monitor = new SyncStatusMonitor(deps);
	return {
		rest,
		deps,
		monitor,
		statuses,
		setHidden: (value: boolean) => (hidden = value),
		send: (...events: SyncthingEvent[]) => pending?.(events),
		fail: (error: Error) => fail?.(error),
		longPolls: () => rest.getEvents.mock.calls.filter(([, timeout]) => timeout > 0),
	};
}

group("SyncStatusMonitor", () => {
	it("reads a snapshot, then follows events from the latest one", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.start();

		await vi.waitFor(() => expect(syncthing.statuses).toEqual([{ kind: "synced" }]));
		expect(syncthing.longPolls()).toEqual([[7, 30, expect.any(Array)]]);
		expect(syncthing.rest.getEvents).toHaveBeenCalledWith(0, 0, expect.any(Array), 1);

		syncthing.send({
			id: 8,
			type: "FolderSummary",
			data: { folder: "vault", summary: { state: "syncing", needFiles: 2, needDeletes: 1 } },
		});
		await vi.waitFor(() =>
			expect(syncthing.statuses.at(-1)).toEqual({ kind: "syncing", needItems: 3, needBytes: 0 }),
		);
		expect(syncthing.longPolls().at(-1)?.[0]).toBe(8);
	});

	it("follows another device's completion and connection", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.start();
		await vi.waitFor(() => expect(syncthing.statuses).toHaveLength(1));

		syncthing.send({
			id: 9,
			type: "FolderCompletion",
			data: { folder: "vault", device: "PHONE", completion: 50, needItems: 4 },
		});
		await vi.waitFor(() =>
			expect(syncthing.statuses.at(-1)).toEqual({ kind: "waiting", devices: ["phone"] }),
		);
		syncthing.send({ id: 10, type: "DeviceDisconnected", data: { id: "PHONE" } });
		await vi.waitFor(() =>
			expect(syncthing.statuses.at(-1)).toEqual({ kind: "behind", devices: ["phone"] }),
		);
	});

	it("ignores events about other folders", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.start();
		await vi.waitFor(() => expect(syncthing.statuses).toHaveLength(1));

		syncthing.send({
			id: 9,
			type: "FolderSummary",
			data: { folder: "other", summary: { state: "error", error: "x" } },
		});
		await vi.waitFor(() => expect(syncthing.statuses).toHaveLength(2));

		expect(syncthing.statuses.at(-1)).toEqual({ kind: "synced" });
	});

	it("reads everything again after Syncthing's configuration changes", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.start();
		await vi.waitFor(() => expect(syncthing.statuses).toHaveLength(1));

		syncthing.send({ id: 9, type: "ConfigSaved", data: {} });

		await vi.waitFor(() => expect(syncthing.deps.findFolder).toHaveBeenCalledTimes(2));
	});

	it("starts no request while the window is hidden, and reads again when shown", async () => {
		const syncthing = fakeSyncthing();
		syncthing.setHidden(true);
		syncthing.monitor.start();
		await Promise.resolve();

		expect(syncthing.rest.getEvents).not.toHaveBeenCalled();

		syncthing.setHidden(false);
		syncthing.monitor.visible();
		await vi.waitFor(() => expect(syncthing.statuses).toEqual([{ kind: "synced" }]));
	});

	it("stops after the long-poll in flight when the window is hidden", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.start();
		await vi.waitFor(() => expect(syncthing.longPolls()).toHaveLength(1));

		syncthing.setHidden(true);
		syncthing.send();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(syncthing.longPolls()).toHaveLength(1);
	});

	it("says the state is unknown when Syncthing cannot be asked", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.start();
		await vi.waitFor(() => expect(syncthing.longPolls()).toHaveLength(1));

		syncthing.fail(new Error("connection refused"));

		await vi.waitFor(() =>
			expect(syncthing.statuses.at(-1)).toEqual({
				kind: "unknown",
				message: expect.stringContaining("connection refused"),
			}),
		);
	});

	it("says why when the vault has no Syncthing folder, and finds one added later", async () => {
		const syncthing = fakeSyncthing();
		vi.mocked(syncthing.deps.findFolder).mockResolvedValueOnce(
			new Failure("No folder holds the vault."),
		);
		syncthing.monitor.start();
		await vi.waitFor(() =>
			expect(syncthing.statuses).toEqual([{ kind: "unknown", message: "No folder holds the vault." }]),
		);
		await vi.waitFor(() => expect(syncthing.longPolls()).toHaveLength(1));

		syncthing.send({ id: 9, type: "ConfigSaved", data: {} });

		await vi.waitFor(() => expect(syncthing.statuses.at(-1)).toEqual({ kind: "synced" }));
	});

	it("does not say synced until Syncthing scanned a change made in the vault", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.start();
		await vi.waitFor(() => expect(syncthing.statuses).toEqual([{ kind: "synced" }]));

		syncthing.monitor.vaultChanged(2_000);
		expect(syncthing.statuses.at(-1)).toEqual({ kind: "unscanned" });

		syncthing.send(
			{
				id: 9,
				type: "StateChanged",
				time: new Date(3_000).toISOString(),
				data: { folder: "vault", from: "idle", to: "scanning" },
			},
			{ id: 10, type: "StateChanged", data: { folder: "vault", from: "scanning", to: "idle" } },
		);
		await vi.waitFor(() => expect(syncthing.statuses.at(-1)).toEqual({ kind: "synced" }));
	});

	it("does not count a scan that started before the change", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.start();
		await vi.waitFor(() => expect(syncthing.statuses).toHaveLength(1));

		syncthing.send({
			id: 9,
			type: "StateChanged",
			time: new Date(1_500).toISOString(),
			data: { folder: "vault", from: "idle", to: "scanning" },
		});
		await vi.waitFor(() => expect(syncthing.longPolls()).toHaveLength(2));
		syncthing.monitor.vaultChanged(2_000);
		syncthing.send({
			id: 10,
			type: "StateChanged",
			data: { folder: "vault", from: "scanning", to: "idle" },
		});

		await vi.waitFor(() => expect(syncthing.statuses.at(-1)).toEqual({ kind: "unscanned" }));
	});

	it("does not report anything when a long-poll ends without events", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.start();
		await vi.waitFor(() => expect(syncthing.longPolls()).toHaveLength(1));

		syncthing.send();
		await vi.waitFor(() => expect(syncthing.longPolls()).toHaveLength(2));

		expect(syncthing.statuses).toHaveLength(1);
	});

	it("counts a change as scanned when a snapshot shows a later finished scan", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.vaultChanged(500);

		await expect(syncthing.monitor.check()).resolves.toEqual({ kind: "synced" });

		syncthing.monitor.vaultChanged(1_500);
		await expect(syncthing.monitor.check()).resolves.toEqual({ kind: "unscanned" });
	});

	it("shows the other devices when one device's completion cannot be read", async () => {
		const syncthing = fakeSyncthing();
		syncthing.rest.getCompletion.mockRejectedValueOnce(new Error("no such device"));

		await expect(syncthing.monitor.check()).resolves.toEqual({
			kind: "waiting",
			devices: ["phone"],
		});
	});

	it("keeps saying Syncthing is unreachable when the vault changes meanwhile", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.start();
		await vi.waitFor(() => expect(syncthing.longPolls()).toHaveLength(1));
		syncthing.fail(new Error("connection refused"));
		await vi.waitFor(() => expect(syncthing.statuses.at(-1)?.kind).toBe("unknown"));

		syncthing.monitor.vaultChanged();

		expect(syncthing.statuses.at(-1)?.kind).toBe("unknown");
	});

	it("moves past a malformed event instead of asking for it again", async () => {
		const syncthing = fakeSyncthing();
		syncthing.rest.getEvents.mockImplementationOnce(async () => ({ events: [], lastId: 7 }));
		syncthing.rest.getEvents.mockImplementationOnce(async () => ({ events: [], lastId: 12 }));
		syncthing.monitor.start();

		await vi.waitFor(() => expect(syncthing.longPolls()).toHaveLength(2));
		expect(syncthing.longPolls()[1][0]).toBe(12);
	});

	it("reads the state once for the command, without following it", async () => {
		const syncthing = fakeSyncthing();

		await expect(syncthing.monitor.check()).resolves.toEqual({ kind: "synced" });
		expect(syncthing.longPolls()).toHaveLength(0);
	});

	it("drops the answers of a run that was restarted", async () => {
		const syncthing = fakeSyncthing();
		syncthing.monitor.start();
		await vi.waitFor(() => expect(syncthing.longPolls()).toHaveLength(1));
		const stale = syncthing.send;

		syncthing.monitor.stop();
		stale({
			id: 9,
			type: "FolderSummary",
			data: { folder: "vault", summary: { state: "error", error: "late" } },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(syncthing.statuses).toEqual([{ kind: "synced" }]);
	});
});
