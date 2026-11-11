// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { SyncthingController } from "src/controllers/main_controller";
import { MissingOriginalFailure } from "src/models/failures";
import { makeMemoryVault } from "../../test/helpers/vault";
import { DiffModal } from "./diff_modal";

const ORIGINAL = "b/Note.md";
const CONFLICT = "b/Note.sync-conflict-20220101-000000-BBBBBBB.md";

async function openOrphan(contents: Record<string, string>) {
	const memory = makeMemoryVault(contents);
	const conflict = memory.file(CONFLICT);
	const controller = {
		getDiffFiles: vi.fn(async () => ({
			originalFile: conflict,
			conflictingFiles: new MissingOriginalFailure(ORIGINAL),
			conflictingFilesProperties: new Map(),
		})),
	} as unknown as SyncthingController;
	const modal = new DiffModal(memory.app, conflict, controller);
	const close = vi.spyOn(modal, "close");
	await modal.onOpen();
	const button = (text: string) =>
		Array.from(modal.contentEl.querySelectorAll("button")).find(
			(b) => b.textContent === text,
		) as HTMLButtonElement;
	return { memory, modal, close, button };
}

describe("DiffModal with a missing original", () => {
	it("explains the situation and offers to restore or trash", async () => {
		const { modal, button } = await openOrphan({ [CONFLICT]: "remote" });

		expect(modal.contentEl.textContent).toContain(
			`${ORIGINAL} no longer exists`,
		);
		expect(button("Restore as original")).toBeDefined();
		expect(button("Move to trash")).toBeDefined();
	});

	it("restores the conflict as the original", async () => {
		const { memory, close, button } = await openOrphan({
			[CONFLICT]: "remote",
		});

		button("Restore as original").click();

		await vi.waitFor(() => expect(close).toHaveBeenCalled());
		expect(memory.content(ORIGINAL)).toBe("remote");
		expect(memory.content(CONFLICT)).toBeUndefined();
	});

	it("moves the conflict to the trash", async () => {
		const { memory, close, button } = await openOrphan({
			[CONFLICT]: "remote",
		});

		button("Move to trash").click();

		await vi.waitFor(() => expect(close).toHaveBeenCalled());
		expect(memory.trashed).toEqual([{ path: CONFLICT, content: "remote" }]);
	});
});
