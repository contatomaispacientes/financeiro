import { defineConfig } from 'vitest/config';
import { typescriptDecorators } from './vitest.plugins';

export default defineConfig({
  plugins: [typescriptDecorators()],
  esbuild: false,
  test: {
    globals: true,
    include: ['test/e2e/**/*.e2e-spec.ts'],
    globalSetup: ['test/setup-containers.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
