<script lang="ts">
	import { ToggleComponent } from "obsidian";
	import { onMount } from "svelte";

	export let callback: (value: boolean) => unknown;
	export let value = false;

	let element: HTMLDivElement;
	onMount(() => {
		new ToggleComponent(element).setValue(value).onChange(callback);
	});
</script>

<div bind:this={element} {...$$restProps}></div>
