import { describe, expect, it } from "vitest";
import { App, Platform } from "obsidian";
import {
	CapacitorAdapter,
	FileSystemAdapter,
} from "../../test/mocks/obsidian";
import { type SyncthingFolder } from "src/models/entities";
import { Failure } from "src/models/failures";
import { findVaultFolder, vaultBasePath } from "./vault_folder";

const folder = (id: string, path: string) =>
	({ id, label: id, path, devices: [] }) as unknown as SyncthingFolder;

const FOLDERS = [
	folder("home", "~/"),
	folder("sync", "~/Sync"),
	folder("vault", "/home/me/Sync/Vault/"),
	folder("other", "/home/me/Sync/Vault-old"),
];

describe("findVaultFolder", () => {
	it("finds the folder whose path is the vault's", () => {
		expect(findVaultFolder(FOLDERS, "/home/me/Sync/Vault", "", "/home/me")).toEqual({
			folder: FOLDERS[2],
			vaultPath: "",
			chosen: false,
		});
	});

	it("finds the deepest folder that holds the vault, expanding ~", () => {
		expect(
			findVaultFolder(FOLDERS.slice(0, 2), "/home/me/Sync/Notes/Vault", "", "/home/me"),
		).toEqual({ folder: FOLDERS[1], vaultPath: "Notes/Vault", chosen: false });
	});

	it("does not match a folder that only shares a name prefix", () => {
		const result = findVaultFolder([FOLDERS[3]], "/home/me/Sync/Vault", "", "/home/me");

		expect(result).toBeInstanceOf(Failure);
		expect((result as Failure).message).toContain("No Syncthing folder holds the vault");
	});

	it("compares Windows paths without case and with either separator", () => {
		Platform.isWin = true;
		const windows = folder("w", "C:\\Users\\Me\\Vault");

		expect(findVaultFolder([windows], "c:/users/me/vault/", "", undefined)).toMatchObject({
			folder: windows,
			vaultPath: "",
		});
	});

	it("compares case on Linux", () => {
		const result = findVaultFolder([folder("v", "/home/me/vault")], "/home/me/Vault", "", undefined);

		expect(result).toBeInstanceOf(Failure);
	});

	it("uses the folder chosen for this device, even without the vault's path", () => {
		expect(findVaultFolder(FOLDERS, undefined, "sync", undefined)).toEqual({
			folder: FOLDERS[1],
			vaultPath: "",
			chosen: true,
		});
	});

	it("says when the chosen folder no longer exists", () => {
		const result = findVaultFolder(FOLDERS, "/home/me/Sync/Vault", "gone", "/home/me");

		expect((result as Failure).message).toContain("no folder with the ID gone");
	});

	it("asks to choose a folder when the vault's path is unknown", () => {
		const result = findVaultFolder(FOLDERS, undefined, "", undefined);

		expect((result as Failure).message).toContain("Choose its Syncthing folder");
	});
});

describe("vaultBasePath", () => {
	it("reads the path from the desktop and mobile adapters", () => {
		const app = new App();
		Object.assign(app.vault, { adapter: new FileSystemAdapter("/home/me/Vault") });
		expect(vaultBasePath(app as never)).toBe("/home/me/Vault");

		Object.assign(app.vault, { adapter: new CapacitorAdapter("/storage/emulated/0/Vault") });
		expect(vaultBasePath(app as never)).toBe("/storage/emulated/0/Vault/");
	});

	it("is unknown for another adapter", () => {
		expect(vaultBasePath(new App() as never)).toBeUndefined();
	});
});
