/** Video quality labels. */

export const VIDEO_QUALITIES = ['144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p', '4320p'] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number] | 'unknown';

/** Video stream formats. */
export const VIDEO_FORMATS = ['hls', 'mp4'] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

/** Video codecs. */
export const VIDEO_CODECS = ['h264', 'av1'] as const;
export type VideoCodec = (typeof VIDEO_CODECS)[number];

/** Where a download ends up. */
export const OUTPUT_TYPES = ['DEVICE', 'JSON', 'STREAM', 'RETURN'] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];
