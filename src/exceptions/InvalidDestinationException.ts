import { type ExceptionOptions } from '../contracts';
import { ErrorCode } from '../types';
import { BaseException } from './BaseException';

/** Thrown when the output path is invalid, escapes its directory or can't be created. */
export class InvalidDestinationException extends BaseException {
	constructor(
		public readonly path: string,
		public readonly reason: string,
		{ context, cause }: ExceptionOptions = {}
	) {
		super({
			code: ErrorCode.INVALID_DESTINATION,
			message: InvalidDestinationException.buildMessage(path, reason),
			context: { path, ...context },
			cause
		});
	}

	private static buildMessage(path: string, reason: string): string {
		return `Invalid destination ${path}: ${reason}`;
	}
}
