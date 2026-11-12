// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import type { SyncthingSettingTab } from "src/views/settings_tab";
import { Failure } from "src/models/failures";
import type { VaultFolder } from "src/controllers/vault_folder";
import type { SyncthingFolder } from "src/models/entities";
import SyncthingIgnoreFiles from "./syncthing_ignore_files.svelte";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

/** A Syncthing folder with only the fields the editor reads. */
const folder = (id: string, path: string) =>
	({ id, label: id, path, devices: [] }) as unknown as SyncthingFolder;

const ROOT_FOLDER: VaultFolder = {
	folder: folder("Vault", "/home/me/Vault"),
	vaultPath: "",
	chosen: false,
};

function setup(
	content: string | undefined,
	vaultFolder: VaultFolder | Failure | "loading" = ROOT_FOLDER,
) {
	const files = new Map<string, string>();
	if (content !== undefined) files.set(".stignore", content);
	const parent = {
		app: {
			vault: {
				configDir: ".obsidian",
				getAllLoadedFiles: () => [],
				adapter: {
					exists: vi.fn(async (path: string) => files.has(path)),
					read: vi.fn(async (path: string) => files.get(path) ?? ""),
					write: vi.fn(async (path: string, text: string) => {
						files.set(path, text);
					}),
				},
			},
		},
	} as unknown as SyncthingSettingTab;
	const view = render(SyncthingIgnoreFiles, {
		props: {
			parent,
			vaultFolder: vaultFolder === "loading" ? undefined : vaultFolder,
		},
	});
	return { files, ...view };
}

const button = (container: HTMLElement, text: string) =>
	Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;

describe("syncthing_ignore_files.svelte", () => {
	it("appends a typed pattern and keeps the file's line endings", async () => {
		const { container, files } = setup("!/keep.md\r\n*.md\r\n");
		await vi.waitFor(() => expect(container.textContent).toContain("*.md"));

		const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
		await fireEvent.input(input, { target: { value: " /drafts/ " } });
		await fireEvent.click(button(container, "Add pattern"));

		await vi.waitFor(() =>
			expect(files.get(".stignore")).toBe("!/keep.md\r\n*.md\r\n/drafts/\r\n"),
		);
	});

	it("adds the Obsidian template to a missing file once", async () => {
		const { container, files } = setup(undefined);
		await vi.waitFor(() => expect(button(container, "Add")).toBeTruthy());

		await fireEvent.click(button(container, "Add"));

		await vi.waitFor(() =>
			expect(files.get(".stignore")).toContain("/.obsidian/workspace.json\n"),
		);
		await vi.waitFor(() => expect(button(container, "Add").disabled).toBe(true));
	});

	it("removes one pattern and leaves comments alone", async () => {
		const { container, files } = setup("// mine\n/a\n/b\n");
		await vi.waitFor(() => expect(container.textContent).toContain("/b"));

		const remove = Array.from(container.querySelectorAll(".setting-item"))
			.find((item) => item.textContent?.includes("/a"))!
			.querySelector("button")!;
		await fireEvent.click(remove);

		await vi.waitFor(() => expect(files.get(".stignore")).toBe("// mine\n/b\n"));
	});

	it("does not edit the vault's .stignore when the folder starts above the vault", () => {
		const { container } = setup("", {
			folder: folder("Sync", "/home/me/Sync"),
			vaultPath: "Vault",
			chosen: false,
		});

		expect(container.textContent).toContain("outside the vault");
		expect(container.textContent).toContain("/Vault/");
		expect(button(container, "Add pattern")).toBeUndefined();
	});

	it("applies quick edits one after another, so none is lost", async () => {
		const { container, files } = setup("/a\n/b\n/c\n");
		await vi.waitFor(() => expect(container.textContent).toContain("/c"));
		const removeButton = (pattern: string) =>
			Array.from(container.querySelectorAll(".setting-item"))
				.find((item) => item.querySelector(".setting-item-name")?.textContent?.trim() === pattern)!
				.querySelector("button")!;

		await Promise.all([
			fireEvent.click(removeButton("/a")),
			fireEvent.click(removeButton("/b")),
		]);

		await vi.waitFor(() => expect(files.get(".stignore")).toBe("/c\n"));
	});

	it("waits for the folder before allowing edits", () => {
		const { container } = setup("", "loading");

		expect(container.textContent).toContain("Looking for the vault's Syncthing folder");
		expect(button(container, "Add pattern")).toBeUndefined();
	});

	it("warns when the vault's place in a chosen folder is unknown", () => {
		const { container } = setup("", { ...ROOT_FOLDER, vaultPath: undefined, chosen: true });

		expect(container.textContent).toContain("Where the vault is in the chosen folder is unknown");
	});

	it("says which .stignore it edits when the folder is unknown", () => {
		const { container } = setup("", new Failure("No Syncthing folder holds the vault."));

		expect(container.textContent).toMatch(/the one at the\s+vault's root/);
	});
});
