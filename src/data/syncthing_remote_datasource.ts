import { requestUrl, type RequestUrlResponse } from "obsidian";
import type SyncthingPlugin from "src/main";
import { type SyncthingDevice } from "src/models/entities";
import { RestFailure } from "src/models/failures";
import { SyncthingDeviceModel, SyncthingFolderModel } from "../models/models";

/**
 * REST API of Syncthing.
 * Requests go only to the configured Syncthing URL, and neither the API key
 * nor the responses are logged.
 * @see https://docs.syncthing.net/dev/rest.html
 */
export class SyncthingFromREST {
	constructor(public plugin: SyncthingPlugin) {}

	/**
	 * Ping the Syncthing installation using the REST API.
	 * This is used to check if Syncthing is installed.
	 */
	async ping(): Promise<"pong"> {
		const response = await this.requestEndpoint("/rest/system/ping");
		return response.ping;
	}

	/**
	 * Get all the folders of Syncthing installation using the REST API.
	 * @see https://docs.syncthing.net/rest/config#rest-config-folders-rest-config-devices
	 */
	async getAllFolders(): Promise<SyncthingFolderModel[]> {
		const folders = await this.requestEndpoint("/rest/config/folders");
		return folders.map((folder: unknown) =>
			SyncthingFolderModel.fromJSON(JSON.stringify(folder))
		);
	}

	/**
	 * Get all the folders of Syncthing installation for a specific device using the REST API.
	 * @param device - The device to get the folders for.
	 */
	async getFoldersForDevice(
		device: SyncthingDevice
	): Promise<SyncthingFolderModel[]> {
		const folders = await this.getAllFolders();
		return folders.filter((folder) =>
			folder.devices.some(
				(deviceInFolder) => deviceInFolder.deviceID === device.deviceID
			)
		);
	}

	/**
	 * Get all the devices of Syncthing installation using the REST API.
	 * @see https://docs.syncthing.net/rest/config#rest-config-folders-rest-config-devices
	 */
	async getDevices(): Promise<SyncthingDeviceModel[]> {
		const devices = await this.requestEndpoint("/rest/config/devices");
		return devices.map((device: unknown) =>
			SyncthingDeviceModel.fromJSON(JSON.stringify(device))
		);
	}

	/**
	 * Requests a REST endpoint below the configured Syncthing URL, keeping any reverse-proxy path.
	 * @param endpoint - starts with `/`, and may have a query. @see https://docs.syncthing.net/dev/rest.html
	 * @returns the parsed JSON body.
	 * @throws {RestFailure} with a message saying what to check.
	 */
	private async requestEndpoint(endpoint: string) {
		const url = endpointUrl(this.plugin.settings.baseUrl, endpoint);
		let response: RequestUrlResponse;
		try {
			response = await requestUrl({
				url,
				method: "GET",
				headers: { "X-API-Key": this.plugin.settings.api_key },
				throw: false,
			});
		} catch (error) {
			throw new RestFailure(
				`Could not reach Syncthing at ${this.plugin.settings.baseUrl}: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
		if (response.status === 401 || response.status === 403) {
			throw new RestFailure(
				`Syncthing refused the API key (HTTP ${response.status}). Check the API key set on this device.`
			);
		}
		if (response.status >= 400) {
			throw new RestFailure(
				`Syncthing answered HTTP ${response.status} for ${endpoint}.`
			);
		}
		try {
			return response.json;
		} catch {
			throw new RestFailure(
				`${this.plugin.settings.baseUrl} did not answer like Syncthing's REST API. Check the Syncthing URL.`
			);
		}
	}
}

/**
 * Joins a Syncthing base URL and an endpoint, so `https://host/syncthing` and
 * `/rest/system/ping` give `https://host/syncthing/rest/system/ping`.
 */
export function endpointUrl(baseUrl: string, endpoint: string): string {
	const url = new URL(baseUrl);
	const [path, query] = endpoint.split("?", 2);
	url.pathname = url.pathname.replace(/\/+$/, "") + path;
	url.search = query ?? "";
	return url.href;
}
