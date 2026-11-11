/**
 * An in-memory Obsidian vault for tests of code that reads, writes, renames
 * and trashes files. Trashed files keep their content in `trashed`.
 */
import { vi } from "vitest";
import { type App, type TFile } from "obsidian";
import { makeFile } from "./files";

export interface MemoryVault {
	app: App;
	files: Map<string, { file: TFile; content: string }>;
	trashed: { path: string; content: string }[];
	file(path: string): TFile;
	content(path: string): string | undefined;
}

export function makeMemoryVault(contents: Record<string, string>): MemoryVault {
	const files = new Map<string, { file: TFile; content: string }>();
	const trashed: { path: string; content: string }[] = [];
	const add = (path: string, content: string): TFile => {
		const file = makeFile(path);
		files.set(path, { file, content });
		return file;
	};
	for (const [path, content] of Object.entries(contents)) add(path, content);

	const entry = (file: TFile) => {
		const found = files.get(file.path);
		if (!found || found.file !== file) {
			throw new Error(`${file.path} does not exist`);
		}
		return found;
	};

	const vault = {
		getFiles: vi.fn(() => [...files.values()].map(({ file }) => file)),
		getAbstractFileByPath: vi.fn(
			(path: string) => files.get(path)?.file ?? null,
		),
		read: vi.fn(async (file: TFile) => entry(file).content),
		cachedRead: vi.fn(async (file: TFile) => entry(file).content),
		create: vi.fn(async (path: string, content: string) => {
			if (files.has(path)) throw new Error(`${path} already exists`);
			return add(path, content);
		}),
		modify: vi.fn(async (file: TFile, content: string) => {
			entry(file).content = content;
		}),
		trash: vi.fn(async (file: TFile, _system: boolean) => {
			const { content } = entry(file);
			files.delete(file.path);
			trashed.push({ path: file.path, content });
		}),
		delete: vi.fn(async () => {
			throw new Error("Permanent deletion is not allowed");
		}),
	};
	const fileManager = {
		renameFile: vi.fn(async (file: TFile, newPath: string) => {
			const { content } = entry(file);
			if (files.has(newPath)) throw new Error(`${newPath} already exists`);
			files.delete(file.path);
			const renamed = makeFile(newPath);
			Object.assign(file, {
				path: renamed.path,
				name: renamed.name,
				basename: renamed.basename,
				extension: renamed.extension,
			});
			files.set(newPath, { file, content });
		}),
	};

	return {
		app: { vault, fileManager } as unknown as App,
		files,
		trashed,
		file: (path) => {
			const found = files.get(path);
			if (!found) throw new Error(`${path} does not exist`);
			return found.file;
		},
		content: (path) => files.get(path)?.content,
	};
}
