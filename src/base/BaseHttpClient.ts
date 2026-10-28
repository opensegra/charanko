import { checkServerIdentity } from 'tls';
import { Agent, type Dispatcher, type Headers, ProxyAgent, fetch as undiciFetch } from 'undici';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib';
import { type InumakiProgress } from '../../../inumaki/dist';
import { HEADER_PRESETS } from '../constants/headers';
import { type DownloadOptions, type HttpAgentOptions, type HttpFetchOptions } from '../contracts';

/** Shared transport: browser-like headers, cookies, decoding, proxy/SNI dispatchers and retries. */
export abstract class BaseHttpClient {
	constructor(protected readonly progress: InumakiProgress) {}

	protected readonly cookieJar = new Map<string, Map<string, string>>();

	protected static readonly CHROME_CIPHERS = [
		'TLS_AES_128_GCM_SHA256',
		'TLS_AES_256_GCM_SHA384',
		'TLS_CHACHA20_POLY1305_SHA256',
		'ECDHE-ECDSA-AES128-GCM-SHA256',
		'ECDHE-RSA-AES128-GCM-SHA256',
		'ECDHE-ECDSA-AES256-GCM-SHA384',
		'ECDHE-RSA-AES256-GCM-SHA384',
		'ECDHE-ECDSA-CHACHA20-POLY1305',
		'ECDHE-RSA-CHACHA20-POLY1305',
		'ECDHE-RSA-AES128-SHA',
		'ECDHE-RSA-AES256-SHA',
		'AES128-GCM-SHA256',
		'AES256-GCM-SHA384',
		'AES128-SHA',
		'AES256-SHA'
	].join(':');

	// connection pools are process-wide so keep-alive works across clients; closeAgents() disposes them
	private static sharedAgent: Agent | null = null;
	private static readonly spoofAgents = new Map<string, Agent>();
	private static readonly proxyAgents = new Map<string, ProxyAgent>();

	protected get defaultAgent(): Agent {
		BaseHttpClient.sharedAgent ??= new Agent({
			connect: {
				ciphers: BaseHttpClient.CHROME_CIPHERS,
				honorCipherOrder: true,
				minVersion: 'TLSv1.2',
				maxVersion: 'TLSv1.3',
				ALPNProtocols: ['h2', 'http/1.1']
			}
		});

		return BaseHttpClient.sharedAgent;
	}

	/** Agent that sends `www.google.com` as SNI to pass DPI filters, still verifying the real host's certificate. */
	protected spoofAgentFor(hostname: string): Agent {
		const cached = BaseHttpClient.spoofAgents.get(hostname);

		if (cached) return cached;

		const agent = new Agent({
			connect: {
				ciphers: BaseHttpClient.CHROME_CIPHERS,
				honorCipherOrder: true,
				minVersion: 'TLSv1.2',
				maxVersion: 'TLSv1.3',
				ALPNProtocols: ['h2', 'http/1.1'],
				servername: 'www.google.com',
				checkServerIdentity: (_servername, cert) => checkServerIdentity(hostname, cert)
			}
		});

		BaseHttpClient.spoofAgents.set(hostname, agent);

		return agent;
	}

	/** Closes every shared connection pool; a new one is created on the next request. */
	public static async closeAgents(): Promise<void> {
		const pools: Array<Agent | ProxyAgent> = [
			...(BaseHttpClient.sharedAgent ? [BaseHttpClient.sharedAgent] : []),
			...BaseHttpClient.spoofAgents.values(),
			...BaseHttpClient.proxyAgents.values()
		];

		BaseHttpClient.sharedAgent = null;
		BaseHttpClient.spoofAgents.clear();
		BaseHttpClient.proxyAgents.clear();

		await Promise.allSettled(pools.map((pool) => pool.close()));
	}

	/** Instance alias for {@link BaseHttpClient.closeAgents}. */
	public async closeConnections(): Promise<void> {
		await BaseHttpClient.closeAgents();
	}

	protected browserHeaders(extra: Record<string, string> = {}): Record<string, string> {
		const preset = HEADER_PRESETS[Math.floor(Math.random() * HEADER_PRESETS.length)];

		return { ...preset, ...extra };
	}

	protected hlsHeaders(options: HttpFetchOptions): Record<string, string> {
		return {
			'User-Agent': 'Mozilla/5.0',
			'Accept': '*/*',
			'Referer': options?.referer || '',
			'Origin': options?.referer ? new URL(options.referer).origin : ''
		};
	}

	private dispatcherFor(url: string, options?: HttpAgentOptions): Dispatcher {
		if (options?.dispatcher) return options.dispatcher;

		if (options?.proxy) {
			const { type, host, port, username, password } = options.proxy;
			const auth = username && password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
			const proxyUrl = `${type}://${auth}${host}:${port}`;

			// cached per proxy URL so requests share one keep-alive pool
			const cached = BaseHttpClient.proxyAgents.get(proxyUrl);

			if (cached) return cached;

			const proxyAgent = new ProxyAgent({ uri: proxyUrl });

			BaseHttpClient.proxyAgents.set(proxyUrl, proxyAgent);

			return proxyAgent;
		}

		if (options?.enableSniSpoofing) return this.spoofAgentFor(this.hostnameOf(url));

		return this.defaultAgent;
	}

	private hostnameOf(url: string): string {
		try {
			return new URL(url).hostname;
		} catch {
			return url;
		}
	}

	/** Aborts after `timeoutMs` or when `external` aborts, whichever comes first. */
	protected timeoutSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
		const timeout = AbortSignal.timeout(timeoutMs);

		if (!external) return timeout;

		return AbortSignal.any([external, timeout]);
	}

	/** Short progress label for the target being downloaded: the last path segment of its URL. */
	protected targetLabel(options: DownloadOptions): string | undefined {
		const url = options.target?.url;

		if (!url) return undefined;

		try {
			return new URL(url).pathname.split('/').filter(Boolean).pop() ?? url;
		} catch {
			return url;
		}
	}

	/** Exponential backoff with jitter. */
	protected async backoff(attempt: number): Promise<void> {
		const delay = 300 * 2 ** attempt + Math.random() * 200;

		return new Promise((resolve) => setTimeout(resolve, delay));
	}

	protected async readBody(body: ReadableStream<Uint8Array> | null): Promise<Buffer> {
		if (!body) return Buffer.alloc(0);

		const reader = body.getReader();
		const chunks: Buffer[] = [];

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(Buffer.from(value));
		}

		return Buffer.concat(chunks);
	}

	protected decodeBody(buffer: Buffer, headers: Headers): Buffer {
		const encoding = headers.get('content-encoding')?.toLowerCase();

		if (!encoding) return buffer;

		try {
			if (encoding.includes('gzip')) return gunzipSync(buffer);
			if (encoding.includes('deflate')) return inflateSync(buffer);
			if (encoding.includes('br')) return brotliDecompressSync(buffer);
		} catch {
			return buffer;
		}

		return buffer;
	}

	protected withCookies(url: string, headers: Record<string, string>): Record<string, string> {
		const hostCookies = this.cookieJar.get(new URL(url).hostname);

		if (!hostCookies || hostCookies.size === 0) return headers;

		const cookie = Array.from(hostCookies.entries())
			.map(([name, value]) => `${name}=${value}`)
			.join('; ');

		if (!cookie) return headers;

		return { ...headers, Cookie: cookie };
	}

	protected storeCookies(url: string, headers: Headers): void {
		const host = new URL(url).hostname;
		const existing = this.cookieJar.get(host) ?? new Map<string, string>();

		const cookies = ((headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []) as string[];

		for (const raw of cookies) {
			const [pair] = raw.split(';');
			if (!pair) continue;

			const separator = pair.indexOf('=');
			if (separator <= 0) continue;

			const name = pair.slice(0, separator).trim();
			const value = pair.slice(separator + 1).trim();
			if (!name) continue;

			existing.set(name, value);
		}

		if (existing.size > 0) this.cookieJar.set(host, existing);
	}

	protected withOrigin(headers: Record<string, string>, referer?: string): Record<string, string> {
		if (!referer) return headers;
		if (headers.Origin || headers.origin) return headers;

		try {
			return { ...headers, Origin: new URL(referer).origin };
		} catch {
			return headers;
		}
	}

	protected headerRecord(headers: Headers): Record<string, string> {
		return Object.fromEntries(headers.entries());
	}

	/** The error's code when it is a transient socket or TLS failure. */
	protected transportErrorCode(error: unknown): string | undefined {
		const failure = error as { code?: string; cause?: { code?: string } };
		const code = failure?.code ?? failure?.cause?.code;

		return [
			'ECONNRESET',
			'ECONNREFUSED',
			'ETIMEDOUT',
			'EPIPE',
			'UND_ERR_SOCKET',
			'UND_ERR_CONNECT_TIMEOUT',
			'UND_ERR_HEADERS_TIMEOUT'
		].find((candidate) => candidate === String(code));
	}

	/** Fetches with the default agent, then the proxy/SNI dispatcher, then a bare fetch on transient failures. */
	public async fetchWithTransportFallback(
		url: string,
		init: Parameters<typeof undiciFetch>[1],
		options: HttpAgentOptions,
		allowFallback: boolean = true
	): ReturnType<typeof undiciFetch> {
		const signal = init?.signal ?? (options as DownloadOptions)?.signal;

		try {
			return await undiciFetch(url, { ...init, signal, dispatcher: this.defaultAgent });
		} catch (error) {
			const code = this.transportErrorCode(error);

			// a caller-requested abort is final, never retry through another transport
			if (signal?.aborted || !allowFallback || !code) throw error;

			this.progress.message(`Transport failure, Retrying with SNI spoof, CODE: ${code}`);

			try {
				return await undiciFetch(url, { ...init, signal, dispatcher: this.dispatcherFor(url, options) });
			} catch (spoofError) {
				this.progress.message(`SNI spoof transport failed, Retry with default, ${spoofError}`);
				return await undiciFetch(url, { ...init, signal });
			}
		}
	}

	public async fetchText(url: string, timeoutMs: number, headers: Record<string, any>, signal?: AbortSignal): Promise<string> {
		return (await fetch(url, { signal: this.timeoutSignal(timeoutMs, signal), headers })).text();
	}

	public async fetchJson(url: string, options: HttpFetchOptions = {}) {
		const referer = options?.referer ?? url;
		const headers = this.withOrigin(this.browserHeaders({ Referer: referer, ...options.headers }), referer);

		try {
			const { headers: responseHeaders, body } = await this.fetchWithTransportFallback(
				url,
				{
					method: 'GET',
					signal: this.timeoutSignal(options?.timeoutMs ?? 30_000, options?.signal),
					headers
				},
				options
			);

			const buffer = this.decodeBody(await this.readBody(body as ReadableStream<Uint8Array>), responseHeaders);

			return JSON.parse(buffer.toString('utf8'));
		} catch (error) {
			const code = this.transportErrorCode(error);

			if (code) this.progress.message(`Transport error occurred: ${code}`);

			throw new Error('JSON parsing failed', { cause: error });
		}
	}
}
