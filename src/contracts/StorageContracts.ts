import { type Readable, type Writable } from 'stream';
import { type OutputType } from '../types';

/** What a sink writes and where. */
export interface SinkOptions {
	type: OutputType;
	transcode?: TranscodeOptions;
	directoryPath?: string;
	filename: string;

	/** Relative output folder inside `directoryPath`. */
	folder?: string;
}

/** A file written to disk and finalized. */
export interface StoredFile {
	originalFilename: string;
	extension: string;
	extendedFilename: string;
	mimeType: string;
	sizeBytes: number;
	path: string;
	isFmp4?: boolean;
}

/** A disk sink: write into `stream`, then `finalize` it or `cleanup` on failure. */
export interface FileSink {
	stream: Writable;
	cleanup: () => Promise<void>;
	finalize: (file: ResolvedFile, headers: Record<string, string>, isFmp4?: boolean) => Promise<StoredFile>;
}

/** An ffmpeg remux pipe: write downloaded bytes into `input`, read playable media from `output`. */
export interface RemuxPipe {
	input: Writable;
	output: Readable;

	/** Settles when the remux finishes, or rejects if it failed. */
	done: Promise<void>;
}

/** A pipe returned before any bytes arrive, remuxing when the media needs it. */
export interface StreamSink extends RemuxPipe {
	extension: string;
	mimeType: string;
	filename: string;
}

/** A finished file on disk after any remux. */
export interface FinalizedMedia {
	path: string;
	filename: string;
	extension: string;
	mimeType: string;
}

/** Extension and MIME type already known for a file. */
export interface MediaHints {
	extension?: string;
	mimeType?: string;
}

export interface ResolvedFile {
	originalFilename: string;
	extension: string;
	extendedFilename: string;
}

export interface TranscodeOptions {
	/** Downloaded file to finalize; set automatically when a file needs ffmpeg. */
	inputPath?: string;

	/** ffmpeg binary to use instead of `ffmpeg-static`, such as `/opt/homebrew/bin/ffmpeg`. */
	ffmpegPath?: string;

	/** Deletes the input file after a successful finalize; default `true`. */
	deleteInput?: boolean;

	/** Full ffmpeg arguments, replacing the default remux or transcode arguments. */
	ffmpegArgs?: string[];

	/** Output container extension; default `mp4`. */
	outputExtension?: string;

	/** Encoder preset when transcoding, such as with libx264. */
	preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow';

	/** Constant Rate Factor when transcoding. */
	crf?: number;

	/** Video codec; default `copy`. */
	videoCodec?: string;

	/** Audio codec; default `copy`. */
	audioCodec?: string;
}

/** Where downloaded files are written. */
export interface DirectoryOptions {
	/** Output directory; default `downloads` under the working directory. */
	directoryPath?: string;

	/** Filename prefix. */
	prefix?: string;

	/** Folder layout: by provider, by extension, or mirroring the source URL (default). */
	pattern?: 'provider' | 'extension' | 'recursive';
}
