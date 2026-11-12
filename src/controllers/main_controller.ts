import { Platform, TFile } from "obsidian";
import { type SyncthingFromAndroid } from "src/data/syncthing_android_datasource";
import { type SyncthingFromCLI } from "src/data/syncthing_local_datasource";
import { type SyncthingFromREST } from "src/data/syncthing_remote_datasource";
import type SyncthingPlugin from "src/main";
import {
	type SyncthingDevice,
	type SyncthingFolder,
	type ConflictFilename,
} from "src/models/entities";
import {
	CliFailure,
	Failure,
	MissingOriginalFailure,
} from "src/models/failures";
import {
	originalPathOf,
	parseConflictFilename,
	sortByConflictDate,
} from "./utils";

/**
 * Main controller of the plugin.
 * Allows to easily connect with Syncthing.
 */
export class SyncthingController {
	constructor(
		/**
		 * CLI datasource to Syncthing
		 */
		public syncthingFromCLI: SyncthingFromCLI,
		/**
		 * REST datasource to Syncthing
		 */
		public syncthingFromREST: SyncthingFromREST,
		/**
		 * Android datasource to Syncthing
		 */
		public syncthingFromAndroid: SyncthingFromAndroid,
		/**
		 * The plugin instance.
		 * To make it easier to call plugin's methods.
		 * @see https://docs.obsidian.md/Reference/TypeScript+API/Plugin/Plugin
		 */
		public plugin: SyncthingPlugin,
	) {}

	/**
	 * Gets the Syncthing CLI status.
	 */
	getCLIStatus(): Promise<string> {
		return this.syncthingFromCLI.getVersion();
	}

	/**
	 * Gets the Syncthing API status.
	 */
	async getAPIStatus(): Promise<string> {
		if (!this.plugin.settings.api_key) {
			return "API key is not set.";
		}
		return this.syncthingFromREST.ping();
	}

	/**
	 * Checks if Syncthing is installed on the system.
	 */
	async hasSyncthing(): Promise<boolean> {
		// Mobile support
		if (Platform.isAndroidApp) {
			return await this.syncthingFromAndroid.hasSyncthing();
		} else if (Platform.isIosApp) {
			// IOS not supported.
			return false;
		}
		// Desktop support
		return await this.syncthingFromCLI
			.getVersion()
			.then((version) => {
				return true;
			})
			.catch(async (error) => {
				return await this.syncthingFromREST
					.ping()
					.then((response) => {
						return true;
					})
					.catch((error) => {
						return false;
					});
			});
	}

	/**
	 * Gets the Syncthing conflicts of a file, and its original when `activeFile` is itself a conflict.
	 * Only conflicts of the exact same path are returned: Syncthing writes them next to the original.
	 */
	async getConflictsWithOriginal(
		activeFile: TFile,
	): Promise<{ originalFile?: TFile; conflicts: TFile[] }> {
		const originalPath = originalPathOf(activeFile);
		if (originalPath instanceof Failure) {
			return { conflicts: this.findConflictsOf(activeFile.path) };
		}
		return {
			originalFile: this.findFile(originalPath),
			conflicts: this.findConflictsOf(originalPath),
		};
	}

	/**
	 * Gets the Syncthing conflicting files for the ConflictsModal,
	 * grouped by the path of their original file. The list sorts them for display.
	 * Files that contain `.sync-conflict-` but are not named the way Syncthing names conflicts are returned apart.
	 * @see https://docs.syncthing.net/users/syncing.html#conflicting-changes
	 */
	async getConflicts(): Promise<{
		conflicts: Map<string, TFile[]>;
		unrecognised: TFile[];
	}> {
		const conflicts = new Map<string, TFile[]>();
		const unrecognised: TFile[] = [];
		for (const file of this.plugin.app.vault.getFiles()) {
			if (!file.name.contains(".sync-conflict-")) continue;
			const originalPath = originalPathOf(file);
			if (originalPath instanceof Failure) {
				unrecognised.push(file);
				continue;
			}
			const group = conflicts.get(originalPath) ?? [];
			group.push(file);
			conflicts.set(originalPath, group);
		}
		return { conflicts, unrecognised };
	}

	/**
	 * Gets the original file and its Syncthing conflicting files for the DiffModal.
	 * `file` can be either the original or one of its conflicts.
	 * @see https://docs.syncthing.net/users/syncing.html#conflicting-changes
	 */
	async getDiffFiles(file: TFile): Promise<{
		originalFile: TFile;
		conflictingFiles: TFile[] | Failure;
		conflictingFilesProperties: Map<TFile, ConflictFilename | Failure>;
	}> {
		const parsedPath = originalPathOf(file);
		const originalPath =
			parsedPath instanceof Failure ? file.path : parsedPath;
		const originalFile = this.findFile(originalPath);
		const conflicts = this.findConflictsOf(originalPath).sort((a, b) =>
			sortByConflictDate(a, b),
		);
		const failure = !originalFile
			? new MissingOriginalFailure(originalPath)
			: conflicts.length === 0
				? new Failure(`No Syncthing conflicts found for ${originalPath}.`)
				: undefined;
		const conflictingFilesProperties = new Map<
			TFile,
			Failure | ConflictFilename
		>();
		for (const conflictingFile of conflicts) {
			conflictingFilesProperties.set(
				conflictingFile,
				parseConflictFilename(conflictingFile.name),
			);
		}
		return {
			originalFile: originalFile ?? file,
			conflictingFiles: failure ?? conflicts,
			conflictingFilesProperties,
		};
	}

	private findConflictsOf(originalPath: string): TFile[] {
		return this.plugin.app.vault
			.getFiles()
			.filter(
				(file) =>
					file.name.contains(".sync-conflict-") &&
					originalPathOf(file) === originalPath,
			);
	}

	private findFile(path: string): TFile | undefined {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : undefined;
	}

	/**
	 * Gets the Syncthing API key from the CLI.
	 */
	async getAPIKey(): Promise<string | Failure> {
		if (Platform.isMobileApp) {
			return new Failure(
				"Cannot get API key on mobile. Please enter it manually.",
			);
		}
		if (!this.plugin.settings.api_key) {
			try {
				const apiKey = await this.syncthingFromCLI.getAPIkey();
				if (apiKey) {
					this.plugin.settings.api_key = apiKey;
					await this.plugin.saveSettings();
					return apiKey;
				}
			} catch (error) {
				return new CliFailure("Error getting API key.");
			}
		}
		return this.plugin.settings.api_key;
	}

	/**
	 * Gets the Syncthing devices.
	 */
	async getDevices(): Promise<SyncthingDevice[]> {
		return await this.syncthingFromREST.getDevices();
	}

	/**
	 * Gets the Syncthing folders.
	 */
	async getFolders(): Promise<SyncthingFolder[]> {
		return await this.syncthingFromREST.getAllFolders();
	}

	/**
	 * Starts the Syncthing service.
	 */
	async startSyncthing(): Promise<boolean> {
		return this.syncthingFromCLI.startSyncthing();
	}

	/**
	 * Stops the Syncthing service.
	 */
	async stopSyncthing(): Promise<boolean> {
		return this.syncthingFromCLI.stopSyncthing();
	}
}
