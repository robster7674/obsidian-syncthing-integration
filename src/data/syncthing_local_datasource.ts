import { Platform } from "obsidian";
import type SyncthingPlugin from "src/main";
import { CliFailure } from "src/models/failures";

/** Where the syncthing-macos app keeps its Syncthing program. */
export const MACOS_APP_BINARY =
	"/Applications/Syncthing.app/Contents/Resources/syncthing/syncthing";
const TIMEOUT_MS = 10_000;

/**
 * CLI of Syncthing, on desktop only. It is used to check the installation and
 * to read the API key; everything else goes through the REST API.
 * @see https://docs.syncthing.net/users/syncthing.html#syncthing
 */
export class SyncthingFromCLI {
	constructor(private plugin: SyncthingPlugin) {}

	/**
	 * Get the version of Syncthing installation using the CLI.
	 * This is used to check if Syncthing is installed.
	 */
	async getVersion(): Promise<string> {
		return (await this.run(["--version"])).trim();
	}

	/**
	 * Get the API key of Syncthing installation using the CLI.
	 */
	async getAPIkey(): Promise<string> {
		const key = (await this.run(["cli", "config", "gui", "apikey", "get"])).trim();
		if (!key) throw new CliFailure("Syncthing has no API key set.");
		return key;
	}

	/**
	 * The Syncthing program: the one set for this device, else the
	 * syncthing-macos app's, else `syncthing` found on the PATH.
	 */
	binary(): string {
		const configured = this.plugin.device.cliPath.trim();
		if (configured) return configured;
		if (Platform.isMacOS) {
			try {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const { existsSync } = require("fs");
				if (existsSync(MACOS_APP_BINARY)) return MACOS_APP_BINARY;
			} catch {
				// Fall back to the PATH.
			}
		}
		return "syncthing";
	}

	/**
	 * Runs Syncthing with `args`, without a shell, so a path with spaces or
	 * shell characters is passed as it is.
	 * @throws {CliFailure} when the program cannot run or exits with an error.
	 */
	private run(args: string[]): Promise<string> {
		if (Platform.isMobileApp) {
			return Promise.reject(
				new CliFailure("The Syncthing command is not available on mobile.")
			);
		}
		const binary = this.binary();
		if (/\.(bat|cmd)$/i.test(binary)) {
			return Promise.reject(
				new CliFailure(
					`${binary} is a script. Set the path to the Syncthing program itself, such as syncthing.exe.`
				)
			);
		}
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { execFile } = require("child_process");
		return new Promise((resolve, reject) => {
			execFile(
				binary,
				args,
				{ timeout: TIMEOUT_MS, windowsHide: true },
				(
					error: (Error & { code?: unknown }) | null,
					stdout: string,
					stderr: string
				) => {
					if (!error) {
						resolve(String(stdout));
						return;
					}
					const reason =
						error.code !== "ENOENT"
							? String(stderr).trim() || error.message
							: this.plugin.device.cliPath.trim()
								? "no program is at that path. Check the path to Syncthing in the plugin settings."
								: "the program was not found. Set the path to Syncthing in the plugin settings.";
					reject(new CliFailure(`Running ${binary} failed: ${reason}`));
				}
			);
		});
	}
}
