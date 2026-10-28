import { join, posix } from 'path';

/** Builds output paths from POSIX-style logical folders, converted to platform paths only at the filesystem. */
export class PathBuilder {
	/** `filename` inside `folder`, as a platform path. */
	public relativePath(filename: string, folder?: string): string {
		return folder ? join(folder, filename) : filename;
	}

	/** Joins logical folder segments with `/`, skipping empty ones. */
	public join(...segments: string[]): string {
		return posix.join(...segments.filter((segment) => segment && segment.length > 0));
	}

	/** Replaces every non-alphanumeric character with an underscore; a missing name becomes `unknown`. */
	public safeName(input?: string | null): string {
		return (input || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
	}
}
