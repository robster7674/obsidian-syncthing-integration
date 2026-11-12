<script lang="ts">
	import {
		type SyncTypes,
		type SyncthingDevice,
		type SyncthingFolder,
	} from "src/models/entities";
	import { type ConfigurationModal } from "src/views/configuration_modal";
	import { onMount } from "svelte";
	import ObsidianLucideIcon from "./obsidian_lucide_icon.svelte";
	import WarningMessage from "./warning_message.svelte";

	export let parent: ConfigurationModal;
	parent.titleEl.setText("Syncthing Configuration");
	parent.titleEl.style.textAlign = "center";

	let folders: SyncthingFolder[] = [];
	let thisDevice: SyncthingDevice | undefined;
	let otherDevices: SyncthingDevice[] = [];
	let connected = new Set<string>();
	let error = "";
	let loading = true;

	onMount(async () => {
		try {
			({ folders, thisDevice, otherDevices, connected } =
				await parent.plugin.syncthingController.getOverview());
		} catch (failure) {
			error =
				(failure as { message?: unknown })?.message?.toString() ||
				String(failure) ||
				"Syncthing did not answer.";
		}
		loading = false;
	});

	const nameOf = (deviceID: string) =>
		[thisDevice, ...otherDevices].find((device) => device?.deviceID === deviceID)
			?.name || deviceID.slice(0, 7);

	/** The names Syncthing's GUI gives to folder types. */
	const FOLDER_TYPES: Record<SyncTypes, string> = {
		sendreceive: "Send & Receive",
		sendonly: "Send Only",
		receiveonly: "Receive Only",
		receiveencrypted: "Receive Encrypted",
	};

	const sharedWith = (folder: SyncthingFolder) =>
		folder.devices
			.filter((device) => device.deviceID !== thisDevice?.deviceID)
			.map((device) => nameOf(device.deviceID));
</script>

<p>
	What this device's Syncthing is set up to sync. Change it in the
	Syncthing GUI.
</p>

{#if loading}
	<p>Loading…</p>
{:else if error}
	<WarningMessage title="Could not read the configuration" message={error} />
{:else}
	<div class="columns">
		<section>
			<h2>Folders ({folders.length})</h2>
			{#each folders as folder (folder.id)}
				<div class="item">
					<div class="title">
						<ObsidianLucideIcon name="folder" />
						<span>{folder.label || folder.id}</span>
					</div>
					<dl>
						<dt>Path</dt>
						<dd>{folder.path}</dd>
						<dt>Type</dt>
						<dd>{FOLDER_TYPES[folder.type] ?? folder.type}</dd>
						<dt>Shared with</dt>
						<dd>{sharedWith(folder).join(", ") || "No other device"}</dd>
					</dl>
				</div>
			{/each}
		</section>
		<section>
			<h2>This device</h2>
			{#if !thisDevice}
				<p>
					Syncthing's own device ID is not among its configured
					devices, so this device cannot be told apart.
				</p>
			{:else}
				<div class="item">
					<div class="title">
						<ObsidianLucideIcon name="hard-drive" />
						<span>{thisDevice.name || thisDevice.deviceID.slice(0, 7)}</span>
					</div>
					<dl>
						<dt>Device ID</dt>
						<dd>{thisDevice.deviceID}</dd>
					</dl>
				</div>
			{/if}
			<h2>Other devices ({otherDevices.length})</h2>
			{#each otherDevices as device (device.deviceID)}
				<div class="item">
					<div class="title">
						<ObsidianLucideIcon name="hard-drive" />
						<span>{device.name || device.deviceID.slice(0, 7)}</span>
						<span class="state">
							{device.paused
								? "Paused"
								: connected.has(device.deviceID)
									? "Connected"
									: "Disconnected"}
						</span>
					</div>
					<dl>
						<dt>Device ID</dt>
						<dd>{device.deviceID}</dd>
						<dt>Addresses</dt>
						<dd>{device.address.join(", ")}</dd>
					</dl>
				</div>
			{/each}
		</section>
	</div>
{/if}

<style>
	.columns {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18em, 1fr));
		gap: 1em;
	}
	.item {
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		padding: 0.5em 0.75em;
		margin-bottom: 0.5em;
	}
	.title {
		display: flex;
		gap: 0.5em;
		align-items: center;
		font-weight: var(--font-semibold);
	}
	.state {
		margin-left: auto;
		font-weight: normal;
		color: var(--text-muted);
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25em 1em;
		margin: 0.5em 0 0;
	}
	dt {
		color: var(--text-muted);
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
