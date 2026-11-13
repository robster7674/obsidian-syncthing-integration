import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";

export interface InstanceInfo {
	name: string;
	home: string;
	guiPort: number;
	syncPort: number;
	apiKey: string;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `check` until it returns a truthy value, or fails with `what` after `timeoutMs`. */
export async function waitFor<T>(
	what: string,
	check: () => Promise<T | undefined | false> | T | undefined | false,
	timeoutMs = 30_000,
): Promise<T> {
	const end = Date.now() + timeoutMs;
	let last: unknown;
	while (Date.now() < end) {
		try {
			const value = await check();
			if (value) return value;
		} catch (error) {
			last = error;
		}
		await sleep(250);
	}
	throw new Error(`Timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`);
}

/** A Syncthing instance driven through its REST API, from the test process. */
export class Syncthing {
	constructor(readonly info: InstanceInfo) {}

	get url(): string {
		return `http://127.0.0.1:${this.info.guiPort}`;
	}

	async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await fetch(this.url + path, {
			method,
			headers: { "X-API-Key": this.info.apiKey, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) {
			throw new Error(`${this.info.name} ${method} ${path}: ${response.status} ${await response.text()}`);
		}
		const text = await response.text();
		return (text ? JSON.parse(text) : undefined) as T;
	}

	async myId(): Promise<string> {
		return (await this.request<{ myID: string }>("GET", "/rest/system/status")).myID;
	}

	/** Shares `folderId` at `path` with `peers`, replacing an earlier folder of that id. */
	async shareFolder(folderId: string, path: string, peers: string[], label = folderId) {
		mkdirSync(path, { recursive: true });
		await this.request("PUT", `/rest/config/folders/${folderId}`, {
			id: folderId,
			label,
			path,
			type: "sendreceive",
			devices: [{ deviceID: await this.myId() }, ...peers.map((deviceID) => ({ deviceID }))],
			fsWatcherEnabled: true,
			fsWatcherDelayS: 1,
			rescanIntervalS: 3600,
		});
	}

	async removeFolder(folderId: string) {
		await this.request("DELETE", `/rest/config/folders/${folderId}`).catch(() => undefined);
	}

	async setDevicePaused(deviceId: string, paused: boolean) {
		await this.request("PATCH", `/rest/config/devices/${deviceId}`, { paused });
	}

	async setFolderPaused(folderId: string, paused: boolean) {
		await this.request("PATCH", `/rest/config/folders/${folderId}`, { paused });
	}

	async scan(folderId: string) {
		await this.request("POST", `/rest/db/scan?folder=${encodeURIComponent(folderId)}`);
	}

	async folderState(folderId: string): Promise<string> {
		return (
			await this.request<{ state: string }>("GET", `/rest/db/status?folder=${encodeURIComponent(folderId)}`)
		).state;
	}

	async connected(deviceId: string): Promise<boolean> {
		const { connections } = await this.request<{ connections: Record<string, { connected: boolean }> }>(
			"GET",
			"/rest/system/connections",
		);
		return connections[deviceId]?.connected ?? false;
	}

	async completion(folderId: string, deviceId: string): Promise<number> {
		return (
			await this.request<{ completion: number }>(
				"GET",
				`/rest/db/completion?folder=${encodeURIComponent(folderId)}&device=${deviceId}`,
			)
		).completion;
	}

	/** Waits until this instance has scanned and both sides of `folderId` are complete. */
	async waitInSync(folderId: string, peerId: string, timeoutMs = 60_000) {
		await waitFor(
			`${this.info.name} in sync on ${folderId}`,
			async () =>
				(await this.folderState(folderId)) === "idle" &&
				(await this.completion(folderId, peerId)) === 100,
			timeoutMs,
		);
	}
}

/** Starts a Syncthing process for `info`; resolves once its REST API answers. */
export async function startSyncthing(binary: string, info: InstanceInfo): Promise<ChildProcess> {
	mkdirSync(info.home, { recursive: true });
	const taken = await fetch(`http://127.0.0.1:${info.guiPort}/rest/noauth/health`).then(
		() => true,
		() => false,
	);
	if (taken) throw new Error(`Port ${info.guiPort} is in use: is a Syncthing from an earlier run still running?`);
	const child = spawn(
		binary,
		[
			"serve",
			`--home=${info.home}`,
			`--gui-address=http://127.0.0.1:${info.guiPort}`,
			`--gui-apikey=${info.apiKey}`,
			"--no-browser",
			"--no-restart",
			"--no-upgrade",
			"--no-port-probing",
			`--log-file=${info.home}/syncthing.log`,
		],
		{ stdio: "ignore", detached: true, env: { ...process.env, STNODEFAULTFOLDER: "1" } },
	);
	const syncthing = new Syncthing(info);
	try {
		await configure(syncthing);
	} catch (error) {
		stopSyncthing(child);
		throw error;
	}
	return child;
}

async function configure(syncthing: Syncthing) {
	const { info } = syncthing;
	await waitFor(`${info.name} to start`, () => syncthing.request("GET", "/rest/system/ping"));
	// Stored as well, so `syncthing cli` reads the same key from the config.
	// Syncthing restarts its GUI listener for this, which may drop the answer.
	await syncthing.request("PATCH", "/rest/config/gui", { apiKey: info.apiKey }).catch(() => undefined);
	await sleep(500);
	await waitFor(`${info.name} to restart its GUI`, () => syncthing.request("GET", "/rest/system/ping"));
	await syncthing.request("PATCH", "/rest/config/options", {
		listenAddresses: [`tcp://127.0.0.1:${info.syncPort}`],
		globalAnnounceEnabled: false,
		localAnnounceEnabled: false,
		relaysEnabled: false,
		natEnabled: false,
		urAccepted: -1,
		crashReportingEnabled: false,
		autoUpgradeIntervalH: 0,
	});
}

/** Stops a Syncthing started by {@link startSyncthing}, with the process it monitors. */
export function stopSyncthing(child: ChildProcess) {
	if (child.pid) {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {
			// Already gone.
		}
	}
}

/** Makes `a` and `b` known to each other at their localhost addresses. */
export async function pair(a: Syncthing, b: Syncthing) {
	await a.request("PATCH", `/rest/config/devices/${await a.myId()}`, { name: a.info.name });
	await b.request("PATCH", `/rest/config/devices/${await b.myId()}`, { name: b.info.name });
	const [idA, idB] = [await a.myId(), await b.myId()];
	await a.request("PUT", `/rest/config/devices/${idB}`, {
		deviceID: idB,
		name: b.info.name,
		addresses: [`tcp://127.0.0.1:${b.info.syncPort}`],
	});
	await b.request("PUT", `/rest/config/devices/${idA}`, {
		deviceID: idA,
		name: a.info.name,
		addresses: [`tcp://127.0.0.1:${a.info.syncPort}`],
	});
	await waitFor("the two Syncthing instances to connect", () => a.connected(idB), 60_000);
}
