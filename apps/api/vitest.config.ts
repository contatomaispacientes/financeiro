import { defineConfig } from 'vitest/config';
import { typescriptDecorators } from './vitest.plugins';

export default defineConfig({
  plugins: [typescriptDecorators()],
  oxc: false,
  test: {
    globals: true,
    root: './src',
    include: ['**/*.spec.ts'],
    exclude: ['**/generated/**'],
  },
});
