// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { App } from "obsidian";
import type { MergeModal } from "src/views/merge_editor";
import { makeFile } from "../../test/helpers/files";
import MergeEditor from "./merge_editor.svelte";

afterEach(cleanup);

function parentModal(): MergeModal {
	return {
		app: new App(),
		originalFile: makeFile("Note.md"),
		modifiedFile: makeFile("Note.sync-conflict-20210930-123456-ABCDEFG.md"),
		close: () => undefined,
	} as unknown as MergeModal;
}

describe("merge_editor.svelte", () => {
	it("previews the merge without running its HTML", () => {
		const { container } = render(MergeEditor, {
			props: {
				parentModal: parentModal(),
				originalContent: 'Hello <img src=x onerror="alert(1)"><script>alert(2)</script>',
				modifiedContent: "Hello",
			},
		});

		const preview = container.querySelector(".preview");
		expect(preview?.textContent).toContain("Hello");
		expect(preview?.querySelector("img, script")).toBeNull();
	});
});
