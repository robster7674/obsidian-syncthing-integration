import { Platform, requestUrl, type RequestUrlResponse } from "obsidian";
import { isRecord } from "src/controllers/utils";
import { Failure } from "src/models/failures";
import { parseBaseUrl } from "src/settings";
import type SyncthingPlugin from "src/main";
import { type SyncthingDevice } from "src/models/entities";
import { RestFailure } from "src/models/failures";
import { SyncthingDeviceModel, SyncthingFolderModel } from "../models/models";

/**
 * REST API of Syncthing.
 * Requests are built only from the configured Syncthing URL, and neither the
 * API key nor the responses are logged.
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
		if (!isRecord(response) || response.ping !== "pong") {
			throw this.notSyncthing();
		}
		return "pong";
	}

	/**
	 * Get all the folders of Syncthing installation using the REST API.
	 * @see https://docs.syncthing.net/rest/config#rest-config-folders-rest-config-devices
	 */
	async getAllFolders(): Promise<SyncthingFolderModel[]> {
		const folders = await this.requestEndpoint("/rest/config/folders");
		if (!Array.isArray(folders)) throw this.notSyncthing();
		try {
			return folders.map((folder) =>
				SyncthingFolderModel.fromJSON(JSON.stringify(folder))
			);
		} catch {
			throw this.notSyncthing();
		}
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
		if (!Array.isArray(devices)) throw this.notSyncthing();
		try {
			return devices.map((device) =>
				SyncthingDeviceModel.fromJSON(JSON.stringify(device))
			);
		} catch {
			throw this.notSyncthing();
		}
	}

	/**
	 * Requests a REST endpoint below the configured Syncthing URL, keeping any reverse-proxy path.
	 * @param endpoint - starts with `/`, and may have a query. @see https://docs.syncthing.net/dev/rest.html
	 * @returns the parsed JSON body.
	 * @throws {RestFailure} with a message saying what to check.
	 */
	private async requestEndpoint(endpoint: string): Promise<unknown> {
		const baseUrl = parseBaseUrl(this.plugin.settings.baseUrl);
		if (baseUrl instanceof Failure) {
			throw new RestFailure(
				`The Syncthing URL cannot be used. ${baseUrl.message}`
			);
		}
		const url = endpointUrl(baseUrl, endpoint, Platform.isMobileApp);
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
				`Could not reach Syncthing at ${baseUrl}: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
		if (response.status === 401 || response.status === 403) {
			throw new RestFailure(
				`Access was refused (HTTP ${response.status}). Check the API key, or the authentication of a reverse proxy in front of Syncthing.`
			);
		}
		if (response.status >= 400) {
			throw new RestFailure(
				`Syncthing answered HTTP ${response.status} for ${endpoint}.`
			);
		}
		try {
			return response.json as unknown;
		} catch {
			throw this.notSyncthing();
		}
	}

	private notSyncthing(): RestFailure {
		return new RestFailure(
			`${this.plugin.settings.baseUrl} did not answer like Syncthing's REST API. Check the Syncthing URL.`
		);
	}
}

/**
 * Joins a Syncthing base URL and an endpoint, so `https://host/syncthing` and
 * `/rest/system/ping` give `https://host/syncthing/rest/system/ping`.
 * On mobile, `localhost` is sent as `127.0.0.1`, which keeps what 2.4.0 did
 * for mobile requests (added in upstream #104, which does not record why).
 */
export function endpointUrl(
	baseUrl: string,
	endpoint: string,
	mobile = false
): string {
	const url = new URL(baseUrl);
	if (mobile && url.hostname === "localhost") url.hostname = "127.0.0.1";
	const queryStart = endpoint.indexOf("?");
	const path = queryStart < 0 ? endpoint : endpoint.slice(0, queryStart);
	url.pathname = url.pathname.replace(/\/+$/, "") + path;
	url.search = queryStart < 0 ? "" : endpoint.slice(queryStart + 1);
	return url.href;
}
