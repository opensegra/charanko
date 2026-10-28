import { type Dispatcher } from 'undici';

export interface HttpAgentOptions {
	userAgent?: string;

	enableSniSpoofing?: boolean;

	proxy?: ProxyOptions;

	dispatcher?: Dispatcher;
}

export interface ProxyOptions {
	type: 'http' | 'https' | 'socks4' | 'socks5';

	host: string;

	port: number;

	username?: string;

	password?: string;
}

/** Request headers, retries, timeout and referer. */
export interface HttpFetchOptions extends HttpAgentOptions {
	/** Abort signal honored by every request it reaches. */
	signal?: AbortSignal;

	/** Extra request headers. */
	headers?: Record<string, string>;

	/** Request timeout in milliseconds. */
	timeoutMs?: number;

	/** Retries per failed request. */
	retries?: number;

	/** Referer URL. */
	referer?: string;

	/** Form fields for POST requests. */
	formData?: Record<string, string>;
}

export interface FetchResult {
	html: string;
	buffer: Buffer;
	finalUrl: string;
	status: number;
	ok: boolean;
	headers: Record<string, string>;
}
