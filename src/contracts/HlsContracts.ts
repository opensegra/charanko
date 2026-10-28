/** One `#EXT-X-STREAM-INF` entry of a master playlist. */
export interface HlsVariant {
	url: string;
	width: number;
	height: number;
	bandwidth: number;
}

/** One `#EXT-X-KEY` tag. */
export interface HlsKey {
	url: string;
	iv?: Buffer;
	method: 'AES-128' | 'NONE';
}

/** One media segment with the key in effect for it. */
export interface HlsSegment {
	url: string;
	key: HlsKey | null;

	/** Media sequence number, the implicit AES-128 IV when no `IV=` is declared. */
	sequence: number;
}

/** A media playlist resolved in one pass, so it is fetched only once. */
export interface ResolvedPlaylist {
	playlistUrl: string;
	segments: HlsSegment[];
	initUrl: string | null;
	isFmp4: boolean;

	/** Approximate bytes fetched (not produced), from byte ranges or bandwidth × duration. */
	estimatedBytes: number;
}
