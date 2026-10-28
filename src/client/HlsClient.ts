import { createDecipheriv } from 'crypto';
import { once } from 'events';
import { Readable, type Writable } from 'stream';
import { type InumakiProgress } from '../../../inumaki/dist';
import { BaseHttpClient } from '../base/BaseHttpClient';
import { type DownloadOptions, type HlsKey, type HlsSegment, type HlsVariant, type ResolvedPlaylist } from '../contracts';
import { qualityToHeight } from '../utils';

/** Fetches HLS playlists and stitches their segments: variant choice, AES-128 decryption and fMP4 init segments. */
export class HlsClient extends BaseHttpClient {
	/** Minimum gap between byte-progress events while a segment streams. */
	private static readonly BYTE_REPORT_MS = 250;

	/** Approximate H.264 bitrate ceiling per height, for playlists without `RESOLUTION`. */
	private static readonly BANDWIDTH_BY_HEIGHT: ReadonlyArray<readonly [number, number]> = [
		[2160, 14_000_000],
		[1440, 8_000_000],
		[1080, 4_500_000],
		[720, 2_500_000],
		[480, 1_200_000],
		[360, 700_000],
		[240, 400_000]
	];

	constructor(progress: InumakiProgress) {
		super(progress);
	}

	/** Picks the variant for `options.quality` and parses its media playlist. */
	public async resolvePlaylist(
		manifest: string,
		manifestUrl: string,
		timeoutMs: number,
		options: DownloadOptions
	): Promise<ResolvedPlaylist> {
		const variantUrl = this.selectVariant(manifest, manifestUrl, options);
		const playlistUrl = variantUrl ?? manifestUrl;

		const mediaManifest =
			variantUrl && variantUrl !== manifestUrl
				? await this.fetchText(variantUrl, timeoutMs, this.hlsHeaders(options), options.signal)
				: manifest;

		const initUrl = this.parseInitUrl(mediaManifest, playlistUrl);
		const isFmp4 = Boolean(initUrl);

		const segments = this.parseSegments(mediaManifest, playlistUrl, isFmp4);

		if (!segments.length) throw new Error('No segments found to manifest');

		return { playlistUrl, segments, initUrl, isFmp4, estimatedBytes: this.estimateBytes(manifest, mediaManifest, playlistUrl) };
	}

	/** Writes a resolved playlist, init segment first, into `stream`. */
	public async streamPlaylist(playlist: ResolvedPlaylist, timeoutMs: number, stream: Writable, options: DownloadOptions): Promise<void> {
		const segments: HlsSegment[] = playlist.initUrl
			? [{ url: playlist.initUrl, key: null, sequence: -1 }, ...playlist.segments]
			: playlist.segments;

		await this.stitchSegments(segments, timeoutMs, stream, this.hlsHeaders(options), options);
	}

	/** Whether a response is an HLS playlist. */
	public isHlsManifest(contentType: string, url: string): boolean {
		return contentType.includes('application/vnd.apple.mpegurl') || url.includes('.m3u8');
	}

	/** Every `#EXT-X-STREAM-INF` variant of a master playlist. */
	public parseVariants(manifest: string, base: string): HlsVariant[] {
		const lines = manifest.split('\n').map((line) => line.trim());
		const variants: HlsVariant[] = [];

		for (let index = 0; index < lines.length; index++) {
			const line = lines[index];

			if (!line.includes('#EXT-X-STREAM-INF')) continue;

			const bandwidth = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || '0', 10);
			const resolution = line.match(/RESOLUTION=(\d+)x(\d+)/);
			const uri = this.variantUri(lines, index + 1);

			if (!uri) continue;

			variants.push({
				url: new URL(uri, base).toString(),
				width: resolution ? parseInt(resolution[1], 10) : 0,
				height: resolution ? parseInt(resolution[2], 10) : 0,
				bandwidth
			});
		}

		return variants;
	}

	private parseInitUrl(manifest: string, base: string): string | null {
		const match = manifest.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/);

		return match ? new URL(match[1], base).toString() : null;
	}

	private async fetchSegment(
		url: string,
		headers: Record<string, string>,
		timeoutMs: number,
		signal?: AbortSignal
	): Promise<NodeJS.ReadableStream> {
		const retries = 3;

		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				const response = await fetch(url, { headers, signal: this.timeoutSignal(timeoutMs, signal) });

				if (!response.ok || !response.body) {
					// release the socket before retrying or giving up
					await response.body?.cancel().catch(() => undefined);

					throw new Error(`Failed segment: ${url} (${response.status})`);
				}

				return Readable.fromWeb(response.body as any);
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (signal?.aborted) break;

				if (attempt < retries) {
					this.progress.message(`Error fetching segment ${url}: ${lastError.message}. Retrying... (${attempt + 1}/${retries})`);
					await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
				}
			}
		}

		throw lastError;
	}

	/** Starts fetching a segment ahead of time, with its failures always observed. */
	private prefetchSegment(
		url: string,
		headers: Record<string, string>,
		timeoutMs: number,
		signal?: AbortSignal
	): Promise<NodeJS.ReadableStream> {
		const pending = this.fetchSegment(url, headers, timeoutMs, signal);

		// an idle prefetched stream that dies, or an abandoned rejection, must not crash the process
		pending.then((readable) => readable.on('error', () => undefined)).catch(() => undefined);

		return pending;
	}

	/** Destroys a prefetched segment that will never be consumed. */
	private async dropPrefetch(pending: Promise<NodeJS.ReadableStream> | null): Promise<void> {
		if (!pending) return;

		try {
			((await pending) as Readable)?.destroy?.();
		} catch {
			// already rejected and handled by prefetchSegment
		}
	}

	private decrypt(readable: NodeJS.ReadableStream, segment: HlsSegment, key: Buffer | null): NodeJS.ReadableStream {
		if (!key || !segment.key || segment.key.method === 'NONE') return readable;

		this.progress.message(
			`Decrypting segment ${segment.sequence} with key ${segment.key.url} and IV ${segment.key.iv?.toString('hex') ?? 'derived'}`
		);

		// RFC 8216 §5.2: without `IV=` the IV is the segment's media sequence number
		const decipher = createDecipheriv('aes-128-cbc', key, segment.key.iv ?? this.sequenceIv(segment.sequence));

		// pipe() does not forward errors, so a dead source would stall the consumer
		readable.on('error', (error: Error) => decipher.destroy(error));

		return readable.pipe(decipher);
	}

	private sequenceIv(sequence: number): Buffer {
		const iv = Buffer.alloc(16, 0);

		iv.writeUInt32BE(sequence >>> 0, 12);

		return iv;
	}

	/** Writes one segment into `stream`, honoring backpressure, and returns its byte count. */
	private async pipeSegment(readable: NodeJS.ReadableStream, stream: Writable, onBytes: (written: number) => void): Promise<number> {
		let written = 0;

		for await (const chunk of readable) {
			const buffer = chunk as Buffer;

			written += buffer.length;
			onBytes(buffer.length);

			if (!stream.write(buffer)) await once(stream, 'drain');
		}

		return written;
	}

	/** Writes segments in order, fetching the next one while the current one streams. */
	private async stitchSegments(
		segments: HlsSegment[],
		timeoutMs: number,
		stream: Writable,
		headers: Record<string, string>,
		options: DownloadOptions
	): Promise<void> {
		if (!segments.length) return;

		const signal = options.signal;
		const key = options.target?.url ?? 'stream';
		const label = this.targetLabel(options);
		const totalSegments = segments.length;
		const keyCache = new Map<string, Buffer>();

		this.progress.message('Starting to stream segments...');
		this.progress.transfer(key, { label, totalSegments });

		let bytes = 0;
		let reportedAt = 0;

		const reportBytes = (written: number) => {
			bytes += written;

			const now = Date.now();

			// throttled so a fast segment does not emit an event per chunk
			if (now - reportedAt < HlsClient.BYTE_REPORT_MS) return;

			reportedAt = now;
			this.progress.transfer(key, { label, bytes });
		};

		let next: Promise<NodeJS.ReadableStream> | null = this.prefetchSegment(segments[0].url, headers, timeoutMs, signal);

		try {
			for (let index = 0; index < totalSegments; index++) {
				// an abort between segments stops the stitch immediately
				if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Download aborted');

				const current = await next!;

				next = index + 1 < totalSegments ? this.prefetchSegment(segments[index + 1].url, headers, timeoutMs, signal) : null;

				// keys are resolved per segment so mid-playlist key rotation works
				const segmentKey = await this.resolveKey(segments[index], keyCache, timeoutMs, headers, signal);

				await this.pipeSegment(this.decrypt(current, segments[index], segmentKey), stream, reportBytes);

				this.progress.transfer(key, { label, segments: index + 1, bytes });
			}
		} catch (error) {
			await this.dropPrefetch(next);

			throw error;
		}
	}

	private async resolveKey(
		segment: HlsSegment,
		cache: Map<string, Buffer>,
		timeoutMs: number,
		headers: Record<string, string>,
		signal?: AbortSignal
	): Promise<Buffer | null> {
		if (!segment.key || segment.key.method === 'NONE' || !segment.key.url) return null;

		const cached = cache.get(segment.key.url);
		if (cached) return cached;

		const key = await this.fetchKey(segment.key.url, timeoutMs, headers, signal);

		cache.set(segment.key.url, key);

		return key;
	}

	/** Parses segments, tracking the `#EXT-X-KEY` in effect and the media sequence for each. */
	private parseSegments(manifest: string, base: string, isFmp4: boolean): HlsSegment[] {
		const segments: HlsSegment[] = [];

		let sequence = this.parseMediaSequence(manifest);
		let currentKey: HlsKey | null = null;

		for (const line of manifest.split('\n').map((entry) => entry.trim())) {
			if (!line) continue;

			if (line.startsWith('#EXT-X-KEY')) {
				// fMP4 playlists are not decrypted here
				currentKey = isFmp4 ? null : this.parseKey(line, base);
				continue;
			}

			if (line.startsWith('#')) continue;

			segments.push({ url: new URL(line, base).toString(), key: currentKey, sequence: sequence++ });
		}

		return segments;
	}

	/** Exact size from `#EXT-X-BYTERANGE`, else the variant's bandwidth × total duration; no extra requests. */
	private estimateBytes(masterManifest: string, mediaManifest: string, playlistUrl: string): number {
		const byteRanges = [...mediaManifest.matchAll(/#EXT-X-BYTERANGE:(\d+)/g)].map((match) => parseInt(match[1], 10));

		if (byteRanges.length) return byteRanges.reduce((total, length) => total + length, 0);

		const durationSeconds = [...mediaManifest.matchAll(/#EXTINF:\s*([\d.]+)/g)].reduce(
			(total, match) => total + parseFloat(match[1]),
			0
		);

		if (!durationSeconds) return 0;

		const variant = this.parseVariants(masterManifest, playlistUrl).find((entry) => entry.url === playlistUrl);
		const bandwidth = variant?.bandwidth ?? this.highestBandwidth(masterManifest);

		if (!bandwidth) return 0;

		return Math.round((bandwidth / 8) * durationSeconds);
	}

	private highestBandwidth(manifest: string): number {
		return [...manifest.matchAll(/BANDWIDTH=(\d+)/g)].reduce((highest, match) => Math.max(highest, parseInt(match[1], 10)), 0);
	}

	private parseMediaSequence(manifest: string): number {
		const match = manifest.match(/#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/);

		return match ? parseInt(match[1], 10) : 0;
	}

	/** The variant's URI, skipping blank lines and interleaved tags. */
	private variantUri(lines: string[], from: number): string | null {
		for (let index = from; index < lines.length; index++) {
			const line = lines[index];

			if (!line) continue;
			if (line.startsWith('#EXT-X-STREAM-INF')) return null;
			if (!line.startsWith('#')) return line;
		}

		return null;
	}

	/** Best variant at or below the requested height, else the smallest above it, else by bandwidth. */
	private selectVariant(manifest: string, base: string, options: DownloadOptions): string | null {
		const variants = this.parseVariants(manifest, base);

		if (!variants.length) return null;

		// largest first: height, then width, then bandwidth
		variants.sort((a, b) => b.height - a.height || b.width - a.width || b.bandwidth - a.bandwidth);

		this.progress.message('Selecting variants from manifest');

		if (!options.quality || options.quality === 'unknown') return variants[0].url;

		const targetHeight = qualityToHeight(options.quality);

		const atOrBelow = variants.find((variant) => variant.height > 0 && variant.height <= targetHeight);
		if (atOrBelow) return atOrBelow.url;

		const above = [...variants].reverse().find((variant) => variant.height > targetHeight);
		if (above) return above.url;

		// playlists without RESOLUTION are matched against an approximate bitrate ladder
		return this.variantByBandwidth(variants, targetHeight) ?? variants[0].url;
	}

	/** Highest variant at or below the bitrate expected for `targetHeight`, else the smallest. */
	private variantByBandwidth(variants: HlsVariant[], targetHeight: number): string | null {
		const rated = variants.filter((variant) => variant.bandwidth > 0);

		if (!rated.length) return null;

		const ladder = HlsClient.BANDWIDTH_BY_HEIGHT;
		const [, targetBandwidth] = ladder.find(([height]) => height <= targetHeight) ?? ladder[ladder.length - 1];

		const descending = [...rated].sort((a, b) => b.bandwidth - a.bandwidth);

		return (descending.find((variant) => variant.bandwidth <= targetBandwidth) ?? descending[descending.length - 1]).url;
	}

	/** Parses one `#EXT-X-KEY`; attributes may come in any order and methods other than AES-128 throw. */
	private parseKey(line: string, base: string): HlsKey | null {
		const method = line.match(/METHOD=([A-Z0-9-]+)/)?.[1];

		if (!method || method === 'NONE') return null;

		if (method !== 'AES-128') throw new Error(`Unsupported HLS encryption method: ${method}`);

		const uri = line.match(/URI="([^"]+)"/)?.[1];

		if (!uri) return null;

		const rawIv = line.match(/IV=0[xX]([0-9a-fA-F]+)/)?.[1];

		this.progress.message(`Parsed ${method} key from manifest (explicit IV: ${Boolean(rawIv)})`);

		return {
			method: 'AES-128',
			url: new URL(uri, base).toString(),
			iv: rawIv ? Buffer.from(rawIv.padStart(32, '0'), 'hex') : undefined
		};
	}

	/** Fetches a 16-byte AES-128 key with the playlist headers, a timeout and retries. */
	private async fetchKey(url: string, timeoutMs: number, headers: Record<string, string>, signal?: AbortSignal): Promise<Buffer> {
		const retries = 2;

		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				const response = await fetch(url, { headers, signal: this.timeoutSignal(timeoutMs, signal) });
				if (!response.ok) throw new Error(`Failed to fetch HLS key: ${url} (${response.status})`);

				const key = Buffer.from(await response.arrayBuffer());
				if (key.length !== 16) throw new Error(`Invalid AES-128 key length (${key.length} bytes) from ${url}`);

				return key;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
			}
		}

		throw lastError ?? new Error(`Failed to fetch HLS key: ${url}`);
	}
}
