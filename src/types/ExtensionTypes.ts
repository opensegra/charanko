import { type EXTENSION_MAP } from '../constants/extensions';

export type ExtensionCategory = keyof typeof EXTENSION_MAP;

export type Extension = (typeof EXTENSION_MAP)[ExtensionCategory][number];

export type ExtensionOf<T extends ExtensionCategory> = (typeof EXTENSION_MAP)[T][number];

export type VideoExtension = ExtensionOf<'video'>;
export type ImageExtension = ExtensionOf<'image'>;
export type AudioExtension = ExtensionOf<'audio'>;
export type DocumentExtension = ExtensionOf<'document'>;
export type ArchiveExtension = ExtensionOf<'archive'>;
export type ExecutableExtension = ExtensionOf<'executable'>;
export type FontExtension = ExtensionOf<'font'>;
export type SubtitleExtension = ExtensionOf<'subtitle'>;
export type DataExtension = ExtensionOf<'data'>;
export type OctetExtension = ExtensionOf<'octet'>;

export type AllowedExtension = ImageExtension | VideoExtension | OctetExtension;
