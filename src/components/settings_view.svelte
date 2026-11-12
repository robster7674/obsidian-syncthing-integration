<script lang="ts">
	import { Notice, Platform } from "obsidian";
	import { type VaultFolder } from "src/controllers/vault_folder";
	import { type SyncthingFolder } from "src/models/entities";
	import { Failure } from "src/models/failures";
	import {
		ANDROID_BASE_URL,
		defaultBaseUrl,
		parseBaseUrl,
		sendsKeyInClear,
	} from "src/settings";
	import { ConfigurationModal } from "src/views/configuration_modal";
	import { ObsidianLogo, SyncthingLogo } from "src/views/logos";
	import { type SyncthingSettingTab } from "src/views/settings_tab";
	import { onMount } from "svelte";
	import ObsidianLucideIcon from "./obsidian_lucide_icon.svelte";
	import ObsidianSettingsItem from "./obsidian_settings_item.svelte";
	import ObsidianToggle from "./obsidian_toggle.svelte";
	import SyncthingIgnoreFiles from "./syncthing_ignore_files.svelte";
	export let parent: SyncthingSettingTab;
	let hasSyncthing = true;
	let apiInputType = "password";
	let baseUrl = parent.plugin.device.baseUrl;
	const savedUrl = parseBaseUrl(baseUrl);
	let baseUrlError = savedUrl instanceof Failure ? savedUrl.message : "";

	let folders: SyncthingFolder[] = [];
	let vaultFolder: VaultFolder | Failure | undefined;
	let folderId = parent.plugin.device.folderId;

	let folderRequest = 0;

	/** Asks Syncthing for its folders; only the latest request's answer is kept. */
	async function findFolder() {
		const request = ++folderRequest;
		vaultFolder = undefined;
		try {
			const found = await parent.syncthingController.getVaultFolder();
			if (request !== folderRequest) return;
			({ folders, vaultFolder } = found);
		} catch (error) {
			if (request !== folderRequest) return;
			folders = [];
			vaultFolder = new Failure(
				`The vault's Syncthing folder is unknown: ${(error as Error)?.message ?? error}`
			);
		}
	}
	onMount(findFolder);

	function setFolderId(id: string) {
		folderId = id;
		parent.plugin.device.folderId = id;
		parent.plugin.saveDeviceSettings();
		if (folders.length > 0) {
			folderRequest++;
			vaultFolder = parent.syncthingController.matchVaultFolder(folders);
		} else {
			void findFolder();
		}
	}

	async function checkSyncthing() {
		if (!Platform.isDesktopApp) return;
		hasSyncthing = await parent.syncthingController.hasSyncthing();
	}
	onMount(checkSyncthing);

	let cliPath = parent.plugin.device.cliPath;

	function setCliPath(input: HTMLInputElement) {
		cliPath = input.value.trim();
		input.value = cliPath;
		parent.plugin.device.cliPath = cliPath;
		parent.plugin.saveDeviceSettings();
		void checkSyncthing();
	}

	let apiKey = parent.plugin.getApiKey();

	async function getAPIkey() {
		const key = await parent.syncthingController.getAPIKey();
		if (key instanceof Failure) {
			new Notice(key.message);
			return;
		}
		apiKey = key;
	}

	function storeApiKey(key: string, input?: HTMLInputElement) {
		try {
			parent.plugin.setApiKey(key);
			apiKey = key;
			void findFolder();
		} catch (error) {
			new Notice(`Could not store the API key in Obsidian's keychain: ${error}`);
		}
		if (input) input.value = apiKey;
	}

	let hasSharedSettings = parent.plugin.hasSharedSettings();

	async function removeSharedSettings() {
		try {
			await parent.plugin.removeSharedSettings();
			hasSharedSettings = false;
		} catch (error) {
			new Notice((error as Error).message);
		}
	}

	function setBaseUrl(input: HTMLInputElement) {
		const parsed = parseBaseUrl(input.value);
		if (parsed instanceof Failure) {
			baseUrlError = parsed.message;
			return;
		}
		baseUrlError = "";
		baseUrl = parsed;
		input.value = parsed;
		parent.plugin.device.baseUrl = parsed;
		parent.plugin.saveDeviceSettings();
		void checkSyncthing();
		void findFolder();
	}
</script>

<!-- Banner -->
<p class="banner">
	<a href="https://github.com/LBF38/obsidian-syncthing-integration">
		<img src={SyncthingLogo} alt="Syncthing's logo" />
		<img src={ObsidianLogo} alt="Obsidian's logo" />
	</a>
</p>

<!-- Description / Purpose -->
<ObsidianSettingsItem name="Syncthing Integration for Obsidian" heading={true}>
	<p slot="description">
		This plugin allows you to sync your vault with Syncthing. It allows you
		to manage the sync process from within Obsidian. You can only manage the
		folder you are in. To use this plugin, you need to have Syncthing
		installed on your device. You can find more information about Syncthing
		here:
		<a href="https://syncthing.net">https://syncthing.net </a>
	</p>
</ObsidianSettingsItem>

<!-- Syncthing ERROR NOT FOUND -->
{#if Platform.isDesktopApp && !hasSyncthing}
	<ObsidianSettingsItem
		heading={true}
		error={true}
		name="Syncthing is not found"
	>
		<svelte:fragment slot="description">
			Neither the Syncthing program nor its API answered. Install
			Syncthing from
			<a href="https://syncthing.net/downloads" target="_blank">
				https://syncthing.net/downloads
			</a>, set the path to its program, or check the URL and API key below.
		</svelte:fragment>
		<button slot="control" on:click={checkSyncthing}>Check again</button>
	</ObsidianSettingsItem>
{/if}

<!-- Mobile -->
{#if Platform.isMobileApp}
	<ObsidianSettingsItem name="On mobile" heading={true}>
		<svelte:fragment slot="description">
			Conflicts are shown and resolved from the files in your vault, so
			they work without a connection to Syncthing.
			{#if Platform.isIosApp}
				On iOS the plugin does not connect to a Syncthing app on the
				device. The settings below can point to a Syncthing elsewhere,
				served over HTTPS with a trusted certificate.
			{:else}
				Syncthing-Fork serves its API at {ANDROID_BASE_URL} with a
				self-signed certificate, which Obsidian may refuse. A Syncthing
				elsewhere, served over HTTPS with a trusted certificate, works.
			{/if}
		</svelte:fragment>
	</ObsidianSettingsItem>
{/if}

<!-- API Key setting -->
<ObsidianSettingsItem name="Syncthing API Key" heading={true}>
	<svelte:fragment slot="description">
		The API key of the Syncthing on this device, from its GUI under
		Actions → Settings → General. It is kept in Obsidian's keychain on this
		device only, so each device can use its own key.
	</svelte:fragment>
	<svelte:fragment slot="control">
		<input
			type={apiInputType}
			name="apikey"
			id="apikey"
			value={apiKey}
			placeholder="Enter your API key here..."
			on:change={(event) =>
				storeApiKey(event.currentTarget.value.trim(), event.currentTarget)}
		/>
		{#if !apiKey}
			<button on:click={getAPIkey}> Get API key </button>
		{:else}
			<button
				on:click={() => {
					apiInputType =
						apiInputType === "password" ? "text" : "password";
				}}
			>
				{#if apiInputType === "password"}
					<ObsidianLucideIcon name="eye" />
				{:else}
					<ObsidianLucideIcon name="eye-off" />
				{/if}
			</button>
			<button
				on:click={() => storeApiKey("")}
			>
				<ObsidianLucideIcon name="eraser" />
			</button>
		{/if}
	</svelte:fragment>
</ObsidianSettingsItem>

{#if hasSharedSettings}
	<ObsidianSettingsItem
		name="Settings shared by version 2.4.0"
		description="data.json, which Syncthing syncs to all your devices, still holds the API key and Syncthing URL that version 2.4.0 shared. They stay there so that each device can take them over when it updates. Remove them once every device shows this setting."
	>
		<button slot="control" on:click={removeSharedSettings}>
			Remove from data.json
		</button>
	</ObsidianSettingsItem>
{/if}

<!-- Syncthing status -->
<ObsidianSettingsItem name="Syncthing API Status">
	<svelte:fragment slot="control">
		<button
			on:click={async () => {
				parent.syncthingController
					.getAPIStatus()
					.then((status) => {
						new Notice(`Syncthing Ping : ${status}`);
					})
					.catch((error) => {
						new Notice((error as Error).message);
					});
			}}
		>
			Check API Status
		</button>
	</svelte:fragment>
</ObsidianSettingsItem>

{#if Platform.isDesktopApp}
	<ObsidianSettingsItem
		name="Syncthing program"
		description="The path to the Syncthing program on this device, used to read the API key. Leave it empty to use the Syncthing app on macOS or syncthing on the PATH."
	>
		<input
			slot="control"
			type="text"
			placeholder="syncthing"
			value={cliPath}
			on:change={(event) => setCliPath(event.currentTarget)}
		/>
	</ObsidianSettingsItem>
	<ObsidianSettingsItem name="Syncthing CLI Status">
		<svelte:fragment slot="control">
			<button
				on:click={async () => {
					parent.syncthingController
						.getCLIStatus()
						.then((status) => {
							new Notice(status);
						})
						.catch((error) => {
							new Notice((error as Error).message);
						});
				}}
			>
				Check CLI Status
			</button>
		</svelte:fragment>
	</ObsidianSettingsItem>
{/if}

<!-- Syncthing URL -->
<ObsidianSettingsItem name="Syncthing URL" heading={true} />
<ObsidianSettingsItem
	name="Syncthing URL"
	description="Where Syncthing's GUI is served for this device, including any reverse-proxy path, for example https://example.org/syncthing. The plugin sends its API requests there."
>
	<div slot="control" class="base-url">
		<input
			type="url"
			placeholder={defaultBaseUrl()}
			value={baseUrl}
			aria-invalid={baseUrlError !== ""}
			on:change={(event) => setBaseUrl(event.currentTarget)}
		/>
		{#if baseUrlError}
			<span class="mod-warning">{baseUrlError}</span>
		{:else if sendsKeyInClear(baseUrl)}
			<span class="mod-warning">
				This URL is not encrypted, so the API key travels over the
				network in clear text. Use https:// for a remote Syncthing.
			</span>
		{/if}
	</div>
</ObsidianSettingsItem>
<ObsidianSettingsItem
	name="Open Syncthing GUI"
	description="Open the Syncthing GUI in your browser. If the GUI asks for a user name and password, enter them there."
>
	<button
		slot="control"
		class="mod-cta"
		on:click={() => {
			const url = parseBaseUrl(parent.plugin.device.baseUrl);
			if (url instanceof Failure) {
				new Notice(url.message);
				return;
			}
			// eslint-disable-next-line no-undef
			open(url);
		}}
	>
		<ObsidianLucideIcon name="link" />
	</button>
</ObsidianSettingsItem>

<!-- Vault folder -->
<ObsidianSettingsItem name="Syncthing folder of this vault">
	<svelte:fragment slot="description">
		{#if vaultFolder === undefined}
			Looking for the folder…
		{:else if vaultFolder instanceof Failure}
			<span class="mod-warning">{vaultFolder.message}</span>
		{:else}
			"{vaultFolder.folder.label || vaultFolder.folder.id}" at
			{vaultFolder.folder.path}{vaultFolder.vaultPath
				? `, with the vault in ${vaultFolder.vaultPath}`
				: ""}{vaultFolder.chosen ? " (chosen)" : " (found by its path)"}.
			{#if vaultFolder.vaultPath === undefined}
				<span class="mod-warning">
					The vault's path is not inside this folder's path, so where the
					vault is in the folder is unknown.
				</span>
			{/if}
		{/if}
	</svelte:fragment>
	<select
		slot="control"
		class="dropdown"
		value={folderId}
		on:change={(event) => setFolderId(event.currentTarget.value)}
	>
		<option value="">Find by path</option>
		{#each folders as folder (folder.id)}
			<option value={folder.id}>{folder.label || folder.id}</option>
		{/each}
		{#if folderId && !folders.some((folder) => folder.id === folderId)}
			<option value={folderId}>{folderId}</option>
		{/if}
	</select>
</ObsidianSettingsItem>

<!-- Configuration display -->
<ObsidianSettingsItem name="Syncthing Configuration" heading={true} />
<ObsidianSettingsItem
	name="Folders and devices"
	description="Show the folders and devices this device's Syncthing is set up with."
>
	<button
		on:click={() => new ConfigurationModal(parent.app, parent.plugin).open()}
		slot="control"
	>
		<ObsidianLucideIcon name="cog" />
	</button>
</ObsidianSettingsItem>

<!-- Conflicts in hidden folders -->
<ObsidianSettingsItem
	name="Look for conflicts in hidden folders"
	description="Also list Syncthing conflicts in folders whose names start with a dot, such as the configuration folder, which Obsidian does not show. Obsidian's trash and Syncthing's own folders are not searched."
>
	<ObsidianToggle
		slot="control"
		value={parent.plugin.settings.hiddenConflicts}
		callback={async (value) => {
			parent.plugin.settings.hiddenConflicts = value;
			await parent.plugin.saveSettings();
		}}
	/>
</ObsidianSettingsItem>

<!-- Ignoring files -->
<SyncthingIgnoreFiles {parent} {vaultFolder} />

<!-- Plugin developer mode -->
{#if Platform.isDesktopApp}
	<ObsidianSettingsItem name="Plugin's Dev Mode" heading={true} />
	<ObsidianSettingsItem
		name="Enable Plugin's Developer Mode"
		description="For the moment, the developer mode contains a Syncthing conflicts generator. It allows to test the plugin's conflict resolution system."
	>
		<svelte:fragment slot="description">
			For the moment, the developer mode contains a Syncthing conflicts
			generator.
			<br />
			It allows to test the plugin's conflict resolution system.
		</svelte:fragment>
		<ObsidianToggle
			value={parent.plugin.settings.devMode}
			callback={async (value) => {
				parent.plugin.settings.devMode = value;
				await parent.plugin.saveSettings();
				// TODO: Refactor using the unload command workaround.
				parent.plugin.onunload();
				parent.plugin.onload();
			}}
			slot="control"
		/>
	</ObsidianSettingsItem>
{/if}

<!-- Footer -->
<ObsidianSettingsItem heading={true}>
	<div slot="control" class="footer">
		<button
			on:click={() => {
				// eslint-disable-next-line no-undef
				open("https://github.com/sponsors/LBF38");
			}}
		>
			<ObsidianLucideIcon name="heart" />
			Sponsor
		</button>
		<button
			on:click={() => {
				// eslint-disable-next-line no-undef
				open("https://github.com/LBF38/obsidian-syncthing-integration");
			}}
		>
			<ObsidianLucideIcon name="github" />
			GitHub repo
		</button>
		<button
			on:click={() => {
				// eslint-disable-next-line no-undef
				open(
					"https://github.com/LBF38/obsidian-syncthing-integration/issues/new/choose",
				);
			}}
		>
			<ObsidianLucideIcon name="bug" />
			Report a bug
		</button>
	</div>
</ObsidianSettingsItem>

<style>
	.banner {
		display: flex;
		justify-content: center;
		align-items: center;
		margin: 0;
		padding: 0;
	}
	.banner a {
		text-decoration-line: none;
	}
	.banner img {
		height: 2em;
	}
	.base-url {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.25em;
	}
	.footer {
		display: flex;
		justify-content: space-between;
		width: 100%;
	}
	.footer button {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: 0.5em;
		justify-content: space-around;
	}
</style>
