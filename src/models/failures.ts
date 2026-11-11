export class Failure {
	constructor(public message: string) {}
}

export class RestFailure extends Failure {
	constructor(message?: string) {
		super(message ? message : "Failed to get configuration from REST API");
	}
}
export class CliFailure extends Failure {
	constructor(message?: string) {
		super(message ? message : "Failed to get configuration from CLI");
	}
}

/**
 * The original file of a Syncthing conflict no longer exists.
 */
export class MissingOriginalFailure extends Failure {
	constructor(public originalPath: string) {
		super(`The original file ${originalPath} does not exist.`);
	}
}

