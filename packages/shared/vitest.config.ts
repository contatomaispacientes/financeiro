import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Desde o Vitest 4 o dist não é mais excluído por padrão.
    include: ['src/**/*.test.ts'],
  },
});
