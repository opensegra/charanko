import { type Readable, type Writable } from 'stream';
import { type InumakiProgress } from '../../../inumaki/dist';
import { type TransferStrategy } from '../base/TransferStrategy';
import { type OutputType, type VideoQuality } from '../types';
import { type HttpFetchOptions } from './HttpContracts';
import { type DirectoryOptions, type TranscodeOptions } from './StorageContracts';

/** Pieces `Charanko.create()` builds the downloader from; anything left out gets a default. */
export interface CharankoOptions {
	/** Progress the clients report to; default a new `InumakiProgress('Download')`. */
	progress?: InumakiProgress;

	/** Site-specific transfer rules; default a plain `TransferStrategy`. */
	strategy?: TransferStrategy;
}

/** One media file to download. */
export interface DownloadTarget {
	/** Media URL; a KVS `function/N/` URL is deciphered with `licenseCode`. */
	url: string;

	/** Page the media was found on, sent as the Referer. */
	referer?: string;

	/** Relative output folder, such as `videos/123`. */
	folder?: string;

	/** KVS license code from the page's `flashvars`. */
	licenseCode?: string;
}

export interface DownloadOptions extends HttpFetchOptions {
	outputType: OutputType;
	directory?: DirectoryOptions;
	transcode?: TranscodeOptions;
	quality?: VideoQuality;

	/** Target being downloaded, set by `Charanko` for progress labels and refreshes. */
	target?: DownloadTarget;

	/** Re-extracts a target whose URL expired; resolve `null` to give up. */
	refresh?: (target: DownloadTarget) => Promise<DownloadTarget | null>;

	/** CDN fallbacks left, kept per request so one item can't use up another's budget. */
	cdnFallbackBudget?: number;

	/** Refreshes left for this transfer. */
	refreshBudget?: number;

	/** Resolves the media and returns its details without downloading or writing anything. */
	dryRun?: boolean;
}

/** File details of a finished download. */
export interface DownloadResult {
	/** Requested URL. */
	url: string;

	/** URL after redirects. */
	finalUrl: string;

	/** Filename with the configured prefix. */
	extendedFilename: string;

	/** Filename from the URL or response. */
	originalFilename: string;

	extension: string;

	mimeType: string;

	/** Size in bytes; 0 when a remuxed stream's length isn't known. */
	sizeBytes: number;

	/** Path on disk, or the logical path for a stream. */
	path: string;

	/** Approximate source size for progress; never send it as `Content-Length`. */
	estimatedBytes?: number;

	/** Readable media for `outputType: 'STREAM'`; pipe or destroy it promptly or the transfer stalls. */
	stream?: Readable;
}

/** A resolved media response, ready to be written into a sink. */
export interface StreamRequest {
	finalUrl: string;
	headers: Record<string, string>;
	isFmp4?: boolean;

	/** Exact delivered length, set only when bytes pass through untouched. */
	contentLength?: number;

	/** Source size for progress; never send it as `Content-Length`. */
	estimatedBytes?: number;

	/** Writes the media into `stream`; `dryRun` releases the body without reading it. */
	start: (stream: Writable, dryRun?: boolean) => Promise<void>;
}
