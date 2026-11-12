/**
 * Helpers to build a fake `SyncthingPlugin` instance for controller tests.
 *
 * Only the small surface used by `SyncthingController` is implemented: `app`
 * (with a `vault` returning a given list of files) and `settings`
 * (with a `saveSettings` spy).
 */
import { vi } from "vitest";
import type { App, TFile } from "obsidian";
import type SyncthingPlugin from "src/main";
import {
	DEFAULT_BASE_URL,
	type DeviceSettings,
	type SyncthingPluginSettings,
} from "src/settings";

export interface FakePluginSettings {
	apiKey?: string;
	baseUrl?: string;
	devMode?: boolean;
}

/** A vault whose methods are Vitest mocks. */
export interface FakeVault {
	getFiles: ReturnType<typeof vi.fn>;
	getMarkdownFiles: ReturnType<typeof vi.fn>;
	getAllLoadedFiles: ReturnType<typeof vi.fn>;
	getAbstractFileByPath: ReturnType<typeof vi.fn>;
	create: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
}

export interface FakePlugin {
	app: App;
	vault: FakeVault;
	settings: SyncthingPluginSettings;
	device: DeviceSettings;
	apiKey: string;
	getApiKey: () => string;
	setApiKey: ReturnType<typeof vi.fn>;
	saveDeviceSettings: ReturnType<typeof vi.fn>;
	saveSettings: ReturnType<typeof vi.fn>;
	loadData: ReturnType<typeof vi.fn>;
	saveData: ReturnType<typeof vi.fn>;
}

/**
 * Create a fake plugin whose vault returns the provided files.
 */
export function makePlugin(
	files: TFile[] = [],
	settings: FakePluginSettings = {},
): FakePlugin {
	const vault: FakeVault = {
		getFiles: vi.fn(() => files),
		getMarkdownFiles: vi.fn(() => files),
		getAllLoadedFiles: vi.fn(() => files),
		getAbstractFileByPath: vi.fn(
			(path: string) => files.find((file) => file.path === path) ?? null,
		),
		create: vi.fn(async () => files[0]),
		delete: vi.fn(async () => undefined),
	};

	const app = {
		vault,
		workspace: {
			getActiveFile: vi.fn(() => files[0] ?? null),
			getLeaf: vi.fn(),
		},
	} as unknown as App;

	const plugin: FakePlugin = {
		app,
		vault,
		settings: { devMode: settings.devMode ?? false },
		device: { baseUrl: settings.baseUrl ?? DEFAULT_BASE_URL, cliPath: "" },
		apiKey: settings.apiKey ?? "",
		getApiKey: () => plugin.apiKey,
		setApiKey: vi.fn((key: string) => {
			plugin.apiKey = key;
		}),
		saveDeviceSettings: vi.fn(),
		saveSettings: vi.fn(async () => undefined),
		loadData: vi.fn(async () => null),
		saveData: vi.fn(async () => undefined),
	};
	return plugin;
}

/**
 * Cast a fake plugin to the real `SyncthingPlugin` type expected by the
 * controller and the data sources.
 */
export function asPlugin(plugin: FakePlugin): SyncthingPlugin {
	return plugin as unknown as SyncthingPlugin;
}
