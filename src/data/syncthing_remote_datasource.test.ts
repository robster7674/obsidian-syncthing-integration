import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { RestFailure } from "src/models/failures";
import { readFixtureJson } from "../../test/helpers/fixtures";
import { asPlugin, makePlugin } from "../../test/helpers/plugin";
import {
	SyncthingDeviceModel,
	SyncthingFolderModel,
} from "../models/models";
import { endpointUrl, SyncthingFromREST } from "./syncthing_remote_datasource";

const mockRequestUrl = vi.mocked(requestUrl);

function response(body: unknown, status = 200): {
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
	json: unknown;
	text: string;
} {
	return {
		status,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		json: body,
		text: typeof body === "string" ? body : JSON.stringify(body),
	};
}

let rest: SyncthingFromREST;
let plugin: ReturnType<typeof makePlugin>;

beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	plugin = makePlugin([], { api_key: "test-api-key" });
	rest = new SyncthingFromREST(asPlugin(plugin));
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SyncthingFromREST.ping", () => {
	it("returns pong when Syncthing responds", async () => {
		mockRequestUrl.mockResolvedValue(response({ ping: "pong" }));

		await expect(rest.ping()).resolves.toBe("pong");
	});

	it("builds the request from the plugin settings", async () => {
		mockRequestUrl.mockResolvedValue(response({ ping: "pong" }));

		await rest.ping();

		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "http://127.0.0.1:8384/rest/system/ping",
				method: "GET",
				headers: expect.objectContaining({ "X-API-Key": "test-api-key" }),
			}),
		);
	});

	it("keeps the reverse-proxy path of the Syncthing URL", async () => {
		plugin.settings.baseUrl = "https://example.org/syncthing";
		mockRequestUrl.mockResolvedValue(response({ ping: "pong" }));

		await rest.ping();

		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://example.org/syncthing/rest/system/ping",
			}),
		);
	});

	it("sends only the API key header", async () => {
		mockRequestUrl.mockResolvedValue(response({ ping: "pong" }));

		await rest.ping();

		expect(mockRequestUrl.mock.calls[0][0]).toMatchObject({
			headers: { "X-API-Key": "test-api-key" },
		});
		expect(
			Object.keys(
				(mockRequestUrl.mock.calls[0][0] as { headers: object }).headers,
			),
		).toEqual(["X-API-Key"]);
	});

	it("says the API key was refused on HTTP 403", async () => {
		mockRequestUrl.mockResolvedValue(response("CSRF Error", 403));

		await expect(rest.ping()).rejects.toMatchObject({
			message: expect.stringContaining("Access was refused (HTTP 403)"),
		});
	});

	it("rejects with a RestFailure on another HTTP error status", async () => {
		mockRequestUrl.mockResolvedValue(response("Not Found", 404));

		await expect(rest.ping()).rejects.toBeInstanceOf(RestFailure);
	});

	it("says the URL is wrong when the answer is not JSON", async () => {
		mockRequestUrl.mockResolvedValue({
			...response("<a href=...>"),
			get json(): unknown {
				throw new SyntaxError("Unexpected token '<'");
			},
		});

		await expect(rest.ping()).rejects.toMatchObject({
			message: expect.stringContaining("Check the Syncthing URL"),
		});
	});

	it("says Syncthing could not be reached when the request fails", async () => {
		mockRequestUrl.mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));

		await expect(rest.ping()).rejects.toMatchObject({
			message:
				"Could not reach Syncthing at http://127.0.0.1:8384: net::ERR_CONNECTION_REFUSED",
		});
	});

	it("logs neither the API key nor the response", async () => {
		const log = vi.spyOn(console, "log");
		const error = vi.spyOn(console, "error");
		mockRequestUrl.mockResolvedValue(response({ ping: "pong" }));

		await rest.ping();
		mockRequestUrl.mockResolvedValue(response("Forbidden", 403));
		await rest.ping().catch(() => undefined);

		expect(log).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});

	it.each([[{}], [null], [[]], [{ ping: "nope" }]])(
		"says the URL is wrong when the JSON is not a ping answer: %j",
		async (body) => {
			mockRequestUrl.mockResolvedValue(response(body));

			await expect(rest.ping()).rejects.toMatchObject({
				message: expect.stringContaining("Check the Syncthing URL"),
			});
		},
	);

	it("says the URL is wrong when a list holds something other than Syncthing entries", async () => {
		mockRequestUrl.mockResolvedValue(response([{ unrelated: true }]));

		await expect(rest.getAllFolders()).rejects.toBeInstanceOf(RestFailure);
		await expect(rest.getDevices()).rejects.toBeInstanceOf(RestFailure);
	});

	it("says the URL is wrong when a list endpoint does not return a list", async () => {
		mockRequestUrl.mockResolvedValue(response({}));

		await expect(rest.getAllFolders()).rejects.toBeInstanceOf(RestFailure);
		await expect(rest.getDevices()).rejects.toBeInstanceOf(RestFailure);
	});
});

describe("endpointUrl", () => {
	it("joins a base URL with a trailing slash and an endpoint with a query", () => {
		expect(endpointUrl("https://example.org/st/", "/rest/events?since=4")).toBe(
			"https://example.org/st/rest/events?since=4",
		);
	});

	it("sends localhost as 127.0.0.1 on mobile only", () => {
		expect(endpointUrl("http://localhost:8385", "/rest/system/ping", true)).toBe(
			"http://127.0.0.1:8385/rest/system/ping",
		);
		expect(endpointUrl("http://localhost:8385", "/rest/system/ping")).toBe(
			"http://localhost:8385/rest/system/ping",
		);
	});

	it("splits the query at its first question mark only", () => {
		expect(endpointUrl("http://h", "/rest/db/file?folder=a&file=x?y.md")).toBe(
			"http://h/rest/db/file?folder=a&file=x?y.md",
		);
	});
});

describe("SyncthingFromREST.getAllFolders", () => {
	it("parses the folders from the REST response", async () => {
		const folders = readFixtureJson<unknown[]>("folders.json");
		mockRequestUrl.mockResolvedValue(response(folders));

		const result = await rest.getAllFolders();

		expect(result).toHaveLength(2);
		expect(result[0]).toBeInstanceOf(SyncthingFolderModel);
		expect(result[0].id).toBe("default");
		expect(result[1].id).toBe("work");
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({ url: "http://127.0.0.1:8384/rest/config/folders" }),
		);
	});
});

describe("SyncthingFromREST.getDevices", () => {
	it("parses the devices from the REST response", async () => {
		const devices = readFixtureJson<unknown[]>("devices.json");
		mockRequestUrl.mockResolvedValue(response(devices));

		const result = await rest.getDevices();

		expect(result).toHaveLength(2);
		expect(result[0]).toBeInstanceOf(SyncthingDeviceModel);
		expect(result[0].name).toBe("local-device");
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({ url: "http://127.0.0.1:8384/rest/config/devices" }),
		);
	});
});

describe("SyncthingFromREST.getFoldersForDevice", () => {
	it("keeps only the folders shared with the given device", async () => {
		const folders = readFixtureJson<unknown[]>("folders.json");
		const devices = readFixtureJson<unknown[]>("devices.json");
		mockRequestUrl.mockResolvedValue(response(folders));

		const device = SyncthingDeviceModel.fromJSON(
			JSON.stringify(devices[1]),
		);
		const result = await rest.getFoldersForDevice(device);

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("default");
	});
});

