<script lang="ts">
	import { Notice } from "obsidian";
	import { IgnoreFile, obsidianIgnoreTemplate } from "src/controllers/stignore";
	import { type VaultFolder } from "src/controllers/vault_folder";
	import { Failure } from "src/models/failures";
	import { type SyncthingSettingTab } from "src/views/settings_tab";
	import { onMount } from "svelte";
	import ObsidianSettingsItem from "./obsidian_settings_item.svelte";
	import FileSuggester from "./suggesters/file_suggester.svelte";

	export let parent: SyncthingSettingTab;
	/** The vault's Syncthing folder, a reason it is unknown, or `undefined` while loading. */
	export let vaultFolder: VaultFolder | Failure | undefined;

	const IGNORE_FILE = ".stignore";
	const adapter = parent.app.vault.adapter;
	const template = obsidianIgnoreTemplate(parent.app.vault.configDir);
	let selectedFile = "";
	let typedPattern = "";
	let patterns: string[] = [];

	/** The vault is inside the folder, so the folder's .stignore is outside the vault. */
	$: outsideVault =
		vaultFolder !== undefined &&
		!(vaultFolder instanceof Failure) &&
		vaultFolder.vaultPath !== "";

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

	async function change(edit: (file: IgnoreFile) => IgnoreFile | Failure): Promise<boolean> {
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
	}

	async function addFile() {
		const path = selectedFile.trim().replace(/^\/+/, "");
		if (await change((file) => file.add(path ? `/${path}` : ""))) selectedFile = "";
	}

	async function addPattern() {
		if (await change((file) => file.add(typedPattern.trim()))) typedPattern = "";
	}

	onMount(refresh);
</script>

<ObsidianSettingsItem name="Syncthing Ignored Files" heading={true} />
{#if outsideVault && !(vaultFolder instanceof Failure) && vaultFolder}
	<ObsidianSettingsItem name="Ignored files are set outside the vault">
		<svelte:fragment slot="description">
			The vault is inside the Syncthing folder "{vaultFolder.folder.label ||
				vaultFolder.folder.id}" at {vaultFolder.folder.path}, so the
			folder's <code>{IGNORE_FILE}</code> is outside the vault. Edit it in
			the Syncthing GUI, and anchor patterns at
			<code>/{vaultFolder.vaultPath}/</code>.
		</svelte:fragment>
	</ObsidianSettingsItem>
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
			{#if vaultFolder instanceof Failure}
				<p class="mod-warning">
					{vaultFolder.message} The file edited here is the one at the
					vault's root, which Syncthing uses when the vault is a folder's
					root.
				</p>
			{/if}
		</svelte:fragment>
		<svelte:fragment slot="control">
			<div class="container">
				<button on:click={addFile}>Add file/folder</button>
				<FileSuggester
					{parent}
					onChange={(value) => {
						selectedFile = value;
					}}
				/>
				<button on:click={addPattern}>Add pattern</button>
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
			on:click={() => change((file) => file.add(...template))}
		>
			Add
		</button>
	</ObsidianSettingsItem>

	{#each [...new Set(patterns)] as pattern (pattern)}
		<ObsidianSettingsItem name={pattern}>
			<svelte:fragment slot="control">
				<button on:click={() => change((file) => file.remove(pattern))}>
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
