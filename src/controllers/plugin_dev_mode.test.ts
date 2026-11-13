import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import type SyncthingPlugin from "src/main";
import { makeMemoryVault } from "../../test/helpers/vault";
import type { Notice as MockNotice } from "../../test/mocks/obsidian";
import { PluginDevModeController } from "./plugin_dev_mode";

vi.mock("lorem-ipsum", () => ({ loremIpsum: () => "lorem" }));
vi.mock("@js-random/date", () => ({ default: () => new Date(Date.UTC(2023, 0, 1, 12)) }));

const conflict = /^(lorem( \d+)?)\.sync-conflict-20230101-120000-[A-Z2-7]{7}\.md$/;

function controller(contents: Record<string, string> = {}) {
	const memory = makeMemoryVault(contents);
	const plugin = { app: memory.app } as unknown as SyncthingPlugin;
	return { memory, dev: new PluginDevModeController(plugin) };
}

const notices = () => (Notice as unknown as typeof MockNotice).instances;
const messages = () => notices().map(({ message }) => message);

const paths = (memory: ReturnType<typeof makeMemoryVault>) =>
	memory.app.vault.getFiles().map((file) => file.path);

describe("PluginDevModeController.generateSyncthingConflicts", () => {
	beforeEach(() => {
		notices().length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("gives files that draw a taken name a free one, ignoring case and counting old conflicts", async () => {
		const orphan = "lorem 1.sync-conflict-20200101-000000-AAAAAAA.md";
		const { memory, dev } = controller({ "Lorem.md": "taken", [orphan]: "old" });

		await dev.generateSyncthingConflicts(2, 2);

		const created = paths(memory).slice(2);
		expect(created.filter((path) => !conflict.test(path))).toEqual(["lorem 2.md", "lorem 3.md"]);
		expect(created.filter((path) => conflict.test(path)).map((path) => path.match(conflict)?.[1])).toEqual([
			"lorem 2",
			"lorem 2",
			"lorem 3",
			"lorem 3",
		]);
		expect(memory.content("Lorem.md")).toBe("taken");
		expect(messages()).not.toContainEqual(expect.stringContaining("stopped"));
	});

	it("draws a new device ID when a conflict name is taken, keeping Syncthing's format", async () => {
		const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
		for (let i = 0; i < 14; i++) random.mockReturnValueOnce(0);
		const { memory, dev } = controller();

		await dev.generateSyncthingConflicts(1, 2);

		expect(paths(memory)).toEqual([
			"lorem.md",
			"lorem.sync-conflict-20230101-120000-AAAAAAA.md",
			"lorem.sync-conflict-20230101-120000-QQQQQQQ.md",
		]);
	});

	it("stops with a notice saying how far it got, and hides the progress", async () => {
		const { memory, dev } = controller();
		const create = vi.mocked(memory.app.vault.create);
		create.mockImplementationOnce(create.getMockImplementation()!);
		create.mockRejectedValueOnce(new Error("Disk full"));
		const hide = vi.spyOn(Notice.prototype, "hide");

		await dev.generateSyncthingConflicts(2, 2);

		expect(paths(memory)).toEqual(["lorem.md"]);
		expect(messages()).toContain("Generating conflicts stopped after 1 of 6 files: Disk full");
		expect(hide).toHaveBeenCalledTimes(2);
	});
});
