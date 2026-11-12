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
	plugin = makePlugin([], { apiKey: "test-api-key" });
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
		plugin.device.baseUrl = "https://example.org/syncthing";
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

	it("refuses an unusable Syncthing URL without sending anything", async () => {
		plugin.device.baseUrl = "http://user:pw@host:8384";

		await expect(rest.ping()).rejects.toMatchObject({
			message: expect.stringContaining("cannot be used"),
		});
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	it("says to use https:// when Syncthing redirects there", async () => {
		mockRequestUrl.mockResolvedValue(
			response('<a href="https://127.0.0.1:8384/rest/system/ping">Temporary Redirect</a>.'),
		);

		await expect(rest.ping()).rejects.toMatchObject({
			message: expect.stringContaining("Use https://"),
		});
	});

	it("does not blame HTTPS for another redirect", async () => {
		plugin.device.baseUrl = "http://example.org/syncthing";
		mockRequestUrl.mockResolvedValue({
			...response("Found", 302),
			headers: { Location: "http://example.org/login" },
			get json(): unknown {
				throw new SyntaxError("not json");
			},
		});

		await expect(rest.ping()).rejects.toMatchObject({
			message: expect.stringContaining("Check the Syncthing URL"),
		});
	});

	it("suggests http:// when an https:// URL meets plain HTTP", async () => {
		plugin.device.baseUrl = "https://127.0.0.1:8384";
		mockRequestUrl.mockRejectedValue(new Error("net::ERR_SSL_PROTOCOL_ERROR"));

		await expect(rest.ping()).rejects.toMatchObject({
			message: expect.stringContaining("try http://"),
		});
	});

	it("explains a refused self-signed certificate", async () => {
		plugin.device.baseUrl = "https://127.0.0.1:8384";
		mockRequestUrl.mockRejectedValue(new Error("net::ERR_CERT_AUTHORITY_INVALID"));

		await expect(rest.ping()).rejects.toMatchObject({
			message: expect.stringContaining("self-signed certificate"),
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

describe("SyncthingFromREST status endpoints", () => {
	it("reads this device's ID", async () => {
		mockRequestUrl.mockResolvedValue(response({ myID: "AAAAAAA-BBBBBBB" }));

		await expect(rest.getMyID()).resolves.toBe("AAAAAAA-BBBBBBB");
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({ url: "http://127.0.0.1:8384/rest/system/status" }),
		);
	});

	it("keeps only the devices that are connected now", async () => {
		mockRequestUrl.mockResolvedValue(
			response({
				connections: {
					A: { connected: true },
					B: { connected: false },
				},
				total: {},
			}),
		);

		await expect(rest.getConnectedDevices()).resolves.toEqual(new Set(["A"]));
	});

	it("says the URL is wrong when the answers are not Syncthing's", async () => {
		mockRequestUrl.mockResolvedValue(response({}));

		await expect(rest.getMyID()).rejects.toBeInstanceOf(RestFailure);
		await expect(rest.getConnectedDevices()).rejects.toBeInstanceOf(RestFailure);
	});
});

describe("SyncthingFromREST sync state endpoints", () => {
	it("reads a folder's state, counting pull errors only once", async () => {
		mockRequestUrl.mockResolvedValue(
			response({ state: "idle", needFiles: 0, needBytes: 0, errors: 2, pullErrors: 2 }),
		);

		await expect(rest.getFolderStatus("my folder")).resolves.toEqual({
			state: "idle",
			needItems: 0,
			needBytes: 0,
			errors: 2,
			error: "",
		});
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "http://127.0.0.1:8384/rest/db/status?folder=my%20folder",
			}),
		);
	});

	it("reads another device's completion of a folder", async () => {
		mockRequestUrl.mockResolvedValue(
			response({ completion: 99.5, needItems: 1, remoteState: "valid" }),
		);

		await expect(rest.getCompletion("vault", "AAA-BBB")).resolves.toEqual({
			completion: 99.5,
			needItems: 1,
			remoteState: "valid",
		});
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "http://127.0.0.1:8384/rest/db/completion?folder=vault&device=AAA-BBB",
			}),
		);
	});

	it("long-polls the events of the given types and drops malformed ones past the cursor", async () => {
		mockRequestUrl.mockResolvedValue(
			response([
				{ id: 3, type: "StateChanged", data: { to: "idle" } },
				{ id: 4, type: "StateChanged", data: null },
				{ id: "x" },
			]),
		);

		await expect(rest.getEvents(2, 60, ["StateChanged", "FolderSummary"])).resolves.toEqual({
			events: [{ id: 3, type: "StateChanged", data: { to: "idle" } }],
			lastId: 4,
		});
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "http://127.0.0.1:8384/rest/events?since=2&timeout=60&events=StateChanged,FolderSummary",
			}),
		);
	});

	it("says the URL is wrong when a state answer is not Syncthing's", async () => {
		mockRequestUrl.mockResolvedValue(response({}));

		await expect(rest.getFolderStatus("vault")).rejects.toBeInstanceOf(RestFailure);
		await expect(rest.getCompletion("vault", "A")).rejects.toBeInstanceOf(RestFailure);
		await expect(rest.getEvents(0, 0, [])).rejects.toBeInstanceOf(RestFailure);
	});

	it("asks for only the latest event when given a limit", async () => {
		mockRequestUrl.mockResolvedValue(response([]));

		await expect(rest.getEvents(0, 0, ["ConfigSaved"], 1)).resolves.toEqual({
			events: [],
			lastId: 0,
		});
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "http://127.0.0.1:8384/rest/events?since=0&timeout=0&events=ConfigSaved&limit=1",
			}),
		);
	});

	it("reads when a folder was last scanned", async () => {
		mockRequestUrl.mockResolvedValue(
			response({
				vault: { lastScan: "2026-11-12T10:00:00Z", lastFile: {} },
				fresh: { lastScan: "0001-01-01T00:00:00Z" },
			}),
		);

		await expect(rest.getLastScan("vault")).resolves.toBe(Date.parse("2026-11-12T10:00:00Z"));
		await expect(rest.getLastScan("fresh")).resolves.toBeUndefined();
		await expect(rest.getLastScan("missing")).resolves.toBeUndefined();
	});
});
