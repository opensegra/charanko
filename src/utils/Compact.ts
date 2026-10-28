/** Copies `object` keeping only the entries `keep` accepts, or the truthy ones by default. */
export const compact = <T extends Record<string, any>>(object: T, keep?: (value: T[keyof T]) => boolean): Partial<T> => {
	const result: Partial<T> = {};

	for (const [key, value] of Object.entries(object)) {
		if (keep ? keep(value) : Boolean(value)) result[key as keyof T] = value;
	}

	return result;
};
