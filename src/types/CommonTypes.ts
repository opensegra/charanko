export type SniSpoofStatus = 'working' | 'failed' | 'untested';

export type UrlFormat = 'url' | 'path';

export type IndexRange = { start: number; end: number };
export type PageRange = { page: number; limit: number };
export type Range = IndexRange | PageRange;
