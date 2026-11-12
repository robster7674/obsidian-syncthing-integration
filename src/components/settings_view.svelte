<script lang="ts">
	import { Notice, Platform } from "obsidian";
	import { Failure } from "src/models/failures";
	import { DEFAULT_BASE_URL, parseBaseUrl, sendsKeyInClear } from "src/settings";
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

	onMount(async () => {
		hasSyncthing = await parent.syncthingController.hasSyncthing();
	});

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
{#if !hasSyncthing}
	<ObsidianSettingsItem
		heading={true}
		error={true}
		name="Syncthing is not found"
	>
		<svelte:fragment slot="description">
			Syncthing is not installed or not found on your device. Please
			install it at the following URL:
			<a href="https://syncthing.net/downloads" target="_blank">
				https://syncthing.net/downloads
			</a>
		</svelte:fragment>
	</ObsidianSettingsItem>
	<ObsidianSettingsItem
		name="Retry"
		description="If you want to retry connecting, after setting the API key. This might resolve the issue."
	>
		<svelte:fragment slot="control">
			<button class="mod-cta">Connect to Syncthing via API.</button>
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
		description="data.json, which Syncthing syncs to all your devices, still holds the API key and Syncthing URL that version 2.4.0 shared. They stay there so that each device can take them over when it updates. Remove them once every device runs this version."
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
	<ObsidianSettingsItem name="Syncthing CLI Status">
		<svelte:fragment slot="control">
			<button
				on:click={async () => {
					parent.syncthingController
						.getCLIStatus()
						.then((status) => {
							new Notice(`Syncthing Ping : ${status}`);
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

<!-- Mobile settings -->
{#if Platform.isMobileApp}
	<ObsidianSettingsItem
		name="Warning"
		description="The following settings are in beta. All plugin's features may not currently be available on mobile."
		error={true}
	/>
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
			placeholder={DEFAULT_BASE_URL}
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

<!-- Configuration display -->
<ObsidianSettingsItem name="Syncthing Configuration" heading={true} />
<ObsidianSettingsItem
	name="In construction"
	description="This part is in construction."
>
	<button
		on:click={async (event) => {
			new Notice("This part is in construction.");
			new ConfigurationModal(parent.app, parent.plugin).open();
		}}
		slot="control"
	>
		<ObsidianLucideIcon name="cog" />
	</button>
</ObsidianSettingsItem>

<!-- Ignoring files -->
<SyncthingIgnoreFiles {parent} />

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

<!-- Open Mobile app -->
{#if Platform.isMobileApp}
	<ObsidianSettingsItem name="Open Mobile app" heading={true} />
	<ObsidianSettingsItem
		name="Open Syncthing mobile app"
		description="Open the Syncthing mobile app, if not it opens the Google Play Store page."
	>
		<svelte:fragment slot="control">
			<button
				on:click={() => {
					if (!Platform.isAndroidApp) {
						new Notice(
							"The feature is not implemented for your platform. Please open the Syncthing app for your platform. You can create an issue on GitHub if you want to request this feature.",
							5000,
						);
						return;
					}
					parent.plugin.syncthingFromAndroid.openSyncthing();
				}}
			>
				Open Syncthing on Mobile.
			</button>
		</svelte:fragment>
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
