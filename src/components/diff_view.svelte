<script lang="ts">
	import { unifiedMergeView } from "@codemirror/merge";
	import { EditorState } from "@codemirror/state";
	import { EditorView, basicSetup } from "codemirror";
	import { Notice, type TFile } from "obsidian";
	import { ConflictResolver } from "src/controllers/conflict_resolution";
	import { comparableAsText } from "src/controllers/file_kind";
	import { markdownPreview } from "src/controllers/markdown_preview";
	import { Failure } from "src/models/failures";
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
	/** True until the diff for `currentConflict` is shown, so no action targets a diff not yet visible. */
	let loading = true;
	const resolver = new ConflictResolver(parentModal.app);

	// Modal elements styling
	parentModal.titleEl.setText("Difference view");
	parentModal.titleEl.style.textAlign = "center";

	onMount(async () => {
		editor = new EditorView({ parent: unifiedMergeViewContainer });
		await showConflict(currentConflict);
	});

	/** The original's text as the diff shows it, so a change made since is not overwritten. */
	let shownOriginal: string | undefined;
	/**
	 * `true` when the pair is shown as a text diff, why it is compared by its
	 * details only, or `undefined` until that is known.
	 */
	let asText: true | string | undefined;

	async function diffState(
		conflict: TFile
	): Promise<{ state: EditorState; originalContent: string }> {
		const [conflictContent, originalContent] = await Promise.all([
			parentModal.app.vault.read(conflict),
			parentModal.app.vault.read(parentModal.originalFile),
		]);
		const state = EditorState.create({
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
		return { state, originalContent };
	}

	async function showConflict(file: TFile) {
		currentConflict = file;
		revision++;
		loading = true;
		asText = undefined;
		const request = ++diffRequest;
		try {
			const comparable = await comparableAsText(
				parentModal.app,
				file,
				parentModal.originalFile
			);
			if (request !== diffRequest) return;
			if (comparable !== true) {
				asText = comparable;
				shownOriginal = undefined;
				editor?.setState(EditorState.create({ doc: "" }));
				loading = false;
				return;
			}
			const { state, originalContent } = await diffState(file);
			if (request !== diffRequest) return;
			asText = true;
			shownOriginal = originalContent;
			editor?.setState(state);
			loading = false;
		} catch (error) {
			if (request !== diffRequest) return;
			console.error(error);
			new Notice(`Could not show ${file.path}: ${error}`);
			parentModal.close();
		}
	}

	/**
	 * Drops a resolved conflict from the list, then shows the next one or closes.
	 */
	async function resolved(conflict: TFile) {
		const remaining = parentModal.conflictingFiles.filter(
			(file) => file !== conflict
		);
		if (remaining.length === 0) {
			parentModal.close();
			return;
		}
		const showing = showConflict(remaining[0]);
		parentModal.conflictingFiles = remaining;
		await showing;
	}

	async function resolve(
		conflict: TFile,
		action: () => Promise<string>
	) {
		if (busy || loading) return;
		busy = true;
		try {
			new Notice(await action());
			await resolved(conflict);
		} catch (error) {
			console.error(error);
			new Notice(`Could not resolve the conflict: ${error}`);
			// A step may have succeeded before the failure: show the files as they are now.
			await showConflict(currentConflict);
		} finally {
			busy = false;
		}
	}

	async function acceptConflict() {
		const original = parentModal.originalFile;
		const conflict = currentConflict;
		await resolve(conflict, async () =>
			(await resolver.keepConflict(original, conflict, shownOriginal))
				? `Kept the conflicting version of ${original.path}. The previous version is in the trash.`
				: `${conflict.path} was identical to ${original.path} and is in the trash.`
		);
	}

	async function acceptOriginal() {
		const conflict = currentConflict;
		await resolve(conflict, async () => {
			await resolver.keepOriginal(conflict);
			return `Kept the original. ${conflict.path} is in the trash.`;
		});
	}

	async function keepBoth() {
		const conflict = currentConflict;
		const properties = parentModal.conflictingFilesProperties.get(conflict);
		if (!properties || properties instanceof Failure) {
			new Notice(`${conflict.name} is not named like a Syncthing conflict.`);
			return;
		}
		await resolve(conflict, async () => {
			const path = await resolver.keepBoth(conflict, properties);
			return `Kept both versions. The conflicting one is now ${path}.`;
		});
	}

	function openMergeEditor() {
		if (busy || loading) return;
		const conflict = currentConflict;
		new MergeModal(
			parentModal.app,
			parentModal.originalFile,
			conflict,
			() => void resolved(conflict)
		).open();
	}

	async function onFileChange(event: CustomEvent<{ file: TFile }>) {
		if (busy) return;
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
	{#if typeof asText === "string"}
		<p class="mod-warning">{asText}</p>
	{/if}
	<div
		bind:this={unifiedMergeViewContainer}
		class="diff_view"
		class:hidden={typeof asText === "string"}
	></div>
</div>
<div class="column">
	<h1>Original file</h1>
	<h2>{parentModal.originalFile.basename}</h2>
	{#key revision}
		<FileDetails file={parentModal.originalFile} />
	{/key}
	<div class="preview-container" class:hidden={asText !== true}>
		{#key revision}
			{#if asText === true}
			<h2>Original file preview</h2>
			{#await parentModal.app.vault.cachedRead(parentModal.originalFile)}
				<p>Loading preview...</p>
			{:then content}
				<div class="preview" use:markdownPreview={content}></div>
			{:catch error}
				<p>Could not read the file: {error}</p>
			{/await}
			<h2>Conflicting file preview</h2>
			{#await parentModal.app.vault.cachedRead(currentConflict)}
				<p>Loading preview...</p>
			{:then content}
				<div class="preview" use:markdownPreview={content}></div>
			{:catch error}
				<p>Could not read the file: {error}</p>
			{/await}
			{/if}
		{/key}
	</div>
</div>
<div class="tools">
	<button disabled={busy || loading} on:click={acceptConflict}>
		Accept conflict changes
	</button>
	<button disabled={busy || loading} on:click={acceptOriginal}> Accept original </button>
	<button disabled={busy || loading} on:click={keepBoth}>Keep both</button>
	{#if asText === true}
		<button disabled={busy || loading} on:click={openMergeEditor}>
			Open in Merge Editor
		</button>
	{/if}
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
	.hidden {
		display: none;
	}
	.diff_view {
		max-height: 650px;
		overflow-y: scroll;
	}
</style>
