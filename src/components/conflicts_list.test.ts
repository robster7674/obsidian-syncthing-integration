// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import type { TFile } from "obsidian";
import type { ConflictsModal } from "src/views/conflicts_modal";
import { makeConflictFile, makeFile } from "../../test/helpers/files";
import ConflictsList from "./conflicts_list.svelte";

const LEVELS = ["log", "debug", "info", "warn"] as const;
let logged: () => unknown[][];
beforeEach(() => {
	const spies = LEVELS.map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
	logged = () => spies.flatMap((spy) => spy.mock.calls);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const parentModal = {
	app: {},
	titleEl: document.createElement("div"),
	syncthingController: {},
} as unknown as ConflictsModal;

describe("conflicts_list.svelte", () => {
	it("lists conflicts by original path and warns about unrecognised names", () => {
		const { container } = render(ConflictsList, {
			props: {
				parentModal,
				conflicts: new Map([
					["a/Note.md", [makeConflictFile({ folder: "a" })]],
					["b/Note.md", [makeConflictFile({ folder: "b" })]],
				]),
				unrecognised: [makeFile("c/odd.sync-conflict-x.md")],
			},
		});

		expect(container.textContent).toContain("a/Note.md");
		expect(container.textContent).toContain("b/Note.md");
		expect(container.querySelector(".callout")?.textContent).toContain(
			"c/odd.sync-conflict-x.md",
		);
		expect(logged()).toEqual([]);
	});

	it("shows no warning when every name is recognised", () => {
		const { container } = render(ConflictsList, {
			props: { parentModal, conflicts: new Map<string, TFile[]>() },
		});

		expect(container.textContent).toContain("No conflicts found.");
		expect(container.querySelector(".callout")).toBeNull();
		expect(logged()).toEqual([]);
	});
});
