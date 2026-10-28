import { posix } from 'path';
import { PassThrough } from 'stream';
import { finished } from 'stream/promises';
import { InumakiProgress } from 'inumaki';
import { TransferStrategy } from '../base/TransferStrategy';
import { HlsClient } from '../client/HlsClient';
import { StreamHttpClient } from '../client/StreamHttpClient';
import { MIME_TYPES } from '../constants';
import {
	type CharankoOptions,
	type DownloadOptions,
	type DownloadResult,
	type DownloadTarget,
	type FileSink,
	type ResolvedFile,
	type StreamRequest
} from '../contracts';
import { FFmpegEngine, FileManager } from '../storage';
import { KvsResolver } from '../utils';

/** Downloads one target into storage: opens the media, picks the sink, writes and finalizes it. */
export class Charanko {
	constructor(
		protected readonly fileManager: FileManager,
		protected readonly streamClient: StreamHttpClient,
		protected readonly progress: InumakiProgress
	) {
		// bound so `const { download } = Charanko.create()` keeps its instance
		this.download = this.download.bind(this);
	}

	/** Builds a downloader with its own clients and storage; pass only the pieces you want to replace. */
	public static create({
		progress = new InumakiProgress('Download'),
		strategy = new TransferStrategy()
	}: CharankoOptions = {}): Charanko {
		const fileManager = new FileManager(new FFmpegEngine(progress));
		const streamClient = new StreamHttpClient(new HlsClient(progress), progress, strategy);

		return new Charanko(fileManager, streamClient, progress);
	}

	/** Downloads `target` to disk, or hands back a readable for `outputType: 'STREAM'`. */
	public async download(target: DownloadTarget, options: DownloadOptions): Promise<DownloadResult> {
		const { directory, outputType } = options;
		const url = KvsResolver.resolve(target.url, target.licenseCode);
		const resolvedTarget = { ...target, url };

		const guessedFile = this.fileManager.fileFromUrl(url, directory?.prefix);

		const request = await this.streamClient.requestStream(url, {
			...options,
			referer: target.referer ?? options.referer,
			target: resolvedTarget
		});

		const file = this.fileManager.resolveFile(guessedFile, request, directory?.prefix);
		this.progress.message(`Extracting metadata for: ${file.extendedFilename}`);

		if (options.dryRun) return this.describe(resolvedTarget, request, file);

		if (outputType === 'STREAM') return this.openStream(resolvedTarget, options, request, file);

		const sink = this.fileManager.createSink({
			type: outputType,
			directoryPath: directory?.directoryPath,
			filename: file.originalFilename,
			folder: target.folder,
			transcode: options.transcode
		});

		return this.writeToSink(sink, request, file, url);
	}

	/** Releases the response unread and reports what would have been downloaded. */
	private async describe(target: DownloadTarget, request: StreamRequest, file: ResolvedFile): Promise<DownloadResult> {
		await request.start(new PassThrough(), true);

		return {
			url: target.url,
			finalUrl: request.finalUrl,
			path: posix.join(target.folder ?? '', file.originalFilename),
			originalFilename: file.originalFilename,
			extendedFilename: file.extendedFilename,
			extension: file.extension,
			mimeType: MIME_TYPES[file.extension] ?? request.headers['content-type']?.split(';')[0]?.trim() ?? 'application/octet-stream',
			sizeBytes: request.contentLength ?? 0,
			estimatedBytes: request.estimatedBytes
		};
	}

	/** Returns a readable as soon as the pipe opens; transfer errors surface by destroying it. */
	private async openStream(
		target: DownloadTarget,
		options: DownloadOptions,
		request: StreamRequest,
		file: ResolvedFile
	): Promise<DownloadResult> {
		const sink = this.fileManager.createStreamSink(
			{
				type: 'STREAM',
				filename: file.originalFilename,
				folder: target.folder,
				transcode: options.transcode
			},
			file,
			request.isFmp4
		);

		const transfer = (async () => {
			await request.start(sink.input);

			if (!sink.input.destroyed && !sink.input.writableEnded) sink.input.end();

			await sink.done;
		})();

		// the writable end only needs to close; the readable carries the error to the consumer
		sink.input.on('error', () => undefined);

		transfer.catch((error) => {
			sink.input.destroy();
			sink.output.destroy(error instanceof Error ? error : new Error(String(error)));
		});

		// a remux rewrites the container, so the source length only holds for untouched bytes
		const remuxed = this.fileManager.needsRemux(file.extension, request.isFmp4);

		return {
			url: target.url,
			finalUrl: request.finalUrl,
			stream: sink.output,
			sizeBytes: remuxed ? 0 : (request.contentLength ?? 0),
			estimatedBytes: request.estimatedBytes,
			path: posix.join(target.folder ?? '', sink.filename),
			originalFilename: sink.filename,
			extendedFilename: `${options.directory?.prefix ?? ''}${sink.filename}`,
			extension: sink.extension,
			mimeType: sink.mimeType
		};
	}

	/** Writes the media into a disk sink and finalizes it, removing the partial file on any failure. */
	private async writeToSink(sink: FileSink, request: StreamRequest, file: ResolvedFile, url: string): Promise<DownloadResult> {
		const { stream, finalize, cleanup } = sink;

		// an unlistened `error` on a WriteStream is fatal; the failure is rethrown below instead
		stream.on('error', () => undefined);

		try {
			await request.start(stream);
			if (!stream.destroyed && !stream.writableEnded) stream.end();

			await finished(stream);
			const stored = await finalize(file, request.headers, Boolean(request.isFmp4));

			return { ...stored, url, finalUrl: request.finalUrl };
		} catch (error) {
			// no error argument: the caller gets it by rethrow, the stream just closes
			stream.destroy();
			await cleanup();

			throw error;
		}
	}
}
