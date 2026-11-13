import type { ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { env } from "node:process";
import { browser } from "@wdio/globals";
import { parseObsidianVersions } from "wdio-obsidian-service";
import { pair, startSyncthing, stopSyncthing, Syncthing, type InstanceInfo } from "./helpers/syncthing.ts";
import { writeSummary } from "./helpers/results.ts";

const root = path.resolve(import.meta.dirname, "..");
const cacheDir = path.join(root, ".obsidian-cache");
const workDir = path.join(root, ".e2e");
const resultsFile = path.join(workDir, "results.jsonl");

const minAppVersion: string = JSON.parse(
	readFileSync(path.join(root, "manifest.json"), "utf8"),
).minAppVersion;

const versions = await parseObsidianVersions(
	env.OBSIDIAN_VERSIONS ?? `${minAppVersion}/latest latest/latest`,
	{ cacheDir },
);

const instances: InstanceInfo[] = [
	{ name: "Device A", home: path.join(workDir, "syncthing-a"), guiPort: 18384, syncPort: 22001, apiKey: "e2e-key-a" },
	{ name: "Device B", home: path.join(workDir, "syncthing-b"), guiPort: 18385, syncPort: 22002, apiKey: "e2e-key-b" },
];
const processes: ChildProcess[] = [];

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: [path.join(import.meta.dirname, "specs/**/*.e2e.ts")],
	maxInstances: 1,

	capabilities: versions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
		browserName: "obsidian",
		"wdio:obsidianOptions": {
			appVersion,
			installerVersion,
			plugins: [path.join(root, "build")],
			vault: path.join(import.meta.dirname, "vault"),
		},
	})),

	services: ["obsidian"],
	reporters: ["obsidian"],
	mochaOpts: { ui: "bdd", timeout: 180_000 },
	waitforInterval: 250,
	waitforTimeout: 10_000,
	connectionRetryTimeout: 120_000,
	logLevel: "warn",
	cacheDir,
	injectGlobals: false,

	async onPrepare() {
		rmSync(workDir, { recursive: true, force: true });
		mkdirSync(workDir, { recursive: true });
		const binary = path.resolve(env.SYNCTHING_BIN ?? "syncthing");
		try {
			for (const info of instances) processes.push(await startSyncthing(binary, info));
			const [a, b] = instances.map((info) => new Syncthing(info));
			await pair(a, b);
		} catch (error) {
			for (const child of processes) stopSyncthing(child);
			throw error;
		}
		env.E2E_SYNCTHING = JSON.stringify(instances);
		env.E2E_WORK_DIR = workDir;
		// Inherited by Obsidian: its system trash stays inside this run, and
		// `syncthing cli` on PATH talks to Device A.
		env.XDG_DATA_HOME = path.join(workDir, "xdg");
		mkdirSync(env.XDG_DATA_HOME, { recursive: true });
		env.STHOMEDIR = instances[0].home;
		env.PATH = `${path.dirname(binary)}${path.delimiter}${env.PATH}`;
	},

	afterTest(test, context, { passed, error }) {
		const notes = (globalThis as { e2eNotes?: string[] }).e2eNotes ?? [];
		(globalThis as { e2eNotes?: string[] }).e2eNotes = [];
		appendFileSync(
			resultsFile,
			JSON.stringify({
				obsidian: browser.getObsidianVersion(),
				suite: test.parent,
				title: test.title,
				passed,
				error: error?.message,
				notes,
			}) + "\n",
		);
	},

	afterHook(test, context, { passed, error }) {
		if (passed) return;
		appendFileSync(
			resultsFile,
			JSON.stringify({
				obsidian: browser.getObsidianVersion(),
				suite: test.parent,
				title: `HOOK: ${test.parent} ${test.title}, so the cases after it did not run`,
				passed: false,
				error: error?.message,
			}) + "\n",
		);
	},

	onComplete() {
		for (const child of processes) stopSyncthing(child);
		writeSummary(resultsFile, path.join(workDir, "summary.md"));
	},
};
