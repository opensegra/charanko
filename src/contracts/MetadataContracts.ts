import { type VideoQuality } from '../types';

export interface VideoSourceOutput {
	quality: VideoQuality;
	url: string;
}

export interface DefaultMetadata {
	title: string;
	tags: string[];
	description: string;
	pageUrl: string;
}

export interface VideosFormat {
	mp4?: VideoSourceOutput[];
	hls?: VideoSourceOutput[];
}

export interface DefaultVideoOutput extends DefaultMetadata {
	poster: string;
	videos: VideosFormat;
}

export interface DefaultFlashVarsVideoOutput extends DefaultVideoOutput {
	videoId: string;
	previews: string[];
	timelineScreenCount?: number;
	timelineScreens?: string[];
	starred?: string[];
	uploader?: string;
}
