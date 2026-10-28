import { defineConfig } from 'tsup';

export default defineConfig({
	entry: {
		'index': 'src/index.ts',
		'client/index': 'src/client/index.ts',
		'contracts/index': 'src/contracts/index.ts',
		'downloader/index': 'src/downloader/index.ts',
		'storage/index': 'src/storage/index.ts',
		'types/index': 'src/types/index.ts',
		'utils/index': 'src/utils/index.ts'
	},
	format: ['esm', 'cjs'],
	// tsup's dts step injects `baseUrl`, which TypeScript 6 rejects as deprecated
	dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
	clean: true,
	splitting: true,
	// keeps class names such as `DownloadException` intact for `error.name`
	keepNames: true,
	target: 'node22',
	platform: 'node',
	sourcemap: true
});
