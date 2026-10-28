import { type VideoQuality } from '../types';

export const inferVideoQuality = (url: string, defaultQuality?: VideoQuality): VideoQuality => {
	const match = url.match(/_(\d{3,4})p\.mp4/i);

	if (match) {
		const quality = match[1];

		switch (quality) {
			case '144':
				return '144p';
			case '240':
				return '240p';
			case '360':
				return '360p';
			case '480':
				return '480p';
			case '720':
				return '720p';
			case '1080':
				return '1080p';
			case '1440':
				return '1440p';
			case '2160':
				return '2160p';
			case '4320':
				return '4320p';
		}
	}

	// fallback only when the URL names no quality
	return defaultQuality || 'unknown';
};

export const qualityToHeight = (q: VideoQuality): number => {
	switch (q) {
		case '144p':
			return 144;
		case '240p':
			return 240;
		case '360p':
			return 360;
		case '480p':
			return 480;
		case '720p':
			return 720;
		case '1080p':
			return 1080;
		case '1440p':
			return 1440;
		case '2160p':
			return 2160;
		case '4320p':
			return 4320;
		default:
			return 0;
	}
};
