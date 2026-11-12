<script lang="ts">
	import { type App, Notice } from "obsidian";
	import { ConflictResolver } from "src/controllers/conflict_resolution";
	import { type HiddenConflict } from "src/controllers/hidden_conflicts";
	import { formatBytes } from "src/controllers/utils";
	import WarningMessage from "./warning_message.svelte";

	let {
		app,
		conflicts,
		unrecognised = [],
		truncated = false,
	}: {
		app: App;
		conflicts: HiddenConflict[];
		unrecognised?: string[];
		truncated?: boolean;
	} = $props();

	const resolver = $derived(new ConflictResolver(app));
	let resolved: string[] = $state([]);
	/** Originals read again after a resolution changed them, by path; `null` when gone. */
	let reread: Record<string, { size: number; mtime: number } | null> = $state({});
	const remaining = $derived(
		conflicts
			.filter((conflict) => !resolved.includes(conflict.path))
			.map((conflict) =>
				conflict.originalPath in reread
					? { ...conflict, original: reread[conflict.originalPath] ?? undefined }
					: conflict
			)
	);
	let busy = $state(false);

	/** Obsidian and plugins keep these files in memory, and may write them back. */
	const inConfig = (path: string) => path.startsWith(`${app.vault.configDir}/`);

	async function resolve(conflict: HiddenConflict, keep: "original" | "conflict" | "restore") {
		if (busy) return;
		busy = true;
		try {
			if (keep === "original") {
				await resolver.keepHiddenOriginal(conflict.path);
				new Notice(`Kept ${conflict.originalPath}. ${conflict.path} is in the trash.`);
			} else if (keep === "restore") {
				await resolver.restoreHiddenAsOriginal(conflict.path, conflict.originalPath);
				new Notice(`Restored ${conflict.originalPath} from ${conflict.path}.`);
			} else {
				await resolver.keepHiddenConflict(conflict.originalPath, conflict.path, conflict.original);
				new Notice(
					`Kept the conflicting version of ${conflict.originalPath}. The previous version is in the trash.${
						inConfig(conflict.originalPath)
							? " Reload Obsidian now, before Obsidian or a plugin saves its old copy over it."
							: ""
					}`,
					inConfig(conflict.originalPath) ? 0 : undefined
				);
			}
			resolved = [...resolved, conflict.path];
		} catch (error) {
			new Notice(`Could not resolve ${conflict.path}: ${error}`);
		} finally {
			const stat = await app.vault.adapter.stat(conflict.originalPath).catch(() => null);
			reread = {
				...reread,
				[conflict.originalPath]:
					stat?.type === "file" ? { size: stat.size, mtime: stat.mtime } : null,
			};
			busy = false;
		}
	}

	const describe = (size: number, mtime: number) =>
		`${formatBytes(size)}, changed ${new Date(mtime).toLocaleString()}`;
</script>

<h2>In hidden folders</h2>
{#if truncated}
	<WarningMessage
		title="Search stopped early"
		message="The hidden folders hold too many files to search them all, so some conflicts may be missing."
	/>
{/if}
{#if unrecognised.length > 0}
	<WarningMessage
		title="Unrecognised conflict names"
		message={`These files look like Syncthing conflicts, but their names do not follow Syncthing's format: ${unrecognised.join(", ")}`}
	/>
{/if}
{#if remaining.length === 0}
	<p>No conflicts in hidden folders.</p>
{:else}
	<p>
		The vault does not show these files, so they are compared by their
		details only. Obsidian and plugins keep the files in
		<code>{app.vault.configDir}</code> in memory: after keeping a conflict
		there, reload Obsidian.
	</p>
	{#each remaining as conflict (conflict.path)}
		<div class="item">
			<div class="path">{conflict.originalPath}</div>
			<ul>
				<li>
					Original: {conflict.original
						? describe(conflict.original.size, conflict.original.mtime)
						: "missing"}
				</li>
				<li>
					Conflict{conflict.properties.modifiedBy
						? ` from ${conflict.properties.modifiedBy}`
						: ""}: {describe(conflict.size, conflict.mtime)}
				</li>
			</ul>
			<div class="tools">
				{#if conflict.original}
					<button disabled={busy} onclick={() => resolve(conflict, "original")}>
						Keep original
					</button>
					<button disabled={busy} onclick={() => resolve(conflict, "conflict")}>
						Keep conflict
					</button>
				{:else}
					<button disabled={busy} onclick={() => resolve(conflict, "restore")}>
						Restore as original
					</button>
					<button disabled={busy} onclick={() => resolve(conflict, "original")}>
						Move conflict to trash
					</button>
				{/if}
			</div>
		</div>
	{/each}
{/if}

<style>
	.item {
		border-bottom: 1px solid var(--background-modifier-border);
		padding: 0.5em 0;
	}
	.path {
		font-weight: var(--font-semibold);
		overflow-wrap: anywhere;
	}
	.tools {
		display: flex;
		gap: 0.5em;
	}
</style>
