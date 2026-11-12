// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import type { ConfigurationModal } from "src/views/configuration_modal";
import { RestFailure } from "src/models/failures";
import ConfigurationTable from "./configuration_table.svelte";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function parentWith(getOverview: () => Promise<unknown>) {
	return {
		titleEl: document.createElement("div"),
		plugin: { syncthingController: { getOverview } },
	} as unknown as ConfigurationModal;
}

const device = (deviceID: string, name: string, paused = false) => ({
	deviceID,
	name,
	paused,
	address: ["dynamic"],
	introducedBy: "",
	ignoredFolders: [],
});

describe("configuration_table.svelte", () => {
	it("shows the folders and devices Syncthing reports, with their real state", async () => {
		const parent = parentWith(async () => ({
			folders: [
				{
					id: "vault",
					label: "Vault",
					path: "/home/me/Vault",
					type: "sendreceive",
					devices: [{ deviceID: "ME" }, { deviceID: "PHONE" }],
				},
			],
			thisDevice: device("ME", "laptop"),
			otherDevices: [device("PHONE", "phone"), device("NAS", "nas", true), device("OLD", "")],
			connected: new Set(["PHONE"]),
		}));

		const { container } = render(ConfigurationTable, { props: { parent } });
		await vi.waitFor(() => expect(container.textContent).toContain("Vault"));

		const text = container.textContent ?? "";
		expect(text).toContain("/home/me/Vault");
		expect(text).toContain("Send & Receive");
		expect(text).toContain("Shared with");
		expect(text).toMatch(/Shared with\s*phone/);
		expect(text).toMatch(/phone\s*Connected/);
		expect(text).toMatch(/nas\s*Paused/);
		expect(text).toMatch(/OLD\s*Disconnected/);
		expect(text).not.toContain("Not implemented");
		expect(container.querySelectorAll("button")).toHaveLength(0);
	});

	it("says why the configuration could not be read", async () => {
		const parent = parentWith(async () => {
			throw new RestFailure("Access was refused (HTTP 403).");
		});

		const { container } = render(ConfigurationTable, { props: { parent } });
		await vi.waitFor(() =>
			expect(container.querySelector(".callout")?.textContent).toContain(
				"Access was refused",
			),
		);
	});

	it("says when this device cannot be identified", async () => {
		const parent = parentWith(async () => ({
			folders: [],
			thisDevice: undefined,
			otherDevices: [device("A", "a")],
			connected: new Set(),
		}));

		const { container } = render(ConfigurationTable, { props: { parent } });

		await vi.waitFor(() =>
			expect(container.textContent).toContain("cannot be told apart"),
		);
	});

	it("shows a failure that is not an Error", async () => {
		const parent = parentWith(() => Promise.reject("offline"));

		const { container } = render(ConfigurationTable, { props: { parent } });

		await vi.waitFor(() =>
			expect(container.querySelector(".callout")?.textContent).toContain("offline"),
		);
	});
});
