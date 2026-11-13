<script lang="ts">
	import { Setting, type TFile } from "obsidian";
	import { type ConflictsModal } from "src/views/conflicts_modal";
	import { onMount } from "svelte";
	import ConflictItem from "./conflict_item.svelte";
	import WarningMessage from "./warning_message.svelte";
	import { sortFilesBy } from "src/controllers/utils";

	export let parentModal: ConflictsModal;
	export let conflicts: Map<string, TFile[]>;
	export let unrecognised: TFile[] = [];
	let sortSettingContainer: HTMLDivElement;
	let sortOptions = {
		recent: "Most recent",
		old: "Least recent",
		"a-to-z": "A to Z",
		"z-to-a": "Z to A",
	};

	onMount(() => {
		if (!sortSettingContainer) return;
		new Setting(sortSettingContainer)
			.setName("Sort by date")
			.addDropdown((dropdown) => {
				dropdown.addOptions(sortOptions);
				dropdown.onChange((value) => {
					conflicts = sortFilesBy(
						conflicts,
						value as keyof typeof sortOptions,
						parentModal.syncthingController,
					);
				});
			});
		conflicts = sortFilesBy(
			conflicts,
			"recent",
			parentModal.syncthingController,
		);
	});

	parentModal.titleEl.setText("Syncthing Conflicts");
</script>

{#if unrecognised.length > 0}
	<WarningMessage
		title="Unrecognised conflict names"
		message={`These files look like Syncthing conflicts, but their names do not follow Syncthing's format, so they are not listed below: ${unrecognised
			.map((file) => file.path)
			.join(", ")}`}
	/>
{/if}
{#if conflicts.size === 0}
	<p>No conflicts found.</p>
{:else}
	<div bind:this={sortSettingContainer}></div>
	{#each conflicts.keys() as conflictNames, i (conflictNames)}
		{#if i !== 0}
			<div class="divider"></div>
		{/if}
		<ConflictItem
			originalPath={conflictNames}
			conflicts={conflicts.get(conflictNames) ?? []}
			syncthingController={parentModal.syncthingController}
			{parentModal}
		/>
	{/each}
{/if}

<style>
	.divider {
		margin-top: 10px;
		margin-bottom: 10px;
		border-bottom: 2px solid var(--background-modifier-border);
	}
</style>
