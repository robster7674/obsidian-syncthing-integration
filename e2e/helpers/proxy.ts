import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";

export interface Seen {
	path: string;
	headers: IncomingHttpHeaders;
	at: number;
	/** Whether the answer is still pending. */
	open: boolean;
}

/**
 * A reverse proxy serving Syncthing below `prefix`, as nginx would. It records
 * each request, and can instead redirect every request to another origin.
 */
export class ReverseProxy {
	seen: Seen[] = [];
	redirectTo?: string;
	private server?: Server;

	constructor(
		private target: string,
		readonly port: number,
		readonly prefix = "/syncthing",
	) {}

	get url(): string {
		return `http://127.0.0.1:${this.port}${this.prefix}`;
	}

	start(): Promise<void> {
		this.server = createServer((req, res) => {
			const entry: Seen = { path: req.url ?? "", headers: req.headers, at: Date.now(), open: true };
			this.seen.push(entry);
			res.on("close", () => (entry.open = false));
			if (this.redirectTo) {
				res.writeHead(307, { Location: this.redirectTo + (req.url ?? "") }).end();
				return;
			}
			if (!req.url?.startsWith(this.prefix + "/")) {
				res.writeHead(404).end();
				return;
			}
			const upstream = request(
				this.target + req.url.slice(this.prefix.length),
				{ method: req.method, headers: req.headers },
				(answer) => {
					res.writeHead(answer.statusCode ?? 502, answer.headers);
					answer.pipe(res);
				},
			);
			upstream.on("error", () => res.writeHead(502).end());
			req.pipe(upstream);
		});
		return new Promise((resolve) => this.server!.listen(this.port, "127.0.0.1", resolve));
	}

	stop(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.server) return resolve();
			this.server.closeAllConnections();
			this.server.close(() => resolve());
		});
	}

	open(): Seen[] {
		return this.seen.filter((entry) => entry.open);
	}
}

/** Records the requests some other origin receives. */
export class Listener {
	seen: Seen[] = [];
	private server = createServer((req, res) => {
		this.seen.push({ path: req.url ?? "", headers: req.headers, at: Date.now(), open: false });
		res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
	});

	constructor(readonly port: number) {}

	get url(): string {
		return `http://localhost:${this.port}`;
	}

	start(): Promise<void> {
		return new Promise((resolve) => this.server.listen(this.port, "127.0.0.1", resolve));
	}

	stop(): Promise<void> {
		return new Promise((resolve) => this.server.close(() => resolve()));
	}
}
