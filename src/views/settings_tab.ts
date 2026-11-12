import { type App, PluginSettingTab } from "obsidian";
import { mount, unmount } from "svelte";
import { type SyncthingController } from "src/controllers/main_controller";
import type SyncthingPlugin from "src/main";
import SettingView from "../components/settings_view.svelte";

export class SyncthingSettingTab extends PluginSettingTab {
	plugin: SyncthingPlugin;
	syncthingController: SyncthingController;
	private view?: ReturnType<typeof mount>;

	constructor(app: App, plugin: SyncthingPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.syncthingController = plugin.syncthingController;
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		this.hide();
		containerEl.empty();

		this.view = mount(SettingView, {
			target: containerEl,
			props: {
				parent: this
			}
		})
	}

	hide(): void {
		if (this.view) void unmount(this.view);
		this.view = undefined;
		super.hide();
	}
}
