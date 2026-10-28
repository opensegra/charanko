import { type ExceptionOptions } from '../contracts';
import { ErrorCode } from '../types';
import { BaseException } from './BaseException';

/** Thrown when media can't be downloaded after every host and retry was tried. */
export class DownloadException extends BaseException {
	constructor(
		public readonly url: string,
		public readonly reason: string,
		{ context, cause }: ExceptionOptions = {}
	) {
		super({
			code: ErrorCode.DOWNLOAD_FAILED,
			message: DownloadException.buildMessage(url, reason),
			context: { url, ...context },
			cause
		});
	}

	private static buildMessage(url: string, reason: string): string {
		return `Download failed for ${url}: ${reason}`;
	}
}
