import {
	type Command,
	type Editor,
	type MarkdownFileInfo,
	type MarkdownView,
	Notice,
	Platform,
	Plugin,
	addIcon,
} from "obsidian";
import { SyncthingController } from "./controllers/main_controller";
import {
	DevModeModal,
	PluginDevModeController,
} from "./controllers/plugin_dev_mode";
import { SyncthingStatusBar } from "./controllers/status_bar";
import { SyncthingFromAndroid } from "./data/syncthing_android_datasource";
import { SyncthingFromCLI } from "./data/syncthing_local_datasource";
import { SyncthingFromREST } from "./data/syncthing_remote_datasource";
import { ConflictsModal } from "./views/conflicts_modal";
import { DiffModal } from "./views/diff_modal";
import { SyncthingLogoSVG } from "./views/logos";
import { SyncthingSettingTab } from "./views/settings_tab";
import { ConfigurationModal } from "./views/configuration_modal";
import {
	API_KEY_SECRET,
	DEVICE_SETTINGS_KEY,
	type DeviceSettings,
	parseSettings,
	type SyncthingPluginSettings,
} from "./settings";

export default class SyncthingPlugin extends Plugin {
	PLUGIN_ID = "syncthing-integration";
	static loadCount = 0;
	settings!: SyncthingPluginSettings;
	device!: DeviceSettings;
	/** An API key that could not be moved from `data.json` to the keychain. */
	private unmovedApiKey?: string;
	pluginsElements: HTMLElement[] = [];
	syncthingFromCLI: SyncthingFromCLI = new SyncthingFromCLI();
	syncthingFromREST: SyncthingFromREST = new SyncthingFromREST(this);
	syncthingFromAndroid: SyncthingFromAndroid = new SyncthingFromAndroid();
	syncthingController: SyncthingController = new SyncthingController(
		this.syncthingFromCLI,
		this.syncthingFromREST,
		this.syncthingFromAndroid,
		this,
	);
	devModeController: PluginDevModeController = new PluginDevModeController(
		this,
	);
	statusBar?: SyncthingStatusBar;

	async onload() {
		// For devMode issue. (adding/removing commands when loading/unloading plugin)
		SyncthingPlugin.loadCount++;
		await this.loadSettings();

		// Load Syncthing icon
		addIcon("syncthing", SyncthingLogoSVG);

		// Status bar. Does not work on mobile apps.
		if (!Platform.isMobileApp) {
			this.statusBar = new SyncthingStatusBar(
				this.addStatusBarItem(),
				this,
			);
			this.statusBar.onload();
			this.pluginsElements.push(this.statusBar.status_bar);
		}

		// Settings tab
		const pluginSettingTab = new SyncthingSettingTab(this.app, this);
		if (SyncthingPlugin.loadCount === 1)
			this.addSettingTab(pluginSettingTab);

		// Ribbon Icon
		const syncthingConflictManager = this.addRibbonIcon(
			"syncthing",
			"Open Syncthing conflict manager modal",
			() => {
				new ConflictsModal(this.app, this.syncthingController).open();
			},
		);

		// Dev Mode
		if (this.settings.devMode) {
			new Notice("Dev mode is enabled.");
			const devModeGenerator = this.addRibbonIcon(
				"chevron-right-square",
				"Generate Syncthing conflicts",
				async () => {
					new DevModeModal(
						this.app,
						new PluginDevModeController(this),
					).open();
				},
			);
			this.addCommand({
				id: "generate-syncthing-conflicts",
				name: "Generate Syncthing conflicts",
				icon: "chevron-right-square",
				callback: async () => {
					new DevModeModal(
						this.app,
						new PluginDevModeController(this),
					).open();
				},
			});
			this.pluginsElements.push(devModeGenerator);
		}
		this.pluginsElements.push(syncthingConflictManager);

		// Commands
		this.syncthingCommands();
	}

	onunload(): void {
		this.statusBar?.onunload();
		this.pluginsElements.forEach((element) => element.remove());
	}

	/**
	 * Loads the settings. The API key and the Syncthing URL of earlier versions
	 * move from `data.json`, which syncs, to this device's keychain and local
	 * storage; `data.json` is rewritten only once both are stored. A device
	 * that already has its own API key keeps it.
	 */
	async loadSettings() {
		const loaded = parseSettings(
			await this.loadData(),
			this.app.loadLocalStorage(DEVICE_SETTINGS_KEY),
		);
		this.settings = loaded.settings;
		this.device = loaded.device;
		this.unmovedApiKey = undefined;
		if (loaded.problem) new Notice(`Syncthing Integration: ${loaded.problem}`, 0);
		try {
			if (loaded.legacyApiKey && !this.getApiKey()) {
				this.setApiKey(loaded.legacyApiKey);
			}
			if (loaded.deviceFromData) this.saveDeviceSettings();
		} catch (error) {
			this.unmovedApiKey = loaded.legacyApiKey;
			new Notice(
				`Syncthing Integration: the API key could not be moved to Obsidian's keychain, so it stays in data.json. ${error}`,
				0,
			);
			return;
		}
		if (loaded.rewrite) await this.saveSettings();
	}

	/** Another device synced `data.json`, possibly still in an earlier format. */
	async onExternalSettingsChange() {
		await this.loadSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	saveDeviceSettings() {
		this.app.saveLocalStorage(DEVICE_SETTINGS_KEY, this.device);
	}

	/** This device's Syncthing API key, or `""` when none is set. */
	getApiKey(): string {
		return (
			this.app.secretStorage.getSecret(API_KEY_SECRET) ||
			this.unmovedApiKey ||
			""
		);
	}

	/** Stores this device's Syncthing API key in Obsidian's keychain; `""` clears it. */
	setApiKey(key: string) {
		this.app.secretStorage.setSecret(API_KEY_SECRET, key);
		this.unmovedApiKey = undefined;
	}

	// This method adds commands for the Syncthing Plugin
	// It can be related to conflicts, the diff modal or other useful commands.
	private syncthingCommands() {
		const commands: Command[] = [
			{
				id: "syncthing-conflicts-modal",
				name: "Open conflicts modal",
				callback: () => {
					new ConflictsModal(
						this.app,
						this.syncthingController,
					).open();
				},
			},
			{
				id: "syncthing-diff-modal",
				name: "Open diff modal",
				editorCheckCallback: (
					checking: boolean,
					editor: Editor,
					ctx: MarkdownView | MarkdownFileInfo,
				): boolean | void => {
					const file = ctx.file;

					if (file) {
						if (!checking) {
							new DiffModal(
								this.app,
								file,
								this.syncthingController,
							).open();
						}
						return true;
					}

					return false;
				},
			},
			{
				id: "syncthing-configuration-modal",
				name: "Open configuration modal",
				callback: () => {
					new ConfigurationModal(this.app, this).open();
				},
			},
			{
				id: "syncthing-plugin-settings",
				name: "Open plugin settings",
				callback: () => {
					// @ts-expect-error
					this.app.setting.open();
					// @ts-expect-error
					this.app.setting.openTabById(this.PLUGIN_ID);
				},
			},
			{
				id: "syncthing-bug-report",
				name: "Report a bug / Suggest a new feature",
				callback: () => {
					open(
						"https://github.com/LBF38/obsidian-syncthing-integration/issues/new/choose",
					);
				},
			},
			// {
			// 	id: "syncthing-plugin-documentation",
			// 	name: "Open online documentation",
			// 	callback: () => {
			// 		open(
			// 			"https://LBF38.github.io/obsidian-syncthing-integration",
			// 		);
			// 	},
			// },
		];

		for (const command of commands) {
			this.addCommand(command);
		}
	}
}
