import { createWriteStream, promises as fs, mkdirSync } from 'fs';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'path';
import { PassThrough } from 'stream';
import { MIME_TYPES } from '../constants';
import {
	type FileSink,
	type FinalizedMedia,
	type MediaHints,
	type ResolvedFile,
	type SinkOptions,
	type StoredFile,
	type StreamRequest,
	type StreamSink,
	type TranscodeOptions
} from '../contracts';
import { InvalidDestinationException } from '../exceptions';
import { type FFmpegEngine } from './FFmpegEngine';
import { PathBuilder } from './PathBuilder';

/** Output handling: safe paths, filenames, disk and stream sinks, and remux finalization. */
export class FileManager {
	/** A URI scheme such as `s3://`; requires `://` so Windows drives like `C:\` don't match. */
	private static readonly URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

	private readonly pathBuilder = new PathBuilder();
	private readonly defaultDirectory = 'downloads';

	constructor(private readonly ffmpegEngine: FFmpegEngine) {}

	/** Opens the sink for an output type. */
	public createSink(options: SinkOptions): FileSink {
		switch (options.type) {
			case 'DEVICE':
				return this.deviceSink(options);

			default:
				throw new Error('Unsupported output type');
		}
	}

	/** Opens a pipe returned before any bytes arrive; transport containers go through ffmpeg, others pass through. */
	public createStreamSink(options: SinkOptions, file: ResolvedFile, isFmp4?: boolean): StreamSink {
		if (!this.needsRemux(file.extension, isFmp4)) {
			const passthrough = new PassThrough();

			return {
				input: passthrough,
				output: passthrough,
				done: Promise.resolve(),
				extension: file.extension,
				mimeType: MIME_TYPES[file.extension] ?? 'application/octet-stream',
				filename: file.originalFilename
			};
		}

		const { input, output, done } = this.ffmpegEngine.remuxStream(options.transcode);
		const baseName = file.originalFilename.replace(/\.[^.]+$/, '') || 'media';

		return { input, output, done, extension: 'mp4', mimeType: 'video/mp4', filename: `${baseName}.mp4` };
	}

	/** Writes to a sibling `.part` file, renamed into place only once the transfer completes. */
	private deviceSink(options: SinkOptions): FileSink {
		const finalPath = this.outputPath(options.directoryPath ?? this.defaultDirectory, options.filename, options.folder);
		const partPath = `${finalPath}.part`;

		return {
			stream: createWriteStream(partPath),
			cleanup: async (): Promise<void> => {
				await fs.rm(partPath, { force: true }).catch(() => undefined);
			},
			finalize: async (file: ResolvedFile, headers: Record<string, string>, isFmp4?: boolean): Promise<StoredFile> => {
				await fs.rename(partPath, finalPath);

				const finalized = await this.finalizeFile(finalPath, options.transcode, isFmp4, {
					extension: file.extension,
					mimeType: MIME_TYPES[file.extension] ?? headers['content-type']?.split(';')[0]?.trim()
				});

				const stats = await fs.stat(finalized.path);

				return {
					path: finalized.path,
					originalFilename: finalized.filename,
					extendedFilename: finalized.filename,
					mimeType: finalized.mimeType,
					extension: finalized.extension,
					sizeBytes: stats.size,
					isFmp4
				};
			}
		};
	}

	/** Whether the bytes still need remuxing: an MPEG-TS stitch or fragmented MP4. */
	public needsRemux(extension?: string, isFmp4?: boolean): boolean {
		return Boolean(isFmp4) || (extension ?? '').toLowerCase() === 'ts';
	}

	/** Remuxes a finished file when needed and returns its final path, name, extension and MIME type. */
	public async finalizeFile(path: string, transcode?: TranscodeOptions, isFmp4?: boolean, hints?: MediaHints): Promise<FinalizedMedia> {
		const extension = hints?.extension ?? extname(path).substring(1).toLowerCase();
		const mimeType = hints?.mimeType ?? MIME_TYPES[extension] ?? 'video/mp2t';

		if (this.needsRemux(extension, isFmp4)) return this.ffmpegEngine.finalizeMedia({ ...transcode, inputPath: path });

		return { path, filename: basename(path), extension, mimeType };
	}

	/** Guesses the filename and extension from a URL; falls back to `fud_<timestamp>`. */
	public fileFromUrl(url: string, prefix?: string): ResolvedFile {
		try {
			const parsed = new URL(url.startsWith('https://') ? url : `https://${url}`);

			const segments = parsed.pathname.split('/').filter(Boolean);
			const fileSegment = [...segments].reverse().find((segment) => /^[^/?#]+\.[a-z0-9]{2,10}$/i.test(segment));

			const originalFilename = this.sanitizeFilename((fileSegment ?? basename(parsed.pathname)) || `fud_${Date.now()}`);
			const extension = extname(originalFilename).replace('.', '').toLowerCase();

			return { extension, originalFilename, extendedFilename: `${prefix ?? ''}${originalFilename}` };
		} catch {
			throw new Error(`Unable to retrieve file information: ${url}`);
		}
	}

	/** Replaces characters that are invalid in filenames, mostly on Windows, with underscores. */
	public sanitizeFilename(name: string): string {
		return name.replace(/[^a-z0-9._-]/gi, '_');
	}

	/** Absolute output path inside `directoryPath`, rejecting URIs and path traversal. */
	protected outputPath(directoryPath: string, filename: string, folder?: string): string {
		if (!filename || filename.trim() === '') {
			throw new InvalidDestinationException(directoryPath, 'the filename is empty', { context: { folder } });
		}

		// path.resolve would turn `s3://bucket` into a local folder named `s3:` and report success
		if (FileManager.URI_SCHEME.test(directoryPath)) {
			throw new InvalidDestinationException(
				directoryPath,
				'expected a filesystem path, not a URI; to upload to object storage, use outputType "STREAM" and pipe DownloadResult.stream to your storage client'
			);
		}

		const baseDirectory = isAbsolute(directoryPath) ? directoryPath : resolve(process.cwd(), directoryPath);
		const finalPath = resolve(baseDirectory, this.pathBuilder.relativePath(filename, folder));

		if (relative(baseDirectory, finalPath).startsWith('..')) {
			throw new InvalidDestinationException(finalPath, `it resolves outside ${baseDirectory}`, { context: { folder, filename } });
		}

		try {
			mkdirSync(dirname(finalPath), { recursive: true });
		} catch (error) {
			throw new InvalidDestinationException(finalPath, 'its directory could not be created', { cause: error });
		}

		return finalPath;
	}

	/** Corrects the guessed file with the final URL and headers; HLS becomes `.mp4` (fMP4) or `.ts`. */
	public resolveFile(guessed: ResolvedFile, request: StreamRequest, prefix?: string): ResolvedFile {
		const { finalUrl, headers, isFmp4 } = request;

		const isHls = finalUrl.includes('.m3u8') || headers['content-type']?.includes('application/vnd.apple.mpegurl');

		if (isHls) {
			const extension = isFmp4 ? 'mp4' : 'ts';
			const baseName = this.sanitizeFilename(guessed.originalFilename.replace(/\.[^.]+$/, '') || 'video');

			return {
				originalFilename: `${baseName}.${extension}`,
				extension,
				extendedFilename: `${prefix ?? ''}${baseName}.${extension}`
			};
		}

		if (guessed.extension) return guessed;

		const fallback = this.fileFromUrl(finalUrl, prefix);

		return fallback.extension ? fallback : guessed;
	}
}
