import { execFile, spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { accessSync, constants, promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { type InumakiProgress } from 'inumaki';
import { type FinalizedMedia, type RemuxPipe, type TranscodeOptions } from '../contracts';

const execFileAsync = promisify(execFile);

const MISSING_FFMPEG =
	'ffmpeg executable was not found. Install ffmpeg, allow ffmpeg-static build scripts in your package manager, or pass transcode.ffmpegPath.';

/** Remuxes or transcodes downloaded media, such as HLS `.ts` or fMP4, into a playable file. */
export class FFmpegEngine {
	constructor(private readonly progress: InumakiProgress) {}

	/** The bundled `ffmpeg-static` binary when executable, else `ffmpeg` from PATH. */
	public get binary(): string {
		return ffmpegPath && this.isExecutable(ffmpegPath) ? ffmpegPath : 'ffmpeg';
	}

	/** Pipes bytes through ffmpeg into fragmented MP4, since a pipe can't be seeked; read `output` while writing `input`. */
	public remuxStream(options: TranscodeOptions = {}): RemuxPipe {
		const { videoCodec, audioCodec, ffmpegArgs = [] } = options;

		const codecArgs = [
			'-c:v',
			videoCodec ?? 'copy',
			'-c:a',
			audioCodec ?? 'copy',
			'-movflags',
			'frag_keyframe+empty_moov+default_base_moof'
		];

		const args = ffmpegArgs.length ? ffmpegArgs : ['-loglevel', 'error', '-i', 'pipe:0', ...codecArgs, '-f', 'mp4', 'pipe:1'];

		this.progress.message(`Streaming remux via ${this.binaryFor(options)}`);

		const child = spawn(this.binaryFor(options), args, { stdio: ['pipe', 'pipe', 'pipe'] });

		let stderr = '';

		child.stderr.on('data', (chunk: Buffer) => {
			// keep only the tail, ffmpeg can be chatty on malformed input
			stderr = `${stderr}${chunk.toString()}`.slice(-2000);
		});

		const done = new Promise<void>((resolve, reject) => {
			child.on('error', (error) =>
				reject(
					(error as NodeJS.ErrnoException).code === 'ENOENT'
						? new Error(`Failed to remux stream: ${MISSING_FFMPEG}`, { cause: error })
						: error
				)
			);

			child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`))));
		});

		// a failed remux must surface on the readable the caller is piping
		done.catch((error) => child.stdout.destroy(error instanceof Error ? error : new Error(String(error))));

		return { input: child.stdin, output: child.stdout, done };
	}

	/** Remuxes `options.inputPath` into `<name>_final.<ext>` with `+faststart`, deleting the input by default. */
	public async finalizeMedia(options: TranscodeOptions): Promise<FinalizedMedia> {
		if (!options.inputPath) throw new Error('Input path is required for finalizing media');

		const { inputPath, outputExtension = 'mp4', deleteInput = true, ffmpegArgs = [], videoCodec, audioCodec, crf, preset } = options;

		const outputFilename = `${path.basename(inputPath, path.extname(inputPath))}_final.${outputExtension}`;
		const outputPath = path.join(path.dirname(inputPath), outputFilename);

		this.progress.message(
			`Finalizing media ${inputPath} with options ${JSON.stringify(options)} to ${outputPath} using ${this.binaryFor(options)}...`
		);

		const args = ffmpegArgs.length
			? ffmpegArgs
			: [
					'-y',
					'-loglevel',
					'error',
					'-i',
					inputPath,
					...this.codecArgs(videoCodec, audioCodec, crf, preset),
					'-movflags',
					'+faststart',
					outputPath
				];

		try {
			await execFileAsync(this.binaryFor(options), args);

			if (deleteInput) await fs.unlink(inputPath);

			return { path: outputPath, filename: outputFilename, extension: outputExtension, mimeType: `video/${outputExtension}` };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT')
				throw new Error(`Failed to finalize media: ${MISSING_FFMPEG}`, { cause: error });

			throw new Error(`Failed to finalize media: ${(error as Error).message}`, { cause: error });
		}
	}

	/** Codec arguments; copies streams unless a codec is given, with H.264 compatibility flags for libx264. */
	private codecArgs(videoCodec?: string, audioCodec?: string, crf?: number, preset?: string): string[] {
		const args = ['-c:v', videoCodec ?? 'copy'];

		if (videoCodec === 'libx264') args.push('-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2');

		args.push('-c:a', audioCodec ?? 'copy');

		const encoding = Boolean(videoCodec) && videoCodec !== 'copy';

		if (encoding && crf !== undefined) args.push('-crf', String(crf));
		if (encoding && preset) args.push('-preset', preset);

		return args;
	}

	private binaryFor(options?: TranscodeOptions): string {
		return options?.ffmpegPath ?? this.binary;
	}

	private isExecutable(filePath: string): boolean {
		try {
			accessSync(filePath, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	}
}
