import { type ExceptionPayload } from '../contracts';
import { type ErrorCode } from '../types';

/** Base for every segra-ts exception: a stable `code`, debug `context` and the standard `cause`. */
export class BaseException extends Error {
	public readonly code: ErrorCode;
	public readonly context: Record<string, unknown>;

	constructor({ code, message, context = {}, cause }: ExceptionPayload) {
		super(message, cause === undefined ? undefined : { cause });

		this.name = new.target.name;
		this.code = code;
		this.context = context;
	}

	toJSON() {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			context: this.context,
			cause: this.cause instanceof Error ? this.cause.message : this.cause
		};
	}
}
