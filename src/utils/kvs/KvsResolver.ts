/** Deciphers KVS (Kernel Video Sharing) `function/N/` media URLs with the site's license code. */
export class KvsResolver {
	/** Returns the playable URL, or `url` unchanged when it isn't a KVS URL or there is no license code. */
	public static resolve(url: string, licenseCode?: string): string {
		const match = url.match(/^function\/\d+\/(.+)$/i);

		if (!match || !licenseCode) return url;

		const parsed = new URL(match[1]);
		const segments = parsed.pathname.split('/');
		const token = segments[3];

		// the first 32 characters of the fourth path segment are the scrambled hash
		if (!token || token.length < 32) return parsed.toString();

		segments[3] = KvsResolver.decipher(token.slice(0, 32), licenseCode) + token.slice(32);
		parsed.pathname = segments.join('/');

		return parsed.toString();
	}

	/** Swap offsets derived from the license code. */
	private static seeds(licenseCode: string): number[] {
		const normalized = licenseCode.replace(/\$/g, '');

		const digits = normalized.split('').map(Number);
		const nonZero = normalized.replace(/0/g, '1');

		const midpoint = Math.floor(nonZero.length / 2);
		const left = Number(nonZero.slice(0, midpoint + 1));
		const right = Number(nonZero.slice(midpoint));

		const seed = String(4 * Math.abs(left - right)).slice(0, midpoint + 1);

		return seed.split('').flatMap((digit, index) => {
			const value = Number(digit);
			return Array.from({ length: 4 }, (_, offset) => (digits[index + offset] + value) % 10);
		});
	}

	/** Undoes the character swaps KVS applies to the hash. */
	private static decipher(hash: string, licenseCode: string): string {
		const seeds = KvsResolver.seeds(licenseCode);
		const chars = hash.split('');

		let offset = 0;

		for (let index = chars.length - 1; index >= 0; index--) {
			offset += seeds[index];

			const target = (index + offset) % chars.length;

			[chars[index], chars[target]] = [chars[target], chars[index]];
		}

		return chars.join('');
	}
}
