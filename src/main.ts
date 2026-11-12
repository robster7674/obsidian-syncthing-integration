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
	settingTab?: SyncthingSettingTab;
	/** The fields of 2.4.0 kept in `data.json` for devices that have not taken them over. */
	private shared: Record<string, unknown> = {};
	/** The API key in `data.json`, when the keychain refused it. */
	private unmovedApiKey?: string;
	/** Whether taking over the settings shared in `data.json` failed, so this device still needs them. */
	private takeOverPending = false;
	private shownProblem?: string;
	pluginsElements: HTMLElement[] = [];
	syncthingFromCLI: SyncthingFromCLI = new SyncthingFromCLI(this);
	syncthingFromREST: SyncthingFromREST = new SyncthingFromREST(this);
	syncthingController: SyncthingController = new SyncthingController(
		this.syncthingFromCLI,
		this.syncthingFromREST,
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
		if (SyncthingPlugin.loadCount === 1) {
			this.settingTab = new SyncthingSettingTab(this.app, this);
			this.addSettingTab(this.settingTab);
		}

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
	 * Loads the settings. The API key and the Syncthing URL that 2.4.0 kept in
	 * `data.json`, which syncs, are taken over into this device's keychain and
	 * local storage when it has none yet. They stay in `data.json` for the
	 * other devices until the user removes them; the unused GUI credentials
	 * are removed at once.
	 */
	async loadSettings() {
		const loaded = parseSettings(
			await this.loadData(),
			this.app.loadLocalStorage(DEVICE_SETTINGS_KEY),
		);
		const lostUnmovedKey = this.unmovedApiKey && !loaded.sharedApiKey;
		this.settings = loaded.settings;
		this.device = loaded.device;
		this.shared = loaded.shared;
		this.unmovedApiKey = undefined;
		this.takeOverPending = false;
		if (loaded.problem && loaded.problem !== this.shownProblem) {
			new Notice(`Syncthing Integration: ${loaded.problem}`, 0);
		}
		this.shownProblem = loaded.problem;
		if (lostUnmovedKey) {
			new Notice(
				"Syncthing Integration: the API key in data.json, which this device used, was removed by another device. Set the API key again.",
				0,
			);
		}
		if (loaded.takeOver) this.takeOverShared(loaded.sharedApiKey);
		if (loaded.rewrite) await this.saveSettings();
	}

	/**
	 * Stores the settings 2.4.0 shared in `data.json` as this device's own.
	 * The device settings are written last: they mark the take-over as done,
	 * so a failed step is retried on the next load and nothing is lost.
	 */
	private takeOverShared(sharedApiKey?: string) {
		this.takeOverPending = true;
		try {
			if (sharedApiKey && !this.app.secretStorage.getSecret(API_KEY_SECRET)) {
				this.setApiKey(sharedApiKey);
			}
		} catch (error) {
			this.unmovedApiKey = sharedApiKey;
			new Notice(
				`Syncthing Integration: the API key could not be stored in Obsidian's keychain, so the one in data.json is used. ${error}`,
				0,
			);
			return;
		}
		try {
			this.saveDeviceSettings();
		} catch (error) {
			new Notice(
				`Syncthing Integration: the Syncthing URL could not be stored on this device, so the one in data.json is used. ${error}`,
				0,
			);
			return;
		}
		this.takeOverPending = false;
	}

	/**
	 * Another device synced `data.json`, possibly still in an earlier format.
	 * An open settings tab is redrawn only when what it shows changed, so
	 * typing in it is not lost.
	 */
	async onExternalSettingsChange() {
		const shown = this.shownSettings();
		await this.loadSettings();
		if (
			this.settingTab?.containerEl.isConnected &&
			this.shownSettings() !== shown
		) {
			this.settingTab.display();
		}
	}

	private shownSettings(): string {
		return JSON.stringify([
			this.getApiKey(),
			this.device?.baseUrl,
			this.hasSharedSettings(),
			this.settings?.devMode,
		]);
	}

	async saveSettings() {
		await this.saveData({ ...this.shared, ...this.settings });
	}

	saveDeviceSettings() {
		this.app.saveLocalStorage(DEVICE_SETTINGS_KEY, this.device);
	}

	/** Whether `data.json` still holds the API key or URL that 2.4.0 shared between devices. */
	hasSharedSettings(): boolean {
		return Object.keys(this.shared).length > 0;
	}

	/**
	 * Removes the API key and URL of 2.4.0 from `data.json`, once every device
	 * has taken them over. Refused while this device still depends on them.
	 */
	async removeSharedSettings() {
		if (this.takeOverPending) {
			throw new Error(
				"This device could not store its own API key or Syncthing URL, so it still uses the ones in data.json.",
			);
		}
		await this.saveData({ ...this.settings });
		this.shared = {};
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
		];

		for (const command of commands) {
			this.addCommand(command);
		}
	}
}
