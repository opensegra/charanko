import { Readable, Transform, type Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { type Response as UndiciResponse } from 'undici';
import { type InumakiProgress } from 'inumaki';
import { BaseHttpClient } from '../base/BaseHttpClient';
import { type TransferStrategy } from '../base/TransferStrategy';
import { type DownloadOptions, type StreamRequest } from '../contracts';
import { BaseException, DownloadException, NotFoundException } from '../exceptions';
import { KvsResolver } from '../utils';
import { type HlsClient } from './HlsClient';

/** Opens media responses: host and CDN fallbacks, expired-URL refreshes, text redirects and HLS hand-off. */
export class StreamHttpClient extends BaseHttpClient {
	private static readonly DEFAULT_CDN_FALLBACKS = 1;
	private static readonly DEFAULT_REFRESHES = 1;

	constructor(
		private readonly hlsClient: HlsClient,
		protected readonly progress: InumakiProgress,
		private readonly strategy: TransferStrategy
	) {
		super(progress);
	}

	/** Tries the strategy's CDN fallback after a 404, then a refreshed target when the URL expired. */
	private async recover(url: string, status: number, options: DownloadOptions): Promise<StreamRequest | null> {
		const cdnBudget = options.cdnFallbackBudget ?? StreamHttpClient.DEFAULT_CDN_FALLBACKS;
		const refreshBudget = options.refreshBudget ?? StreamHttpClient.DEFAULT_REFRESHES;

		if (status === 404 && cdnBudget > 0 && this.strategy.shouldFallbackOnNotFound(url)) {
			const fallback = this.strategy.fallbackUrl(url);

			if (fallback && fallback !== url) {
				this.progress.message(`CDN fallback (${cdnBudget} left): ${fallback}`);

				return this.requestStream(fallback, { ...options, cdnFallbackBudget: cdnBudget - 1, refreshBudget });
			}
		}

		if (refreshBudget > 0 && options.refresh && options.target && this.strategy.shouldRefresh(url, status)) {
			this.progress.message(`URL expired, refreshing (${refreshBudget} left)...`);

			const refreshed = await options.refresh(options.target);
			const refreshedUrl = refreshed && KvsResolver.resolve(refreshed.url, refreshed.licenseCode);

			if (refreshed && refreshedUrl && refreshedUrl !== url) {
				return this.requestStream(refreshedUrl, {
					...options,
					target: { ...refreshed, url: refreshedUrl },
					referer: refreshed.referer ?? options.referer,
					cdnFallbackBudget: cdnBudget,
					refreshBudget: refreshBudget - 1
				});
			}
		}

		return null;
	}

	/** Releases a response body that won't be read, so undici returns the socket to the pool. */
	private async discardBody(response: UndiciResponse): Promise<void> {
		try {
			await response.body?.cancel();
		} catch {
			// body already consumed or destroyed
		}
	}

	/** Follows a text response the strategy says holds the real media URL. */
	private async resolveTextResponse(
		url: string,
		contentType: string,
		response: UndiciResponse,
		options: DownloadOptions
	): Promise<StreamRequest | null> {
		if (!this.strategy.shouldResolveTextResponse(url, contentType)) return null;

		this.progress.message(`Resolving text response from ${url}`);

		const mediaUrl = this.strategy.mediaUrlFromText(await response.text(), options);

		if (!mediaUrl || mediaUrl === url) throw new Error(`Unable to resolve direct video url from ${url}`);

		this.progress.message('Direct mp4 resolved');
		this.progress.detail('Redirect', mediaUrl);

		return this.requestStream(mediaUrl, options);
	}

	/** Requests `url` and returns a starter that writes its media into a stream. */
	public async requestStream(url: string, options: DownloadOptions): Promise<StreamRequest> {
		const { timeoutMs = 30_000, retries = 3 } = options;

		const candidateUrls = this.strategy.candidateUrls(url);

		let lastError: Error | null = null;

		// every candidate host gets the full retry budget
		for (const candidateUrl of candidateUrls) {
			for (let attempt = 0; attempt <= retries; attempt++) {
				const referer = options.referer ?? candidateUrl;
				const headers = this.withCookies(
					candidateUrl,
					this.withOrigin(this.browserHeaders({ Referer: referer, ...options.headers }), referer)
				);

				try {
					const response = await this.fetchWithTransportFallback(
						candidateUrl,
						{ headers, redirect: 'follow', referrer: options.referer },
						options
					);

					this.storeCookies(candidateUrl, response.headers);

					const finalUrl = response.url || candidateUrl;
					const contentType = response.headers.get('content-type') || '';
					const responseHeaders = this.headerRecord(response.headers);

					if (response.status === 429 || response.status >= 500) {
						await this.discardBody(response);

						lastError = new DownloadException(candidateUrl, `server answered ${response.status}`, {
							context: { status: response.status }
						});

						if (attempt < retries) {
							await this.backoff(attempt);
							continue;
						}

						break;
					}

					if (!response.ok) {
						this.progress.message(`Status ${response.status}: ${candidateUrl}`);

						await this.discardBody(response);

						const recovered = await this.recover(candidateUrl, response.status, options);
						if (recovered) return recovered;

						lastError =
							response.status === 404
								? new NotFoundException(candidateUrl)
								: new DownloadException(candidateUrl, `server answered ${response.status}`, {
										context: { status: response.status }
									});

						// asking again gets the same answer, so move to the next host
						break;
					}

					const resolved = await this.resolveTextResponse(candidateUrl, contentType, response, options);
					if (resolved) return resolved;

					// a compressed body declares its compressed length, so it only counts when unencoded
					const declaredLength = Number(response.headers.get('content-length') ?? 0) || undefined;
					const encoded = Boolean(response.headers.get('content-encoding'));

					if (this.hlsClient.isHlsManifest(contentType, finalUrl)) {
						// resolved once here so a signed media playlist is fetched a single time
						const playlist = await this.hlsClient.resolvePlaylist(await response.text(), finalUrl, timeoutMs, options);

						return {
							finalUrl,
							isFmp4: playlist.isFmp4,
							headers: responseHeaders,
							// segments are always stitched and remuxed, so only an estimate is honest
							estimatedBytes: playlist.estimatedBytes || undefined,
							start: async (stream: Writable, dryRun?: boolean) => {
								if (!dryRun) await this.hlsClient.streamPlaylist(playlist, timeoutMs, stream, options);
							}
						};
					}

					return {
						finalUrl,
						headers: responseHeaders,
						contentLength: encoded ? undefined : declaredLength,
						estimatedBytes: declaredLength,
						start: async (stream: Writable, dryRun?: boolean) => {
							if (!dryRun) return this.pipeWithProgress(response, stream, options);

							this.progress.message(`Dry run, skipping download for ${finalUrl}`);

							await this.discardBody(response);
						}
					};
				} catch (error) {
					lastError = error instanceof Error ? error : new Error(String(error));

					if (attempt < retries) {
						await this.backoff(attempt);
						continue;
					}
				}
			}
		}

		// an exception of ours already names the URL and the failure, so it isn't wrapped again
		if (lastError instanceof BaseException) throw lastError;

		throw new DownloadException(url, lastError?.message ?? 'no candidate URL responded', {
			context: { candidateUrls },
			cause: lastError
		});
	}

	/** Pipes the response body into `stream`, reporting bytes at most every 500 ms. */
	private async pipeWithProgress(response: UndiciResponse, stream: Writable, options: DownloadOptions): Promise<void> {
		const progress = this.progress;

		const key = options.target?.url ?? response.url;
		const label = this.targetLabel(options);
		const totalBytes = Number(response.headers.get('content-length') || 0);

		let bytes = 0;
		let reportedAt = Date.now();

		const meter = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				bytes += chunk.length;

				const now = Date.now();

				if (now - reportedAt > 500) {
					reportedAt = now;
					progress.transfer(key, { label, bytes, totalBytes });
				}

				callback(null, chunk);
			}
		});

		// the signal reaches the byte pump itself, so an abort tears down an in-flight transfer
		await pipeline(Readable.fromWeb(response.body as any), meter, stream, options.signal ? { signal: options.signal } : {});

		progress.transfer(key, { label, bytes, totalBytes });
	}
}
