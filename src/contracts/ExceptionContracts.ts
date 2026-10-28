import { type ErrorCode } from '../types';

export interface ExceptionPayload {
	code: ErrorCode;
	message: string;

	/** Values that help debug the failure, such as the URL or path involved. */
	context?: Record<string, unknown>;

	/** The underlying error, kept as the standard `Error.cause`. */
	cause?: unknown;
}

/** Optional extras accepted by every exception constructor. */
export interface ExceptionOptions {
	context?: Record<string, unknown>;
	cause?: unknown;
}
