// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import type { TFile } from "obsidian";
import type { DiffModal } from "src/views/diff_modal";
import { makeFile } from "../../test/helpers/files";
import { makeMemoryVault, trashedText } from "../../test/helpers/vault";
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
	const ready = () =>
		waitFor(() => expect(button("Accept original").disabled).toBe(false));
	return { memory, modal, view, button, ready };
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
		const { memory, modal, view, button, ready } = setup(
			{ [ORIGINAL]: "local", [NEWER]: "newer", [OLDER]: "older" },
			[NEWER, OLDER],
		);
		await ready();

		await fireEvent.click(button("Accept original"));

		await waitFor(() =>
			expect(modal.conflictingFiles.map((file) => file.path)).toEqual([
				OLDER,
			]),
		);
		expect(trashedText(memory)).toEqual([{ path: NEWER, content: "newer" }]);
		expect(memory.content(ORIGINAL)).toBe("local");
		await view.findAllByText(/older/);
		expect(modal.close).not.toHaveBeenCalled();
	});

	it("keeps the conflict's content, trashing the old version, and closes when none are left", async () => {
		const { memory, modal, button, ready } = setup(
			{ [ORIGINAL]: "local", [NEWER]: "newer" },
			[NEWER],
		);
		await ready();

		await fireEvent.click(button("Accept conflict"));

		await waitFor(() => expect(modal.close).toHaveBeenCalled());
		expect(memory.content(ORIGINAL)).toBe("newer");
		expect(memory.content(NEWER)).toBeUndefined();
		expect(memory.trashed.map((entry) => entry.content)).toEqual([
			"local",
			"newer",
		]);
		expect(memory.app.vault.delete).not.toHaveBeenCalled();
	});

	it("closes with a notice when the next conflict cannot be read", async () => {
		const { memory, modal, button, ready } = setup(
			{ [ORIGINAL]: "local", [NEWER]: "newer", [OLDER]: "older" },
			[NEWER, OLDER],
		);
		vi.spyOn(console, "error").mockImplementation(() => {});
		await ready();
		const read = memory.app.vault.read;
		memory.app.vault.read = async (file) => {
			if (file.path === OLDER) throw new Error("gone");
			return read(file);
		};

		await fireEvent.click(button("Accept original"));

		await waitFor(() => expect(modal.close).toHaveBeenCalled());
		expect(console.error).toHaveBeenCalled();
	});

	it("ignores actions until the selected conflict's diff is shown", async () => {
		const { memory, view, button } = setup(
			{ [ORIGINAL]: "local", [NEWER]: "newer" },
			[NEWER],
		);

		await fireEvent.click(button("Accept original"));
		expect(memory.trashed).toEqual([]);

		await view.findAllByText(/newer/);
		await waitFor(() =>
			expect(button("Accept original").disabled).toBe(false),
		);
	});

	it("shows the files as they are after a partial failure", async () => {
		const { memory, button, ready, view } = setup(
			{ [ORIGINAL]: "local", [NEWER]: "newer" },
			[NEWER],
		);
		memory.app.vault.trash = async () => {
			throw new Error("trash unavailable");
		};
		vi.spyOn(console, "error").mockImplementation(() => {});
		await ready();

		await fireEvent.click(button("Accept conflict"));

		await waitFor(() =>
			expect(
				view.container.querySelectorAll(".preview")[0]?.textContent,
			).toContain("newer"),
		);
		expect(memory.content(ORIGINAL)).toBe("newer");
	});

	it("ignores a second click while a resolution is running", async () => {
		const { memory, button, ready } = setup(
			{ [ORIGINAL]: "local", [NEWER]: "newer", [OLDER]: "older" },
			[NEWER, OLDER],
		);
		await ready();

		await Promise.all([
			fireEvent.click(button("Accept original")),
			fireEvent.click(button("Accept original")),
		]);

		await waitFor(() => expect(memory.trashed).toHaveLength(1));
		expect(memory.app.vault.trash).toHaveBeenCalledTimes(1);
		expect(memory.content(OLDER)).toBe("older");
	});

	it("keeps both files and the conflict listed when resolving fails", async () => {
		const { memory, modal, button, ready } = setup(
			{ [ORIGINAL]: "local", [NEWER]: "newer" },
			[NEWER],
		);
		memory.app.vault.adapter.trashSystem = async () => {
			throw new Error("trash unavailable");
		};
		vi.spyOn(console, "error").mockImplementation(() => {});
		await ready();

		await fireEvent.click(button("Accept conflict"));

		await waitFor(() => expect(console.error).toHaveBeenCalled());
		expect(memory.content(ORIGINAL)).toBe("local");
		expect(memory.content(NEWER)).toBe("newer");
		expect(modal.conflictingFiles).toHaveLength(1);
		expect(modal.close).not.toHaveBeenCalled();
	});
});
