// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import type { TFile } from "obsidian";
import type { DiffModal } from "src/views/diff_modal";
import { makeFile } from "../../test/helpers/files";
import { makeMemoryVault } from "../../test/helpers/vault";
import DiffView from "./diff_view.svelte";

afterEach(cleanup);

const ORIGINAL = "b/Note.md";
const OLDER = "b/Note.sync-conflict-20210101-000000-AAAAAAA.md";
const NEWER = "b/Note.sync-conflict-20220101-000000-BBBBBBB.md";

function setup(contents: Record<string, string>, conflicts: string[]) {
	const memory = makeMemoryVault(contents);
	const modal = {
		app: memory.app,
		titleEl: document.createElement("div"),
		originalFile: memory.file(ORIGINAL),
		conflictingFiles: conflicts.map((path) => memory.file(path)),
		close: vi.fn(),
	} as unknown as DiffModal;
	const view = render(DiffView, { props: { parentModal: modal } });
	const button = (text: string) =>
		Array.from(view.container.querySelectorAll("button")).find((b) =>
			b.textContent?.includes(text),
		) as HTMLButtonElement;
	return { memory, modal, view, button };
}

describe("diff_view.svelte", () => {
	it("previews both files without running their HTML", async () => {
		const original = makeFile("Note.md");
		const conflict = makeFile(
			"Note.sync-conflict-20210930-123456-ABCDEFG.md",
		);
		const contents = new Map<TFile, string>([
			[original, 'Original <img src=x onerror="alert(1)">'],
			[
				conflict,
				"Remote <script>alert(2)</script><iframe src=https://example.com></iframe>",
			],
		]);
		const read = vi.fn(async (file: TFile) => contents.get(file) ?? "");
		const { container, findAllByText } = render(DiffView, {
			props: {
				parentModal: {
					app: { vault: { read, cachedRead: read } },
					titleEl: document.createElement("div"),
					originalFile: original,
					conflictingFiles: [conflict],
				} as unknown as DiffModal,
			},
		});

		await findAllByText(/Remote/);
		const previews = container.querySelectorAll(".preview");
		expect(previews).toHaveLength(2);
		expect(previews[0].textContent).toContain("Original");
		expect(previews[1].textContent).toContain("Remote");
		expect(
			container.querySelector(
				".preview img, .preview script, .preview iframe",
			),
		).toBeNull();
	});

	it("keeps the original by trashing the conflict, then shows the next one", async () => {
		const { memory, modal, view, button } = setup(
			{ [ORIGINAL]: "local", [NEWER]: "newer", [OLDER]: "older" },
			[NEWER, OLDER],
		);
		await view.findAllByText(/newer/);

		await fireEvent.click(button("Accept original"));

		await waitFor(() =>
			expect(modal.conflictingFiles.map((file) => file.path)).toEqual([
				OLDER,
			]),
		);
		expect(memory.trashed).toEqual([{ path: NEWER, content: "newer" }]);
		expect(memory.content(ORIGINAL)).toBe("local");
		await view.findAllByText(/older/);
		expect(modal.close).not.toHaveBeenCalled();
	});

	it("keeps the conflict by trashing the original and closes when none are left", async () => {
		const { memory, modal, view, button } = setup(
			{ [ORIGINAL]: "local", [NEWER]: "newer" },
			[NEWER],
		);
		await view.findAllByText(/newer/);

		await fireEvent.click(button("Accept conflict"));

		await waitFor(() => expect(modal.close).toHaveBeenCalled());
		expect(memory.content(ORIGINAL)).toBe("newer");
		expect(memory.content(NEWER)).toBeUndefined();
		expect(memory.trashed).toEqual([{ path: ORIGINAL, content: "local" }]);
		expect(memory.app.vault.delete).not.toHaveBeenCalled();
	});

	it("keeps both files and the conflict listed when resolving fails", async () => {
		const { memory, modal, view, button } = setup(
			{ [ORIGINAL]: "local", [NEWER]: "newer" },
			[NEWER],
		);
		memory.app.vault.trash = async () => {
			throw new Error("trash unavailable");
		};
		vi.spyOn(console, "error").mockImplementation(() => {});
		await view.findAllByText(/newer/);

		await fireEvent.click(button("Accept conflict"));

		await waitFor(() => expect(console.error).toHaveBeenCalled());
		expect(memory.content(ORIGINAL)).toBe("local");
		expect(memory.content(NEWER)).toBe("newer");
		expect(modal.conflictingFiles).toHaveLength(1);
		expect(modal.close).not.toHaveBeenCalled();
	});
});
