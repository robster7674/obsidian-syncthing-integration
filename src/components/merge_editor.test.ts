// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { EditorView } from "@codemirror/view";
import { App } from "obsidian";
import type { MergeModal } from "src/views/merge_editor";
import { makeFile } from "../../test/helpers/files";
import MergeEditor from "./merge_editor.svelte";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function parentModal(): MergeModal {
	return {
		app: new App(),
		originalFile: makeFile("Note.md"),
		modifiedFile: makeFile("Note.sync-conflict-20210930-123456-ABCDEFG.md"),
		close: () => undefined,
	} as unknown as MergeModal;
}

function renderEditor(originalContent: string, modifiedContent = "Hello") {
	const { container } = render(MergeEditor, {
		props: { parentModal: parentModal(), originalContent, modifiedContent },
	});
	const editors = container.querySelectorAll<HTMLElement>(".cm-editor");
	return {
		preview: container.querySelector(".preview") as HTMLElement,
		editorA: EditorView.findFromDOM(editors[0]) as EditorView,
	};
}

describe("merge_editor.svelte", () => {
	it("previews the merge without running its HTML", () => {
		const { preview } = renderEditor(
			'Hello <img src=x onerror="alert(1)"><script>alert(2)</script>',
		);

		expect(preview.textContent).toContain("Hello");
		expect(preview.querySelector("img, script")).toBeNull();
	});

	it("updates the preview once editing pauses", async () => {
		vi.useFakeTimers();
		const { preview, editorA } = renderEditor("Hello");

		editorA.dispatch({
			changes: { from: 0, to: editorA.state.doc.length, insert: "Edited" },
		});
		await vi.advanceTimersByTimeAsync(100);
		expect(preview.textContent).toContain("Hello");

		await vi.advanceTimersByTimeAsync(300);
		expect(preview.textContent).toContain("Edited");
	});
});
