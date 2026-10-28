import { type VideoSourceOutput } from './MetadataContracts';

export interface FlashVarsOutput {
	videoId?: string;
	title?: string;
	categories?: string[];
	tags?: string[];
	models?: string[];
	licenseCode?: string;
	description?: string;
	rnd?: string;
	postfix?: string;
	videoUrl?: string;
	videoAltUrl?: string;
	videoUrlText?: string;
	videoUrlHd?: string;
	videoAltUrl2?: string;
	videoAltUrl2Hd?: string;
	videoAltUrlText?: string;
	videoAltUrl2Text?: string;
	videoAltUrl2Redirect?: string;
	videoModels?: string[];
	timelineScreenUrl?: string;
	timelineScreenCount?: number;
	previewUrl?: string;
	previewUrl1?: string;
	previewUrl2?: string;
	previewUrl3?: string;
	previewUrl4?: string;
	previews?: string[];
	videos?: VideoSourceOutput[];
	timelineScreens?: string[];
}
