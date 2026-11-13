/**
 * @file This file contains some functions for plugin development mode.
 * The plugin dev mode can be enabled from the plugin settings.
 * It allows the user to gain access to extra features for helping him develop the plugin and make improvements,
 * or test features.
 */

import randomDate from "@js-random/date";
import { loremIpsum } from "lorem-ipsum";
import { type App, Modal, Notice, Setting } from "obsidian";
import type SyncthingPlugin from "../main";

export class PluginDevModeController {
	constructor(public plugin: SyncthingPlugin) {}

	async generateSyncthingConflicts(distinctFiles = 2, conflictsPerFile = 3) {
		new Notice("Creating main files...");
		new Notice(
			`Parameters: ${distinctFiles} distinct files, ${conflictsPerFile} conflicts per file.`
		);
		const mainFileNotice = new Notice("", 0);
		const conflictFilesNotice = new Notice("", 0);
		let created = 0;
		try {
			for (let k = 0; k < distinctFiles; k++) {
				mainFileNotice.setMessage(
					`Progress (main files): ${k}/${distinctFiles}`
				);
				// Create main file.
				const mainFile = await this.plugin.app.vault.create(
					this.freeMainPath(loremIpsum({ count: 1, units: "words" })),
					`# ${loremIpsum({ count: 1, units: "words" })}\n\n${loremIpsum({
						count: 1,
						units: "paragraphs",
					})}`
				);
				created++;

				// Create conflict files corresponding to main file.
				new Notice("Creating conflict files...");
				for (let j = 0; j < conflictsPerFile; j++) {
					conflictFilesNotice.setMessage(
						`Progress (conflicts): ${j}/${conflictsPerFile}`
					);
					await this.plugin.app.vault.create(
						this.freeConflictPath(mainFile.basename),
						`# ${loremIpsum({
							count: 1,
							units: "words",
						})}\n\n${loremIpsum({ count: 2, units: "paragraphs" })}`
					);
					created++;
				}
			}
		} catch (error) {
			new Notice(
				`Generating conflicts stopped after ${created} of ${distinctFiles * (conflictsPerFile + 1)} files: ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			mainFileNotice.hide();
			conflictFilesNotice.hide();
		}
	}

	/** Whether a path, or a conflict of it, exists, ignoring case like most file systems. */
	private isTaken(basename: string, extension: string): boolean {
		const path = `${basename}.${extension}`.toLowerCase();
		const conflicts = `${basename}.sync-conflict-`.toLowerCase();
		return this.plugin.app.vault.getFiles().some((file) => {
			const existing = file.path.toLowerCase();
			return existing === path || existing.startsWith(conflicts);
		});
	}

	private freeMainPath(basename: string): string {
		let name = basename;
		for (let n = 1; this.isTaken(name, "md"); n++) {
			name = `${basename} ${n}`;
		}
		return `${name}.md`;
	}

	private freeConflictPath(basename: string): string {
		let name: string;
		do {
			const dateString = randomDate({
				from: new Date(2020, 0, 1),
				to: new Date(),
			})
				.toISOString()
				.replace(/-/gm, "")
				.replace("T", "-")
				.replace(/:|\.\d{3}Z/gm, "");
			const deviceID = Array.from(
				{ length: 7 },
				() => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[Math.floor(Math.random() * 32)]
			).join("");
			name = `${basename}.sync-conflict-${dateString}-${deviceID}`;
		} while (this.isTaken(name, "md"));
		return `${name}.md`;
	}

	async purgeVault() {
		this.plugin.app.vault.getAllLoadedFiles().forEach(async (file) => {
			await this.plugin.app.vault.delete(file);
		});
	}
}

export class DevModeModal extends Modal {
	distinctFiles: number;
	conflictsPerFile: number;
	constructor(
		app: App,
		public pluginDevModeController: PluginDevModeController
	) {
		super(app);
		this.distinctFiles = 2;
		this.conflictsPerFile = 3;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Plugin development mode" });
		contentEl.createEl("p", {
			text: "Here, you can create sample files to test the Obsidian Syncthing integration plugin.\nThe generated files are formated as in Syncthing documentation about conflicting files.",
		});
		contentEl.createEl("p", {
			text: "File format : <filename>.sync-conflict-<date>-<deviceID>.<extension>",
		});

		new Setting(contentEl)
			.setName("Number of distinct files")
			.setDesc("Number of files that will be created.")
			.addSlider((slider) => {
				slider
					.setValue(this.distinctFiles)
					.setDynamicTooltip()
					.setLimits(1, 50, 1)
					.onChange((value) => {
						this.distinctFiles = value;
					});
			});
		new Setting(contentEl)
			.setName("Number of conflicts per file")
			.setDesc("Number of conflicts that will be created for each file.")
			.addSlider((slider) => {
				slider
					.setValue(this.conflictsPerFile)
					.setDynamicTooltip()
					.setLimits(1, 25, 1)
					.onChange((value) => {
						this.conflictsPerFile = value;
					});
			});

		new Setting(contentEl)
			.setName("Generate Syncthing conflicts")
			.addButton((button) => {
				button
					.setCta()
					.setButtonText("Generate")
					.onClick(async () => {
						button.setDisabled(true);
						await this.pluginDevModeController.generateSyncthingConflicts(
							this.distinctFiles,
							this.conflictsPerFile
						);
						this.close();
					});
			});
		new Setting(contentEl)
			.setName("Purge Vault")
			.setDesc("Delete all files in the vault.")
			.addButton((button) => {
				button
					.setWarning()
					.setButtonText("Purge")
					.onClick(async () => {
						const modal = new Modal(this.app);
						modal.contentEl.createEl("h1", { text: "Purge Vault" });
						modal.contentEl.createEl("p", {
							text: "This will delete all files in the vault. Please don't use it on a vault that contains important files.",
						});
						new Setting(modal.contentEl)
							.setName("Are you sure?")
							.setHeading()
							.addButton((button) => {
								button
									.setWarning()
									.setButtonText("Yes")
									.onClick(async () => {
										await this.pluginDevModeController.purgeVault();
										modal.close();
										this.close();
									});
							})
							.addButton((button) => {
								button.setButtonText("No").onClick(() => {
									modal.close();
								});
							});
						modal.open();
					});
			});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
