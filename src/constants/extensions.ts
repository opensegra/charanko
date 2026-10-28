import {
	type AudioExtension,
	type Extension,
	type ExtensionCategory,
	type ImageExtension,
	type VideoExtension
} from '../types/ExtensionTypes';

export const EXTENSION_MAP = {
	image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'svg', 'ico', 'avif', 'heic', 'heif'],
	video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'm3u8'],
	audio: ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma', 'opus', 'aiff', 'amr'],
	document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp', 'csv'],
	archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tar.gz'],
	executable: ['exe', 'msi', 'apk', 'dmg', 'bin', 'sh', 'bat'],
	font: ['ttf', 'otf', 'woff', 'woff2', 'eot'],
	subtitle: ['srt', 'vtt', 'ass', 'ssa'],
	data: ['json', 'xml', 'yaml', 'yml'],
	octet: ['bin', 'exe', 'zip', 'rar']
} as const;

export const EXTENSIONS: Record<ExtensionCategory, Set<Extension>> = Object.fromEntries(
	Object.entries(EXTENSION_MAP).map(([category, extensions]) => [category, new Set(extensions)])
) as any;

export const MIME_TYPES: Partial<Record<ImageExtension | VideoExtension | AudioExtension, string>> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	mp4: 'video/mp4',
	ts: 'video/mp2t',
	m3u8: 'application/vnd.apple.mpegurl',
	webm: 'video/webm',
	mp3: 'audio/mpeg',
	wav: 'audio/wav'
} as const;
