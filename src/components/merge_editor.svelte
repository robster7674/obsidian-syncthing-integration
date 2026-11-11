<script lang="ts">
	import { MergeView } from "@codemirror/merge";
	import { EditorState, type Text } from "@codemirror/state";
	import { EditorView, basicSetup } from "codemirror";
	import { ButtonComponent, Notice, debounce } from "obsidian";
	import { ConflictResolver } from "src/controllers/conflict_resolution";
	import { markdownPreview } from "src/controllers/markdown_preview";
	import { ConfirmModal } from "src/views/confirm_modal";
	import { type MergeModal } from "src/views/merge_editor";
	import { onDestroy, onMount } from "svelte";

	export let originalContent = "this is the original text";
	export let modifiedContent = "this is the modified text";
	export let parentModal: MergeModal;
	let mergeEditor: MergeView;
	let mergeEditorContainer: HTMLDivElement;
	let toolsContainer: HTMLDivElement;
	let previewContent = originalContent;
	const updatePreview = debounce(
		(doc: Text) => (previewContent = doc.toString()),
		250
	);
	const resolver = new ConflictResolver(parentModal.app);
	onDestroy(() => updatePreview.cancel());

	let saving = false;

	async function save() {
		if (saving) return;
		saving = true;
		const merged = mergeEditor.a.state.doc.toString();
		let backedUp: boolean;
		try {
			backedUp = await resolver.saveMerge(
				parentModal.originalFile,
				parentModal.modifiedFile,
				merged
			);
		} catch (error) {
			console.error(error);
			new Notice(`Could not save the merge: ${error}`);
			return;
		} finally {
			saving = false;
		}
		new Notice(
			backedUp
				? `Saved ${parentModal.originalFile.path}. The conflict and the previous version are in the trash.`
				: `${parentModal.originalFile.path} was unchanged. The conflict is in the trash.`
		);
		parentModal.close();
		parentModal.onResolved();
	}

	onMount(() => {
		mergeEditor = new MergeView({
			a: {
				doc: originalContent,
				extensions: [
					basicSetup,
					EditorView.lineWrapping,
					EditorView.darkTheme.of(true),
					EditorView.updateListener.of((viewUpdate) => {
						if (viewUpdate.docChanged) {
							updatePreview(viewUpdate.state.doc);
						}
					}),
				],
			},
			b: {
				doc: modifiedContent,
				extensions: [
					basicSetup,
					EditorView.lineWrapping,
					EditorView.darkTheme.of(true),
					EditorView.editable.of(false),
					EditorState.readOnly.of(true),
				],
			},
			revertControls: "b-to-a",
			parent: mergeEditorContainer,
		});
		new ButtonComponent(toolsContainer)
			.setButtonText("Save merged file")
			.setCta()
			.onClick(() => {
				if (mergeEditor.chunks.length > 0) {
					new ConfirmModal(
						parentModal.app,
						`Some differences are still unresolved.\nSave the left side as it is now into ${parentModal.originalFile.path}?\nThe conflicting file and the previous version go to the trash.`,
						() => void save()
					).open();
					return;
				}
				void save();
			}).buttonEl.style.margin = "1%";
		new ButtonComponent(toolsContainer)
			.setButtonText("Cancel merge")
			.setWarning()
			.onClick(() => {
				if (mergeEditor.chunks.length > 0) {
					new Notice(
						"There is still some merge conflicts. Please resolve them."
					);
					new ConfirmModal(
						parentModal.app,
						"Are you sure you want to cancel the merge?\nThere are still some merge conflicts.\nThis will keep the original file and the conflicting file.",
						() => {
							new Notice("Closing the merge editor.");
							parentModal.close();
						}
					).open();
					return;
				}
				new ConfirmModal(
					parentModal.app,
					"Are you sure you want to cancel the merge?\nYou have resolved the conflicts but your modifications will not be saved.\nThis will keep the original file and the conflicting file.",
					() => {
						new Notice("Closing the merge editor.");
						parentModal.close();
					}
				).open();
			}).buttonEl.style.margin = "1% 0";
	});
</script>

<div class="merge" bind:this={mergeEditorContainer}></div>

<h3>Preview the merged file</h3>
<div class="preview" use:markdownPreview={previewContent}></div>

<div bind:this={toolsContainer} class="tools"></div>

<style>
	.merge {
		border-radius: 5px;
		height: 35%;
		overflow: scroll;
	}

	.preview {
		border: 1px solid var(--background-modifier-border);
		border-radius: 5px;
		height: 35%;
		overflow: scroll;
		padding: 1%;
	}

	.tools {
		display: flex;
		flex-direction: row;
		justify-content: end;
		align-items: center;
	}
</style>
