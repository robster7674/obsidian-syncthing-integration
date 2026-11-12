import { createRequire } from "node:module";
import type * as ChildProcess from "node:child_process";
import type * as Fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { CliFailure } from "src/models/failures";
import { asPlugin, makePlugin } from "../../test/helpers/plugin";
import { MACOS_APP_BINARY, SyncthingFromCLI } from "./syncthing_local_datasource";

/**
 * The datasource requires `child_process` and `fs` at run time, which Vitest
 * resolves through Node, so the real modules are patched.
 */
const nodeRequire = createRequire(import.meta.url);
const childProcess = nodeRequire("child_process") as typeof ChildProcess;
const fs = nodeRequire("fs") as typeof Fs;

let calls: { binary: string; args: string[] }[];
let outcome: {
	error?: Error & { code?: string };
	stdout?: string;
	stderr?: string;
};
let plugin: ReturnType<typeof makePlugin>;
let cli: SyncthingFromCLI;

beforeEach(() => {
	calls = [];
	outcome = {};
	vi.spyOn(childProcess, "execFile").mockImplementation(((
		binary: string,
		args: string[],
		_options: unknown,
		callback: (error: unknown, stdout: string, stderr: string) => void,
	) => {
		calls.push({ binary, args });
		callback(outcome.error ?? null, outcome.stdout ?? "", outcome.stderr ?? "");
	}) as never);
	vi.spyOn(fs, "existsSync").mockReturnValue(false);
	plugin = makePlugin();
	cli = new SyncthingFromCLI(asPlugin(plugin));
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SyncthingFromCLI.getVersion", () => {
	it("runs syncthing --version without a shell and trims the output", async () => {
		outcome.stdout = "syncthing v2.1.7\n";

		await expect(cli.getVersion()).resolves.toBe("syncthing v2.1.7");
		expect(calls).toEqual([{ binary: "syncthing", args: ["--version"] }]);
	});

	it("ignores warnings on stderr when Syncthing succeeds", async () => {
		outcome = { stdout: "syncthing v2.1.7", stderr: "WARNING: something" };

		await expect(cli.getVersion()).resolves.toBe("syncthing v2.1.7");
	});

	it("says to set the path when the program is not found", async () => {
		outcome.error = Object.assign(new Error("spawn syncthing ENOENT"), {
			code: "ENOENT",
		});

		const attempt = cli.getVersion();

		await expect(attempt).rejects.toBeInstanceOf(CliFailure);
		await expect(attempt).rejects.toMatchObject({
			message: expect.stringContaining("Set the path to Syncthing"),
		});
	});

	it("reports what Syncthing wrote when it exits with an error", async () => {
		outcome = { error: new Error("Command failed"), stderr: "config: locked\n" };

		await expect(cli.getVersion()).rejects.toMatchObject({
			message: "Running syncthing failed: config: locked",
		});
	});

	it("is not available on mobile", async () => {
		Platform.isMobileApp = true;

		await expect(cli.getVersion()).rejects.toBeInstanceOf(CliFailure);
		expect(calls).toEqual([]);
	});
});

describe("SyncthingFromCLI.binary", () => {
	it("uses the path set for this device, as given", async () => {
		plugin.device.cliPath = "C:\\Program Files\\Syncthing\\syncthing.exe";
		outcome.stdout = "v2";

		await cli.getVersion();

		expect(calls[0].binary).toBe("C:\\Program Files\\Syncthing\\syncthing.exe");
	});

	it("uses the syncthing-macos app when it is installed", () => {
		Platform.isMacOS = true;
		vi.mocked(fs.existsSync).mockReturnValue(true);

		expect(cli.binary()).toBe(MACOS_APP_BINARY);
	});

	it("falls back to the PATH on macOS without the app, such as a Homebrew install", () => {
		Platform.isMacOS = true;

		expect(cli.binary()).toBe("syncthing");
	});

	it("falls back to the PATH when checking for the macOS app fails", () => {
		Platform.isMacOS = true;
		vi.mocked(fs.existsSync).mockImplementation(() => {
			throw new Error("EACCES");
		});

		expect(cli.binary()).toBe("syncthing");
	});
});

describe("SyncthingFromCLI.getAPIkey", () => {
	it("returns the trimmed API key", async () => {
		outcome.stdout = "  my-api-key\n";

		await expect(cli.getAPIkey()).resolves.toBe("my-api-key");
		expect(calls[0].args).toEqual(["cli", "config", "gui", "apikey", "get"]);
	});

	it("throws a CliFailure when Syncthing has no key", async () => {
		outcome.stdout = "\n";

		await expect(cli.getAPIkey()).rejects.toMatchObject({
			message: "Syncthing has no API key set.",
		});
	});
});
