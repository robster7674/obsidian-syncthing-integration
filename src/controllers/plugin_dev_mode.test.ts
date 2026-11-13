import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import type SyncthingPlugin from "src/main";
import { makeMemoryVault } from "../../test/helpers/vault";
import type { Notice as MockNotice } from "../../test/mocks/obsidian";
import { PluginDevModeController } from "./plugin_dev_mode";

vi.mock("lorem-ipsum", () => ({ loremIpsum: () => "lorem" }));

const conflict = /^lorem( \d+)?\.sync-conflict-\d{8}-\d{6}-[A-Z2-7]{7}\.md$/;

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

	it("gives files that draw the same random name a free one", async () => {
		const { memory, dev } = controller({ "lorem.md": "taken" });

		await dev.generateSyncthingConflicts(2, 2);

		const created = paths(memory);
		expect(created.filter((path) => !conflict.test(path))).toEqual([
			"lorem.md",
			"lorem 1.md",
			"lorem 2.md",
		]);
		expect(created.filter((path) => conflict.test(path))).toHaveLength(4);
		expect(memory.content("lorem.md")).toBe("taken");
		expect(messages()).not.toContainEqual(
			expect.stringContaining("stopped"),
		);
	});

	it("stops with a notice when a file can't be created, and hides the progress", async () => {
		const { memory, dev } = controller();
		vi.mocked(memory.app.vault.create).mockRejectedValueOnce(new Error("Disk full"));
		const hide = vi.spyOn(Notice.prototype, "hide");

		await dev.generateSyncthingConflicts(2, 2);

		expect(paths(memory)).toEqual([]);
		expect(messages()).toContain(
			"Generating conflicts stopped: Disk full",
		);
		expect(hide).toHaveBeenCalledTimes(2);
	});
});
