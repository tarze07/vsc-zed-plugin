// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      '@typescript-eslint/naming-convention': [
        'warn',
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
