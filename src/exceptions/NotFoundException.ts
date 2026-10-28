import { type ExceptionOptions } from '../contracts';
import { ErrorCode } from '../types';
import { BaseException } from './BaseException';

/** Thrown when the server answers 404 and no fallback or refresh recovered it. */
export class NotFoundException extends BaseException {
	constructor(
		public readonly url: string,
		{ context, cause }: ExceptionOptions = {}
	) {
		super({ code: ErrorCode.NOT_FOUND, message: NotFoundException.buildMessage(url), context: { url, ...context }, cause });
	}

	private static buildMessage(url: string): string {
		return `Not found (404): ${url}`;
	}
}
