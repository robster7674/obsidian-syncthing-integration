/**
 * An in-memory Obsidian vault for tests of code that reads, writes, renames
 * and trashes files. Content is kept as bytes, so binary files survive
 * exactly; trashed files keep their content in `trashed`.
 */
import { vi } from "vitest";
import { type App, type TFile } from "obsidian";
import { makeFile } from "./files";

export interface TrashedFile {
	path: string;
	/** The content decoded as UTF-8. */
	content: string;
	bytes: Uint8Array;
}

export interface MemoryVault {
	app: App;
	/** Everything moved to the trash, through the vault or the adapter. */
	trashed: TrashedFile[];
	/** Files written through the adapter, outside the vault index. */
	hidden: Map<string, Uint8Array>;
	/** Modification times of `hidden` files. */
	mtimes: Map<string, number>;
	file(path: string): TFile;
	content(path: string): string | undefined;
	bytes(path: string): Uint8Array | undefined;
}

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const copy = (data: ArrayBuffer | Uint8Array) =>
	new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
const buffer = (bytes: Uint8Array) =>
	bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;

export function makeMemoryVault(
	contents: Record<string, string | Uint8Array>,
): MemoryVault {
	const files = new Map<string, { file: TFile; bytes: Uint8Array }>();
	const trashed: TrashedFile[] = [];
	const hidden = new Map<string, Uint8Array>();
	/** Modification times of hidden files, 0 unless a test sets one. */
	const mtimes = new Map<string, number>();
	const trash = (path: string, bytes: Uint8Array) =>
		trashed.push({ path, content: decode(bytes), bytes });
	const takeHidden = (path: string) => {
		const bytes = hidden.get(path);
		if (bytes === undefined) throw new Error(`${path} does not exist`);
		hidden.delete(path);
		return bytes;
	};
	const add = (path: string, bytes: Uint8Array): TFile => {
		const file = makeFile(path);
		files.set(path, { file, bytes });
		return file;
	};
	for (const [path, content] of Object.entries(contents)) {
		add(path, typeof content === "string" ? encode(content) : copy(content));
	}

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
		read: vi.fn(async (file: TFile) => decode(entry(file).bytes)),
		cachedRead: vi.fn(async (file: TFile) => decode(entry(file).bytes)),
		readBinary: vi.fn(async (file: TFile) => buffer(entry(file).bytes)),
		create: vi.fn(async (path: string, content: string) => {
			if (files.has(path)) throw new Error(`${path} already exists`);
			return add(path, encode(content));
		}),
		modify: vi.fn(async (file: TFile, content: string) => {
			entry(file).bytes = encode(content);
		}),
		modifyBinary: vi.fn(async (file: TFile, data: ArrayBuffer) => {
			entry(file).bytes = copy(data);
		}),
		trash: vi.fn(async (file: TFile, _system: boolean) => {
			const { bytes } = entry(file);
			files.delete(file.path);
			trash(file.path, bytes);
		}),
		delete: vi.fn(async () => {
			throw new Error("Permanent deletion is not allowed");
		}),
		configDir: ".obsidian",
		adapter: {
			writeBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
				hidden.set(path, copy(data));
				mtimes.set(path, (mtimes.get(path) ?? 0) + 1);
			}),
			trashSystem: vi.fn(async (path: string) => {
				trash(path, takeHidden(path));
				return true;
			}),
			trashLocal: vi.fn(async (path: string) => {
				trash(path, takeHidden(path));
			}),
			remove: vi.fn(async (path: string) => {
				takeHidden(path);
			}),
			exists: vi.fn(async (path: string) => files.has(path) || hidden.has(path)),
			readBinary: vi.fn(async (path: string) => {
				const bytes = hidden.get(path);
				if (bytes === undefined) throw new Error(`${path} does not exist`);
				return buffer(bytes);
			}),
			stat: vi.fn(async (path: string) => {
				const bytes = hidden.get(path);
				return bytes === undefined
					? null
					: { type: "file", ctime: 0, mtime: mtimes.get(path) ?? 0, size: bytes.byteLength };
			}),
		},
	};
	const fileManager = {
		renameFile: vi.fn(async (file: TFile, newPath: string) => {
			const { bytes } = entry(file);
			if (files.has(newPath)) throw new Error(`${newPath} already exists`);
			files.delete(file.path);
			const renamed = makeFile(newPath);
			Object.assign(file, {
				path: renamed.path,
				name: renamed.name,
				basename: renamed.basename,
				extension: renamed.extension,
			});
			files.set(newPath, { file, bytes });
		}),
	};

	return {
		app: { vault, fileManager } as unknown as App,
		trashed,
		hidden,
		mtimes,
		file: (path) => {
			const found = files.get(path);
			if (!found) throw new Error(`${path} does not exist`);
			return found.file;
		},
		content: (path) => {
			const found = files.get(path);
			return found && decode(found.bytes);
		},
		bytes: (path) => files.get(path)?.bytes,
	};
}

/** The trashed files as `{ path, content }`, for concise assertions. */
export function trashedText(memory: MemoryVault) {
	return memory.trashed.map(({ path, content }) => ({ path, content }));
}
