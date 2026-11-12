<script lang="ts">
	import { Notice, Platform } from "obsidian";
	import { IgnoreFile, obsidianIgnoreTemplate } from "src/controllers/stignore";
	import { type VaultFolder } from "src/controllers/vault_folder";
	import { Failure } from "src/models/failures";
	import { type SyncthingSettingTab } from "src/views/settings_tab";
	import { onMount } from "svelte";
	import ObsidianSettingsItem from "./obsidian_settings_item.svelte";
	import FileSuggester from "./suggesters/file_suggester.svelte";

	let {
		parent,
		vaultFolder,
	}: {
		parent: SyncthingSettingTab;
		/** The vault's Syncthing folder, a reason it is unknown, or `undefined` while loading. */
		vaultFolder: VaultFolder | Failure | undefined;
	} = $props();

	const IGNORE_FILE = ".stignore";
	const adapter = $derived(parent.app.vault.adapter);
	const template = $derived(obsidianIgnoreTemplate(parent.app.vault.configDir));
	let selectedFile = $state("");
	let typedPattern = $state("");
	let patterns: string[] = $state([]);
	/** Edits run one after another, so each one reads what the previous wrote. */
	let queue: Promise<unknown> = Promise.resolve();

	const known = $derived(
		vaultFolder !== undefined && !(vaultFolder instanceof Failure) ? vaultFolder : undefined
	);
	/** The folder starts above the vault, so its .stignore is outside the vault. */
	const outsideFolder = $derived(known?.vaultPath ? known : undefined);
	/** Whether the vault's position in a chosen folder is unknown. */
	const positionUnknown = $derived(known !== undefined && known.vaultPath === undefined);

	async function read(): Promise<IgnoreFile> {
		if (!(await adapter.exists(IGNORE_FILE))) return IgnoreFile.parse("");
		return IgnoreFile.parse(await adapter.read(IGNORE_FILE));
	}

	async function refresh() {
		try {
			patterns = (await read()).patterns();
		} catch (error) {
			new Notice(`Could not read ${IGNORE_FILE}: ${error}`);
		}
	}

	function change(edit: (file: IgnoreFile) => IgnoreFile | Failure): Promise<boolean> {
		const run = queue.then(async () => {
			try {
				const edited = edit(await read());
				if (edited instanceof Failure) {
					new Notice(edited.message);
					return false;
				}
				await adapter.write(IGNORE_FILE, edited.toString());
			} catch (error) {
				new Notice(`Could not change ${IGNORE_FILE}: ${error}`);
				return false;
			}
			await refresh();
			return true;
		});
		queue = run;
		return run;
	}

	async function addFile() {
		const path = selectedFile.trim().replace(/^\/+/, "");
		const added = await change((file) =>
			path ? file.add(file.patternFor(path, Platform.isWin)) : file.add("")
		);
		if (added) selectedFile = "";
	}

	async function addPattern() {
		if (await change((file) => file.add(typedPattern.trim()))) typedPattern = "";
	}

	onMount(refresh);
</script>

<ObsidianSettingsItem name="Syncthing Ignored Files" heading={true} />
{#if outsideFolder}
	<ObsidianSettingsItem name="Ignored files are set outside the vault">
		<svelte:fragment slot="description">
			The vault is inside the Syncthing folder "{outsideFolder.folder.label ||
				outsideFolder.folder.id}" at {outsideFolder.folder.path}, so the
			folder's <code>{IGNORE_FILE}</code> is outside the vault. Edit it in
			the Syncthing GUI, and anchor patterns at
			<code>/{outsideFolder.vaultPath}/</code>.
		</svelte:fragment>
	</ObsidianSettingsItem>
{:else if vaultFolder === undefined}
	<ObsidianSettingsItem
		name="Looking for the vault's Syncthing folder…"
		description="The ignored files can be edited once it is known whether the vault is the folder's root."
	/>
{:else}
	<ObsidianSettingsItem>
		<svelte:fragment slot="name">
			Manage the ignored files and patterns in <code>{IGNORE_FILE}</code>
		</svelte:fragment>
		<svelte:fragment slot="description">
			<p>
				Files that Syncthing does not sync. Syncthing does not sync
				<code>{IGNORE_FILE}</code> itself, so each device keeps its
				own. New patterns go at the end, so earlier ones, including
				<code>!</code> exceptions, still apply first. See the
				<a href="https://docs.syncthing.net/users/ignoring.html" target="_blank"
					>Syncthing documentation</a
				>.
			</p>
			{#if vaultFolder instanceof Failure || positionUnknown}
				<p class="mod-warning">
					{vaultFolder instanceof Failure
						? vaultFolder.message
						: "Where the vault is in the chosen folder is unknown."}
					The file edited here is the one at the vault's root, which
					Syncthing uses when the vault is a folder's root.
				</p>
			{/if}
		</svelte:fragment>
		<svelte:fragment slot="control">
			<div class="container">
				<button onclick={addFile}>Add file/folder</button>
				<FileSuggester
					{parent}
					onChange={(value) => {
						selectedFile = value;
					}}
				/>
				<button onclick={addPattern}>Add pattern</button>
				<input
					type="text"
					bind:value={typedPattern}
					placeholder="Enter a pattern…"
				/>
			</div>
		</svelte:fragment>
	</ObsidianSettingsItem>
	<ObsidianSettingsItem
		name="Ignore Obsidian's per-device files"
		description="Obsidian saves each device's window layout in the vault, so it conflicts whenever two devices have the vault open. This adds: {template
			.slice(1)
			.join(', ')}."
	>
		<button
			slot="control"
			disabled={template.slice(1).every((line) => patterns.includes(line))}
			onclick={() => change((file) => file.add(...template))}
		>
			Add
		</button>
	</ObsidianSettingsItem>

	{#each [...new Set(patterns)] as pattern (pattern)}
		<ObsidianSettingsItem name={pattern}>
			<svelte:fragment slot="control">
				<button onclick={() => change((file) => file.remove(pattern))}>
					Remove
				</button>
			</svelte:fragment>
		</ObsidianSettingsItem>
	{/each}
{/if}

<style>
	.container {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 10px;
	}
</style>
