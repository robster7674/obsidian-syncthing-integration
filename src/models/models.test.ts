import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFixture, readFixtureJson } from "../../test/helpers/fixtures";
import {
	ReducedSyncthingDeviceModel,
	SyncthingDeviceModel,
	SyncthingFolderModel,
} from "./models";

beforeEach(() => {
	// The numeric and boolean field checks always report an error (see
	// `validateJsonField`). Silence them to keep the test output readable.
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SyncthingFolderModel", () => {
	it("parses a folder from the folders fixture", () => {
		const folders = readFixtureJson<unknown[]>("folders.json");
		const folder = SyncthingFolderModel.fromJSON(JSON.stringify(folders[0]));

		expect(folder.id).toBe("default");
		expect(folder.label).toBe("Default Folder");
		expect(folder.path).toBe("/home/user/Notes");
		expect(folder.filesystemType).toBe("basic");
		expect(folder.type).toBe("sendreceive");
		expect(folder.maxConflicts).toBe(10);
		expect(folder.devices).toHaveLength(2);
		expect(folder.devices[0].deviceID).toContain("AAAAAAA");
	});

	it("throws when devices are missing", () => {
		expect(() =>
			SyncthingFolderModel.fromJSON(
				readFixture("folder.missing-devices.json"),
			),
		).toThrow(
			"Error validating JSON: devices is not present or is not an array",
		);
	});

	it("throws when the JSON is not an object", () => {
		expect(() => SyncthingFolderModel.fromJSON("null")).toThrow(
			"JSON is not an object or is null",
		);
	});
});

describe("SyncthingDeviceModel", () => {
	it("parses a device", () => {
		const devices = readFixtureJson<unknown[]>("devices.json");
		const device = SyncthingDeviceModel.fromJSON(JSON.stringify(devices[0]));

		expect(device.deviceID).toContain("AAAAAAA");
		expect(device.introducedBy).toBe("");
		expect(device.address).toEqual(["dynamic"]);
		expect(device.paused).toBe(false);
		expect(device.ignoredFolders).toEqual([]);
		expect(device.name).toBe("local-device");
	});

	it("overflows the stack when serialized back to JSON", () => {
		const devices = readFixtureJson<unknown[]>("devices.json");
		const device = SyncthingDeviceModel.fromJSON(JSON.stringify(devices[1]));
		expect(() => device.toJSON()).toThrow(RangeError);
	});

	it("throws when addresses are missing", () => {
		expect(() =>
			SyncthingDeviceModel.fromJSON(
				readFixture("device.missing-addresses.json"),
			),
		).toThrow("Error validating JSON");
	});

	it("throws when the JSON is not an object", () => {
		expect(() => SyncthingDeviceModel.fromJSON("null")).toThrow(
			"JSON is not an object or is null",
		);
	});
});

describe("ReducedSyncthingDeviceModel", () => {
	const raw = JSON.stringify({
		deviceID: "AAAAAAA",
		introducedBy: "",
		encryptionPassword: "",
	});

	it("parses a reduced device", () => {
		const device = ReducedSyncthingDeviceModel.fromJSON(raw);
		expect(device.deviceID).toBe("AAAAAAA");
		expect(device.encryptionPassword).toBe("");
	});

	it("does not implement toJSON", () => {
		const device = ReducedSyncthingDeviceModel.fromJSON(raw);
		expect(() => device.toJSON()).toThrow("Method not implemented.");
	});

	it("throws when the JSON is not an object", () => {
		expect(() => ReducedSyncthingDeviceModel.fromJSON("null")).toThrow(
			"Error parsing JSON",
		);
	});
});
