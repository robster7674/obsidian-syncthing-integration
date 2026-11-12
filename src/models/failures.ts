export class Failure {
	constructor(public message: string) {}
}

export class RestFailure extends Failure {
	constructor(message?: string) {
		super(message ? message : "The request to Syncthing's REST API failed.");
	}
}
export class CliFailure extends Failure {
	constructor(message?: string) {
		super(message ? message : "The Syncthing command failed.");
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

