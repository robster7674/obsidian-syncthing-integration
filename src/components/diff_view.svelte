<script lang="ts">
	import { unifiedMergeView } from "@codemirror/merge";
	import { EditorState } from "@codemirror/state";
	import { EditorView, basicSetup } from "codemirror";
	import { Notice, type TFile } from "obsidian";
	import { ConflictResolver } from "src/controllers/conflict_resolution";
	import { markdownPreview } from "src/controllers/markdown_preview";
	import { type DiffModal } from "src/views/diff_modal";
	import { MergeModal } from "src/views/merge_editor";
	import { onMount } from "svelte";
	import ConflictFileDetails from "./conflict_file_details.svelte";
	import FileDetails from "./file_details.svelte";

	export let parentModal: DiffModal;
	let unifiedMergeViewContainer: HTMLDivElement;
	let editor: EditorView | undefined;
	let currentConflict = parentModal.conflictingFiles[0];
	/** Bumped whenever a file shown here changes, to refresh the previews. */
	let revision = 0;
	/** Identifies the latest diff request, so an older one finishing late is ignored. */
	let diffRequest = 0;
	let busy = false;
	const resolver = new ConflictResolver(parentModal.app);

	// Modal elements styling
	parentModal.titleEl.setText("Difference view");
	parentModal.titleEl.style.textAlign = "center";

	onMount(async () => {
		editor = new EditorView({ parent: unifiedMergeViewContainer });
		await showConflict(currentConflict);
	});

	async function diffState(conflict: TFile): Promise<EditorState> {
		const [conflictContent, originalContent] = await Promise.all([
			parentModal.app.vault.read(conflict),
			parentModal.app.vault.read(parentModal.originalFile),
		]);
		return EditorState.create({
			doc: conflictContent,
			extensions: [
				basicSetup,
				EditorView.editable.of(false),
				EditorView.lineWrapping,
				EditorView.darkTheme.of(true),
				unifiedMergeView({
					original: originalContent,
					mergeControls: false,
					gutter: true,
					highlightChanges: true,
					syntaxHighlightDeletions: true,
				}),
			],
		});
	}

	async function showConflict(file: TFile) {
		currentConflict = file;
		revision++;
		const request = ++diffRequest;
		const state = await diffState(file);
		if (request === diffRequest) editor?.setState(state);
	}

	/**
	 * Drops a resolved conflict from the list, then shows the next one or closes.
	 */
	async function resolved(conflict: TFile) {
		parentModal.conflictingFiles.remove(conflict);
		parentModal.conflictingFiles = parentModal.conflictingFiles;
		if (parentModal.conflictingFiles.length === 0) {
			parentModal.close();
			return;
		}
		await showConflict(parentModal.conflictingFiles[0]);
	}

	async function resolve(
		conflict: TFile,
		action: () => Promise<void>,
		done: string
	) {
		if (busy) return;
		busy = true;
		try {
			await action();
		} catch (error) {
			console.error(error);
			new Notice(`Could not resolve the conflict: ${error}`);
			return;
		} finally {
			busy = false;
		}
		new Notice(done);
		await resolved(conflict);
	}

	async function acceptConflict() {
		const original = parentModal.originalFile;
		const conflict = currentConflict;
		await resolve(
			conflict,
			() => resolver.keepConflict(original, conflict),
			`Kept the conflicting version of ${original.path}. The previous version is in the trash.`
		);
	}

	async function acceptOriginal() {
		const conflict = currentConflict;
		await resolve(
			conflict,
			() => resolver.keepOriginal(conflict),
			`Kept the original. ${conflict.path} is in the trash.`
		);
	}

	function openMergeEditor() {
		if (busy) return;
		const conflict = currentConflict;
		new MergeModal(
			parentModal.app,
			parentModal.originalFile,
			conflict,
			() => resolved(conflict)
		).open();
	}

	async function onFileChange(event: CustomEvent<{ file: TFile }>) {
		await showConflict(event.detail.file);
	}
</script>

<div class="column">
	<h1>Conflicting files</h1>
	<div class="conflicts">
		{#each parentModal.conflictingFiles as file, i}
			{#if i !== 0}
				<div class="divider"></div>
			{/if}
			<ConflictFileDetails
				{file}
				counter={i}
				styled={true}
				isClicked={parentModal.conflictingFiles[i] === currentConflict}
				on:file={onFileChange}
			/>
		{/each}
	</div>
</div>
<div class="column">
	<h1>Quick difference view</h1>
	<div bind:this={unifiedMergeViewContainer} class="diff_view"></div>
</div>
<div class="column">
	<h1>Original file</h1>
	<h2>{parentModal.originalFile.basename}</h2>
	{#key revision}
		<FileDetails file={parentModal.originalFile} />
	{/key}
	<div class="preview-container">
		{#key revision}
			<h2>Original file preview</h2>
			{#await parentModal.app.vault.cachedRead(parentModal.originalFile)}
				<p>Loading preview...</p>
			{:then content}
				<div class="preview" use:markdownPreview={content}></div>
			{/await}
			<h2>Conflicting file preview</h2>
			{#await parentModal.app.vault.cachedRead(currentConflict)}
				<p>Loading preview...</p>
			{:then content}
				<div class="preview" use:markdownPreview={content}></div>
			{/await}
		{/key}
	</div>
</div>
<div class="tools">
	<button disabled={busy} on:click={acceptConflict}>
		Accept conflict changes
	</button>
	<button disabled={busy} on:click={acceptOriginal}> Accept original </button>
	<button disabled={busy} on:click={openMergeEditor}>
		Open in Merge Editor
	</button>
</div>

<style>
	.column {
		display: inline-block;
		width: 33%;
		min-height: fit-content;
		max-height: 95%;
		vertical-align: top;
		overflow-y: scroll;
		padding: 1%;
	}
	.column h1 {
		margin-top: 0;
		text-align: center;
	}
	.conflicts {
		max-height: 650px;
		overflow-y: auto;
		padding: 1%;
	}
	.divider {
		margin-top: 10px;
		margin-bottom: 10px;
		border-bottom: 2px solid var(--background-modifier-border);
	}
	.tools {
		display: flex;
		flex-direction: row;
		justify-content: space-evenly;
		align-items: end;
	}
	.preview {
		border: 1px solid var(--background-modifier-border);
		border-radius: 5px;
		padding: 1%;
	}
	.preview-container {
		padding: 1%;
		overflow-y: scroll;
		height: 500px;
	}
	.diff_view {
		max-height: 650px;
		overflow-y: scroll;
	}
</style>
