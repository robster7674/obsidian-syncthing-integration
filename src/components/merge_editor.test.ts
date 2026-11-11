// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { EditorView } from "@codemirror/view";
import { App } from "obsidian";
import { ConfirmModal } from "src/views/confirm_modal";
import type { MergeModal } from "src/views/merge_editor";
import { makeFile } from "../../test/helpers/files";
import { makeMemoryVault, type MemoryVault, trashedText } from "../../test/helpers/vault";
import MergeEditor from "./merge_editor.svelte";

vi.mock("src/views/confirm_modal", () => ({
	ConfirmModal: vi.fn(function (
		this: { open: () => void },
		_app: unknown,
		_message: string,
		_callback: () => void,
	) {
		this.open = vi.fn();
	}),
}));

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const ORIGINAL = "Note.md";
const CONFLICT = "Note.sync-conflict-20210930-123456-ABCDEFG.md";

function parentModal(app: App = new App()): MergeModal {
	return {
		app,
		originalFile: makeFile(ORIGINAL),
		modifiedFile: makeFile(CONFLICT),
		close: vi.fn(),
		onResolved: vi.fn(),
	} as unknown as MergeModal;
}

function renderEditor(
	originalContent: string,
	modifiedContent: string,
	modal: MergeModal = parentModal(),
) {
	const { container } = render(MergeEditor, {
		props: { parentModal: modal, originalContent, modifiedContent },
	});
	const editors = container.querySelectorAll<HTMLElement>(".cm-editor");
	const save = Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent === "Save merged file",
	) as HTMLButtonElement;
	return {
		preview: container.querySelector(".preview") as HTMLElement,
		editorA: EditorView.findFromDOM(editors[0]) as EditorView,
		save,
	};
}

function vaultModal(original: string, conflict: string) {
	const memory: MemoryVault = makeMemoryVault({
		[ORIGINAL]: original,
		[CONFLICT]: conflict,
	});
	const modal = {
		...parentModal(memory.app),
		originalFile: memory.file(ORIGINAL),
		modifiedFile: memory.file(CONFLICT),
	} as unknown as MergeModal;
	return { memory, modal };
}

describe("merge_editor.svelte", () => {
	it("previews the merge without running its HTML", () => {
		const { preview } = renderEditor(
			'Hello <img src=x onerror="alert(1)"><script>alert(2)</script>',
			"Hello",
		);

		expect(preview.textContent).toContain("Hello");
		expect(preview.querySelector("img, script")).toBeNull();
	});

	it("updates the preview at most every 250 ms while editing", async () => {
		vi.useFakeTimers();
		const { preview, editorA } = renderEditor("Hello", "Hello");

		editorA.dispatch({
			changes: { from: 0, to: editorA.state.doc.length, insert: "Edited" },
		});
		await vi.advanceTimersByTimeAsync(100);
		expect(preview.textContent).toContain("Hello");

		await vi.advanceTimersByTimeAsync(300);
		expect(preview.textContent).toContain("Edited");
	});

	it("saves an unedited merge without asking", async () => {
		const { memory, modal } = vaultModal("same", "same");
		const { save } = renderEditor("same", "same", modal);

		await fireEvent.click(save);

		await waitFor(() => expect(modal.onResolved).toHaveBeenCalled());
		expect(memory.content(ORIGINAL)).toBe("same");
		expect(trashedText(memory)).toEqual([{ path: CONFLICT, content: "same" }]);
		expect(modal.close).toHaveBeenCalled();
	});

	it("saves the left side when confirmed with unresolved differences", async () => {
		const { memory, modal } = vaultModal("local", "remote");
		const { save, editorA } = renderEditor("local", "remote", modal);
		editorA.dispatch({
			changes: { from: 0, to: editorA.state.doc.length, insert: "merged" },
		});

		await fireEvent.click(save);
		expect(ConfirmModal).toHaveBeenCalled();
		expect(memory.content(CONFLICT)).toBe("remote");

		const confirm = vi.mocked(ConfirmModal).mock.calls[0][2];
		confirm();

		await waitFor(() => expect(modal.onResolved).toHaveBeenCalled());
		expect(memory.content(ORIGINAL)).toBe("merged");
		expect(memory.trashed.map((entry) => entry.content)).toEqual([
			"local",
			"remote",
		]);
	});

	it("ignores a second save while one is running", async () => {
		const { memory, modal } = vaultModal("same", "same");
		const { save } = renderEditor("same", "same", modal);

		await Promise.all([fireEvent.click(save), fireEvent.click(save)]);

		await waitFor(() => expect(modal.onResolved).toHaveBeenCalledTimes(1));
		expect(memory.app.vault.trash).toHaveBeenCalledTimes(1);
		expect(memory.trashed).toHaveLength(1);
	});

	it("keeps CRLF line endings, so an unedited save changes nothing", async () => {
		const { memory, modal } = vaultModal("a\r\nb\r\n", "a\r\nc\r\n");
		const { save } = renderEditor("a\r\nb\r\n", "a\r\nc\r\n", modal);

		await fireEvent.click(save);
		vi.mocked(ConfirmModal).mock.calls[0][2]();

		await waitFor(() => expect(modal.onResolved).toHaveBeenCalled());
		expect(memory.content(ORIGINAL)).toBe("a\r\nb\r\n");
		expect(trashedText(memory)).toEqual([
			{ path: CONFLICT, content: "a\r\nc\r\n" },
		]);
	});

	it("refuses to overwrite changes synced while merging", async () => {
		const { memory, modal } = vaultModal("v1", "remote");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { save, editorA } = renderEditor("v1", "remote", modal);
		editorA.dispatch({
			changes: { from: 0, to: editorA.state.doc.length, insert: "merged" },
		});
		await memory.app.vault.modify(memory.file(ORIGINAL), "v2");

		await fireEvent.click(save);
		vi.mocked(ConfirmModal).mock.calls[0][2]();

		await waitFor(() => expect(console.error).toHaveBeenCalled());
		expect(memory.content(ORIGINAL)).toBe("v2");
		expect(memory.content(CONFLICT)).toBe("remote");
		expect(modal.onResolved).not.toHaveBeenCalled();
	});

	it("ignores a stacked confirmation once the merge is saved", async () => {
		const { memory, modal } = vaultModal("local", "remote");
		const { save } = renderEditor("local", "remote", modal);

		await fireEvent.click(save);
		await fireEvent.click(save);
		const [first, second] = vi.mocked(ConfirmModal).mock.calls;
		first[2]();
		await waitFor(() => expect(modal.onResolved).toHaveBeenCalled());
		second[2]();

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(modal.onResolved).toHaveBeenCalledTimes(1);
		expect(memory.app.vault.trash).toHaveBeenCalledTimes(1);
	});

	it("keeps both files and the editor open when saving fails", async () => {
		const { memory, modal } = vaultModal("same", "same");
		memory.app.vault.trash = async () => {
			throw new Error("trash unavailable");
		};
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { save } = renderEditor("same", "same", modal);
		expect(memory.content(ORIGINAL)).toBe("same");

		await fireEvent.click(save);

		await waitFor(() => expect(console.error).toHaveBeenCalled());
		expect(memory.content(CONFLICT)).toBe("same");
		expect(modal.close).not.toHaveBeenCalled();
		expect(modal.onResolved).not.toHaveBeenCalled();
	});
});
