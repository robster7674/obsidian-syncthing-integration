import { type App, ButtonComponent, Modal, Notice, type TFile } from "obsidian";
import { mount, unmount } from "svelte";
import { type SyncthingController } from "src/controllers/main_controller";
import { type ConflictFilename } from "src/models/entities";
import { ConflictResolver } from "src/controllers/conflict_resolution";
import { Failure, MissingOriginalFailure } from "src/models/failures";
import DiffView from "../components/diff_view.svelte";

export class DiffModal extends Modal {
	d2hUI?: string;
	d2hColorBlind = false;
	originalFile: TFile;
	conflictingFiles: TFile[] = [];
	conflictingFilesOrFailure: TFile[] | Failure = [];
	conflictingFilesProperties: Map<TFile, ConflictFilename | Failure>;
	private component?: ReturnType<typeof mount>;
	constructor(
		app: App,
		public file: TFile,
		public syncthingController: SyncthingController
	) {
		super(app);
		this.originalFile = file;
		this.conflictingFilesProperties = new Map();
	}

	async onOpen() {
		this.modalEl.style.width = "100%";
		this.modalEl.style.height = "100%";
		({
			originalFile: this.originalFile,
			conflictingFiles: this.conflictingFilesOrFailure,
			conflictingFilesProperties: this.conflictingFilesProperties,
		} = await this.syncthingController.getDiffFiles(this.file));

		if (this.conflictingFilesOrFailure instanceof MissingOriginalFailure) {
			this.showMissingOriginal(this.conflictingFilesOrFailure.originalPath);
			return;
		}
		if (this.conflictingFilesOrFailure instanceof Failure) {
			new Notice(this.conflictingFilesOrFailure.message);
			this.close();
			return;
		}
		this.conflictingFiles = this.conflictingFilesOrFailure;

		this.component = mount(DiffView, {
			target: this.contentEl,
			props: {
				parentModal: this,
			},
		});
	}

	/**
	 * Offers to restore `file` as the original that no longer exists, or to trash it.
	 */
	private showMissingOriginal(originalPath: string) {
		const resolver = new ConflictResolver(this.app);
		this.titleEl.setText("Original file missing");
		this.contentEl.createEl("p", {
			text: `${originalPath} no longer exists. Restore ${this.file.path} as ${originalPath}, or move it to the trash.`,
		});
		const buttons = this.contentEl.createDiv("confirm-modal-buttons");
		let busy = false;
		const setBusy = (value: boolean) => {
			busy = value;
			buttons
				.querySelectorAll("button")
				.forEach((button) => (button.disabled = value));
		};
		const resolve = async (action: () => Promise<void>, done: string) => {
			if (busy) return;
			setBusy(true);
			try {
				await action();
			} catch (error) {
				console.error(error);
				new Notice(`Could not resolve the conflict: ${error}`);
				setBusy(false);
				return;
			}
			new Notice(done);
			this.close();
		};
		new ButtonComponent(buttons)
			.setButtonText("Restore as original")
			.setCta()
			.onClick(() =>
				resolve(
					() => resolver.restoreAsOriginal(this.file, originalPath),
					`Restored ${originalPath}`
				)
			);
		new ButtonComponent(buttons)
			.setButtonText("Move to trash")
			.setWarning()
			.onClick(() =>
				resolve(
					() => resolver.keepOriginal(this.file),
					`Moved ${this.file.path} to the trash`
				)
			);
		new ButtonComponent(buttons)
			.setButtonText("Cancel")
			.onClick(() => this.close());
	}

	onClose() {
		const { contentEl } = this;
		if (this.component) void unmount(this.component);
		contentEl.empty();
	}
}
