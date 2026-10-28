/** Credentials for sites that need an authenticated session or API access. */
export interface AuthenticatedCrawlOptions {
	/** Raw Cookie header value copied from an authenticated browser session. */
	cookie?: string;

	/** Bearer token for API-backed providers. */
	bearerToken?: string;

	/** CSRF token header value when the provider requires one. */
	csrfToken?: string;

	/** API key for providers with public/private API access. */
	apiKey?: string;

	/** Provider-specific app/client identifier. */
	clientId?: string;

	/** User agent to pair with the authenticated session. */
	userAgent?: string;
}

/** Outcome of a job's downloads; failed items are counted here instead of rejecting the job. */
export interface JobSettlement {
	downloaded: number;
	failed: number;
	errors: Error[];
}
