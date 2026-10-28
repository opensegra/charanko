import { type DownloadOptions } from '../contracts';

/** Site-specific transfer rules: host fallbacks, expired URLs and text responses that point at the media. */
export class TransferStrategy {
	/** Whether a 404 should be retried on `fallbackUrl`. */
	public shouldFallbackOnNotFound(_url: string): boolean {
		return false;
	}

	/** Alternate URL to try after a 404. */
	public fallbackUrl(url: string): string | null {
		return url;
	}

	/** Whether a failed status means the URL expired and the target should be refreshed; signed URLs answer 403 or 410 once expired. */
	public shouldRefresh(_url: string, status: number): boolean {
		return status === 403 || status === 410;
	}

	/** Whether a text response holds the real media URL. */
	public shouldResolveTextResponse(_url: string, _contentType: string): boolean {
		return false;
	}

	/** Pulls the media URL out of a text response. */
	public mediaUrlFromText(_body: string, _options: DownloadOptions): string | null {
		return null;
	}

	/** URLs to try in order: the original, then the same path on each host. */
	public candidateUrls(url: string, hosts: string[] = []): string[] {
		let parsed: URL;

		try {
			parsed = new URL(url);
		} catch {
			return [url];
		}

		return Array.from(new Set([url, ...hosts.map((host) => `${parsed.protocol}//${host}${this.pathOf(parsed)}`)]));
	}

	protected pathOf(url: URL): string {
		return `${url.pathname}${url.search}${url.hash}`;
	}
}
