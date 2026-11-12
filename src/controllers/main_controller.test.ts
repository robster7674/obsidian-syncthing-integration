import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { Platform, type TFile } from "obsidian";
import type { SyncthingFromAndroid } from "src/data/syncthing_android_datasource";
import type { SyncthingFromCLI } from "src/data/syncthing_local_datasource";
import type { SyncthingFromREST } from "src/data/syncthing_remote_datasource";
import type SyncthingPlugin from "src/main";
import {
	CliFailure,
	Failure,
	MissingOriginalFailure,
} from "src/models/failures";
import { makeConflictFile, makeFile } from "../../test/helpers/files";
import {
	asPlugin,
	makePlugin,
	type FakePlugin,
} from "../../test/helpers/plugin";
import { SyncthingController } from "./main_controller";

interface ControllerHarness {
	controller: SyncthingController;
	cli: {
		getVersion: Mock;
		getAPIkey: Mock;
		startSyncthing: Mock;
		stopSyncthing: Mock;
	};
	rest: {
		ping: Mock;
		getDevices: Mock;
		getAllFolders: Mock;
	};
	android: { hasSyncthing: Mock };
	plugin: FakePlugin;
}

function makeHarness(files: TFile[] = [], settings = {}): ControllerHarness {
	const cli = {
		getVersion: vi.fn(),
		getAPIkey: vi.fn(),
		startSyncthing: vi.fn(),
		stopSyncthing: vi.fn(),
	};
	const rest = {
		ping: vi.fn(),
		getDevices: vi.fn(),
		getAllFolders: vi.fn(),
	};
	const android = { hasSyncthing: vi.fn() };
	const plugin = makePlugin(files, settings);
	const controller = new SyncthingController(
		cli as unknown as SyncthingFromCLI,
		rest as unknown as SyncthingFromREST,
		android as unknown as SyncthingFromAndroid,
		asPlugin(plugin) as SyncthingPlugin,
	);
	return { controller, cli, rest, android, plugin };
}

beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SyncthingController status helpers", () => {
	it("getCLIStatus delegates to the CLI datasource", async () => {
		const { controller, cli } = makeHarness();
		cli.getVersion.mockResolvedValue("syncthing v1.27.0");

		await expect(controller.getCLIStatus()).resolves.toBe("syncthing v1.27.0");
	});

	it("getAPIStatus reports a missing API key", async () => {
		const { controller, rest } = makeHarness();

		await expect(controller.getAPIStatus()).resolves.toBe(
			"API key is not set.",
		);
		expect(rest.ping).not.toHaveBeenCalled();
	});

	it("getAPIStatus pings the REST API when a key is set", async () => {
		const { controller, rest } = makeHarness([], { apiKey: "key" });
		rest.ping.mockResolvedValue("pong");

		await expect(controller.getAPIStatus()).resolves.toBe("pong");
	});
});

describe("SyncthingController.hasSyncthing", () => {
	it("uses the Android datasource on Android", async () => {
		Platform.isAndroidApp = true;
		const { controller, android, cli } = makeHarness();
		android.hasSyncthing.mockResolvedValue(true);

		await expect(controller.hasSyncthing()).resolves.toBe(true);
		expect(cli.getVersion).not.toHaveBeenCalled();
	});

	it("returns false on iOS", async () => {
		Platform.isIosApp = true;
		const { controller } = makeHarness();

		await expect(controller.hasSyncthing()).resolves.toBe(false);
	});

	it("returns true when the CLI version is available", async () => {
		const { controller, cli } = makeHarness();
		cli.getVersion.mockResolvedValue("syncthing v1.27.0");

		await expect(controller.hasSyncthing()).resolves.toBe(true);
	});

	it("falls back to the REST API when the CLI fails", async () => {
		const { controller, cli, rest } = makeHarness();
		cli.getVersion.mockRejectedValue(new Error("no cli"));
		rest.ping.mockResolvedValue("pong");

		await expect(controller.hasSyncthing()).resolves.toBe(true);
	});

	it("returns false when neither CLI nor REST work", async () => {
		const { controller, cli, rest } = makeHarness();
		cli.getVersion.mockRejectedValue(new Error("no cli"));
		rest.ping.mockRejectedValue(new Error("no rest"));

		await expect(controller.hasSyncthing()).resolves.toBe(false);
	});
});

// Two notes with the same name in different folders, as reported in LBF38#306.
const originalA = makeFile("a/Note.md");
const originalB = makeFile("b/Note.md");
const olderB = makeConflictFile({
	folder: "b",
	date: "20210101",
	time: "000000",
	modifiedBy: "AAAAAAA",
});
const newerB = makeConflictFile({
	folder: "b",
	date: "20220101",
	time: "000000",
	modifiedBy: "BBBBBBB",
});
const lookalike = makeConflictFile({
	folder: "b",
	filename: "My Note",
	date: "20230101",
	time: "000000",
});
const unrelated = makeFile("b/Other.md");
const vault = [originalA, originalB, olderB, newerB, lookalike, unrelated];

describe("SyncthingController.getConflictsWithOriginal", () => {
	it("returns the original in the same folder and its conflicts for a conflict file", async () => {
		const { controller } = makeHarness(vault);

		const result = await controller.getConflictsWithOriginal(olderB);

		expect(result.originalFile).toBe(originalB);
		expect(result.conflicts).toEqual([olderB, newerB]);
	});

	it("returns only the conflicts of that exact path for a regular file", async () => {
		const { controller } = makeHarness(vault);

		expect(await controller.getConflictsWithOriginal(originalA)).toEqual({
			conflicts: [],
		});
		expect(await controller.getConflictsWithOriginal(originalB)).toEqual({
			conflicts: [olderB, newerB],
		});
	});

	it("leaves the original undefined when it does not exist", async () => {
		const { controller } = makeHarness([olderB]);

		const result = await controller.getConflictsWithOriginal(olderB);

		expect(result.originalFile).toBeUndefined();
		expect(result.conflicts).toEqual([olderB]);
	});
});

describe("SyncthingController.getConflicts", () => {
	it("groups conflicts by original path", async () => {
		const { controller } = makeHarness(vault);

		const { conflicts, unrecognised } = await controller.getConflicts();

		expect([...conflicts.keys()].sort()).toEqual([
			"b/My Note.md",
			"b/Note.md",
		]);
		expect(conflicts.get("b/Note.md")).toEqual([olderB, newerB]);
		expect(unrecognised).toEqual([]);
	});

	it("returns empty results when there is no conflict", async () => {
		const { controller } = makeHarness([originalA]);

		const { conflicts, unrecognised } = await controller.getConflicts();

		expect(conflicts.size).toBe(0);
		expect(unrecognised).toEqual([]);
	});

	it("returns files with unrecognised conflict names apart", async () => {
		const bad = makeFile("bad.sync-conflict-x.md");
		const { controller } = makeHarness([bad, olderB]);

		const { conflicts, unrecognised } = await controller.getConflicts();

		expect([...conflicts.keys()]).toEqual(["b/Note.md"]);
		expect(unrecognised).toEqual([bad]);
	});
});

describe("SyncthingController.getDiffFiles", () => {
	it("resolves the original file and the conflicting files from a conflict", async () => {
		const { controller } = makeHarness(vault);

		const result = await controller.getDiffFiles(olderB);

		expect(result.originalFile).toBe(originalB);
		expect(result.conflictingFiles).toEqual([newerB, olderB]);
		expect(result.conflictingFilesProperties.size).toBe(2);
	});

	it("resolves the conflicting files from the original", async () => {
		const { controller } = makeHarness(vault);

		const result = await controller.getDiffFiles(originalB);

		expect(result.originalFile).toBe(originalB);
		expect(result.conflictingFiles).toEqual([newerB, olderB]);
	});

	it("returns a Failure for a file without conflicts", async () => {
		const { controller } = makeHarness(vault);

		const result = await controller.getDiffFiles(originalA);

		expect(result.originalFile).toBe(originalA);
		expect(result.conflictingFiles).toBeInstanceOf(Failure);
	});

	it("returns a Failure instead of guessing when the original is missing", async () => {
		const { controller } = makeHarness([originalA, olderB]);

		const result = await controller.getDiffFiles(olderB);

		expect(result.conflictingFiles).toBeInstanceOf(MissingOriginalFailure);
		expect(
			(result.conflictingFiles as MissingOriginalFailure).originalPath,
		).toBe("b/Note.md");
	});
});

describe("SyncthingController.getAPIKey", () => {
	it("returns a Failure on mobile", async () => {
		Platform.isMobileApp = true;
		const { controller } = makeHarness();

		const result = await controller.getAPIKey();

		expect(result).toBeInstanceOf(Failure);
		expect((result as Failure).message).toContain("mobile");
	});

	it("returns the existing key without calling the CLI", async () => {
		const { controller, cli } = makeHarness([], { apiKey: "existing" });

		await expect(controller.getAPIKey()).resolves.toBe("existing");
		expect(cli.getAPIkey).not.toHaveBeenCalled();
	});

	it("asks the CLI and persists the key when none is set", async () => {
		const { controller, cli, plugin } = makeHarness([], { apiKey: "" });
		cli.getAPIkey.mockResolvedValue("new-key");

		await expect(controller.getAPIKey()).resolves.toBe("new-key");
		expect(plugin.apiKey).toBe("new-key");
		expect(plugin.setApiKey).toHaveBeenCalledWith("new-key");
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it("does not persist an empty key returned by the CLI", async () => {
		const { controller, cli, plugin } = makeHarness([], { apiKey: "" });
		cli.getAPIkey.mockResolvedValue("");

		await expect(controller.getAPIKey()).resolves.toBe("");
		expect(plugin.setApiKey).not.toHaveBeenCalled();
	});

	it("returns a CliFailure when the CLI throws", async () => {
		const { controller, cli } = makeHarness([], { apiKey: "" });
		cli.getAPIkey.mockRejectedValue(new Error("boom"));

		await expect(controller.getAPIKey()).resolves.toBeInstanceOf(CliFailure);
	});
});

describe("SyncthingController datasource delegation", () => {
	it("getDevices delegates to the REST datasource", async () => {
		const { controller, rest } = makeHarness();
		const devices = [{ deviceID: "A" }];
		rest.getDevices.mockResolvedValue(devices);

		await expect(controller.getDevices()).resolves.toBe(devices);
	});

	it("getFolders delegates to the REST datasource", async () => {
		const { controller, rest } = makeHarness();
		const folders = [{ id: "default" }];
		rest.getAllFolders.mockResolvedValue(folders);

		await expect(controller.getFolders()).resolves.toBe(folders);
	});

	it("startSyncthing delegates to the CLI datasource", async () => {
		const { controller, cli } = makeHarness();
		cli.startSyncthing.mockResolvedValue(true);

		await expect(controller.startSyncthing()).resolves.toBe(true);
	});

	it("stopSyncthing delegates to the CLI datasource", async () => {
		const { controller, cli } = makeHarness();
		cli.stopSyncthing.mockResolvedValue(true);

		await expect(controller.stopSyncthing()).resolves.toBe(true);
	});
});
