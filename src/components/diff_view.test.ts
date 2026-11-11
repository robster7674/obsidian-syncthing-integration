// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import type { TFile } from "obsidian";
import type { DiffModal } from "src/views/diff_modal";
import { makeFile } from "../../test/helpers/files";
import DiffView from "./diff_view.svelte";

afterEach(cleanup);

function parentModal(contents: Map<TFile, string>): DiffModal {
	const [originalFile, ...conflictingFiles] = Array.from(contents.keys());
	const read = vi.fn(async (file: TFile) => contents.get(file) ?? "");
	return {
		app: { vault: { read, cachedRead: read } },
		titleEl: document.createElement("div"),
		originalFile,
		conflictingFiles,
	} as unknown as DiffModal;
}

describe("diff_view.svelte", () => {
	it("previews both files without running their HTML", async () => {
		const original = makeFile("Note.md");
		const conflict = makeFile(
			"Note.sync-conflict-20210930-123456-ABCDEFG.md",
		);
		const { container, findAllByText } = render(DiffView, {
			props: {
				parentModal: parentModal(
					new Map([
						[original, 'Original <img src=x onerror="alert(1)">'],
						[
							conflict,
							"Remote <script>alert(2)</script><iframe src=https://example.com></iframe>",
						],
					]),
				),
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
});
