import eslint from '@eslint/js';
import prettier from 'eslint-plugin-prettier/recommended';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	prettier,
	{
		languageOptions: {
			globals: {
				URL: 'readonly',
				process: 'readonly'
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mjs', 'tsup.config.ts', 'tests/*.mjs']
				},
				tsconfigRootDir: import.meta.dirname
			}
		},
		rules: {
			// type-only imports are erased at compile time, so they can't close runtime import cycles
			'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
			'no-process-env': 'off',
			'no-inline-comments': 'off',
			'no-warning-comments': 'off',
			'comma-dangle': ['error', 'never'],
			'arrow-parens': ['error', 'always'],
			'@typescript-eslint/naming-convention': 'off',
			'@typescript-eslint/no-floating-promises': 'off',
			'@typescript-eslint/no-misused-promises': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/no-unsafe-declaration-merging': 'off',
			'@typescript-eslint/no-empty-object-type': 'off',
			'no-prototype-builtins': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_'
				}
			]
		}
	},
	{
		ignores: ['dist/**', 'docs/**', 'test/**', 'node_modules/**']
	}
);
