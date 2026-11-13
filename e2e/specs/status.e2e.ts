import { browser, expect } from "@wdio/globals";
import { after, before, describe, it } from "mocha";
import { ReverseProxy } from "../helpers/proxy.ts";
import { sleep, waitFor } from "../helpers/syncthing.ts";
import { connectPlugin, note, PLUGIN_ID, shareVault, takeNotices, writeOnPeer, type SharedVault } from "../helpers/vault.ts";

interface Shown {
	kind?: string;
	text: string;
	detail: string;
}

/** The sync status as the status bar shows it. */
async function shown(): Promise<Shown> {
	return browser.executeObsidian(({ plugins }) => {
		const plugin = plugins.syncthingIntegration;
		const el = document.querySelector(".status-bar-item.mod-clickable:not(:empty)") as HTMLElement | null;
		const items = [...document.querySelectorAll(".status-bar-item")].filter((item) =>
			/Synced|Sync|Scanning|Syncing|Waiting|Not on|Changes not scanned/.test(item.textContent ?? ""),
		);
		const item = (items[0] as HTMLElement | undefined) ?? el;
		return {
			kind: plugin.syncStatus?.kind as string | undefined,
			text: item?.textContent ?? "",
			detail: item?.getAttribute("aria-label") ?? "",
		};
	});
}

async function waitForKind(kind: string, timeout = 60_000): Promise<Shown> {
	let last: Shown | undefined;
	await browser.waitUntil(
		async () => {
			last = await shown();
			return last.kind === kind;
		},
		{ timeout, interval: 250, timeoutMsg: `status never became "${kind}"` },
	).catch(() => {
		throw new Error(`status never became "${kind}"; last: ${JSON.stringify(last)}`);
	});
	return last!;
}

/** Records every status kind the plugin shows from now on. */
async function startRecording() {
	await browser.executeObsidian(({ plugins }) => {
		const w = window as unknown as { e2eKinds: string[]; e2eTimer: number };
		w.e2eKinds = [];
		window.clearInterval(w.e2eTimer);
		w.e2eTimer = window.setInterval(() => {
			const kind = plugins.syncthingIntegration.syncStatus?.kind ?? "none";
			if (w.e2eKinds[w.e2eKinds.length - 1] !== kind) w.e2eKinds.push(kind);
		}, 50);
	});
}

async function recorded(): Promise<string[]> {
	return browser.executeObsidian(() => (window as unknown as { e2eKinds: string[] }).e2eKinds);
}

async function editInObsidian(file: string, text: string) {
	await browser.executeObsidian(
		async ({ app, obsidian }, file, text) => {
			const note = app.vault.getAbstractFileByPath(file);
			if (note instanceof obsidian.TFile) await app.vault.modify(note, text);
			else await app.vault.create(file, text);
		},
		file,
		text,
	);
}

async function setHidden(hidden: boolean) {
	await browser.executeObsidian((_, hidden) => {
		Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
		document.dispatchEvent(new Event("visibilitychange"));
	}, hidden);
}

describe("Sync status and safe-to-close", function () {
	let vault: SharedVault;

	before(async function () {
		vault = await shareVault("status");
		await connectPlugin(vault);
	});

	it("T1: an idle, synced vault says Synced, with an explanation", async function () {
		const status = await waitForKind("synced");
		expect(status.text).toBe("Synced");
		expect(status.detail.length).toBeGreaterThan(10);
		note(status.detail);
	});

	it("T2: an edit moves through scanning or syncing and back to Synced", async function () {
		await startRecording();
		await editInObsidian("Welcome.md", `# Welcome\n\nEdited at ${Date.now()}\n`);
		await sleep(500);
		await waitForKind("synced", 60_000);
		const kinds = await recorded();
		note(kinds.join(" → "));
		expect(kinds.some((k) => ["unscanned", "scanning", "syncing", "waiting"].includes(k))).toBe(true);
		expect(kinds.at(-1)).toBe("synced");
	});

	it("T3: an edit while the other device is offline says it is only here", async function () {
		await vault.b.setDevicePaused(vault.idA, true);
		await waitFor("Device B to disconnect", async () => !(await vault.a.connected(vault.idB)));
		try {
			await editInObsidian("Welcome.md", `# Welcome\n\nOffline edit at ${Date.now()}\n`);
			const status = await waitForKind("behind", 60_000);
			expect(status.text).toBe("Not on Device B");
			note(status.detail);
		} finally {
			await vault.b.setDevicePaused(vault.idA, false);
		}
		await waitForKind("synced", 90_000);
	});

	it("T4: a paused folder says paused; a paused device doesn't count", async function () {
		await vault.a.setFolderPaused(vault.folderId, true);
		try {
			expect((await waitForKind("paused")).text).toBe("Sync paused");
		} finally {
			await vault.a.setFolderPaused(vault.folderId, false);
		}
		await waitForKind("synced", 60_000);
		await vault.a.setDevicePaused(vault.idB, true);
		try {
			await editInObsidian("Welcome.md", `# Welcome\n\nWhile B is paused ${Date.now()}\n`);
			await sleep(3000);
			const status = await waitForKind("synced", 60_000);
			note(`with Device B paused: ${status.text}`);
		} finally {
			await vault.a.setDevicePaused(vault.idB, false);
		}
		await waitForKind("synced", 90_000);
	});

	it("T5: Syncthing going away shows unknown with the reason, then recovers", async function () {
		const proxy = new ReverseProxy(vault.a.url, 18393);
		await proxy.start();
		try {
			await connectPlugin(vault, { url: proxy.url });
			await waitForKind("synced");
			await proxy.stop();
			const unknown = await waitForKind("unknown", 45_000);
			expect(unknown.text).toBe("Sync status unknown");
			note(unknown.detail);
			await sleep(5000);
			const stoppedAt = Date.now();
			await proxy.start();
			await waitForKind("synced", 90_000);
			note(`recovered ${Math.round((Date.now() - stoppedAt) / 1000)} s after Syncthing came back`);
		} finally {
			await connectPlugin(vault);
			await proxy.stop();
		}
	});

	it("T6: no requests while hidden; read again when shown", async function () {
		const proxy = new ReverseProxy(vault.a.url, 18394);
		await proxy.start();
		try {
			await connectPlugin(vault, { url: proxy.url });
			await waitForKind("synced");
			await setHidden(true);
			// A long-poll already in flight runs out (30 s); nothing new may start after that.
			await waitFor("the long-poll in flight to end", () => proxy.open().length === 0, 45_000);
			const before = proxy.seen.length;
			await writeOnPeer(vault, "from-b.md", `written on B at ${Date.now()}`);
			await sleep(10_000);
			expect(proxy.seen.length).toBe(before);
			await setHidden(false);
			await waitFor("a request after showing the window", () => proxy.seen.length > before, 5_000);
			await waitForKind("synced", 30_000);
		} finally {
			await setHidden(false);
			await connectPlugin(vault);
			await proxy.stop();
		}
	});

	it("T7: changing the API key restarts the status with the new key", async function () {
		await connectPlugin(vault, { apiKey: "wrong-key" });
		const unknown = await waitForKind("unknown", 30_000);
		expect(unknown.detail).toMatch(/HTTP 40[13]/);
		await connectPlugin(vault);
		await waitForKind("synced", 30_000);
	});

	it("T8-DESKTOP: the safe-to-close command shows the status as a notice", async function () {
		await takeNotices();
		await browser.executeObsidianCommand(`${PLUGIN_ID}:syncthing-safe-to-close`);
		await browser.waitUntil(async () => (await takeNotices()).some((n) => n.length > 10), { timeout: 10_000 });
	});

	it("L2: each restart leaves at most one extra long-poll, ending within 30 s", async function () {
		const proxy = new ReverseProxy(vault.a.url, 18395);
		await proxy.start();
		try {
			await connectPlugin(vault, { url: proxy.url });
			await waitForKind("synced");
			const keys = ["wrong-1", "wrong-2", vault.a.info.apiKey];
			for (const key of keys) {
				await connectPlugin(vault, { url: proxy.url, apiKey: key });
				await sleep(1500);
			}
			const events = () => proxy.open().filter((s) => s.path.includes("/rest/events"));
			const peak = events().length;
			const start = Date.now();
			const t = Date.now();
			await browser.executeObsidian(async ({ plugins }) => plugins.syncthingIntegration.syncthingFromREST.getMyID());
			const latency = Date.now() - t;
			await waitFor("the extra long-polls to end", () => events().length <= 1, 35_000);
			note(`${peak} long-polls open after ${keys.length} restarts; extra ones gone after ${Math.round((Date.now() - start) / 1000)} s; another request meanwhile took ${latency} ms`);
			expect(peak).toBeLessThanOrEqual(keys.length + 1);
		} finally {
			await connectPlugin(vault);
			await proxy.stop();
		}
	});

	after(async function () {
		await setHidden(false).catch(() => undefined);
	});
});
