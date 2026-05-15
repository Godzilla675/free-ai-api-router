import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: [...configDefaults.exclude, 'dist/**'],
    testTimeout: 10_000,
    coverage: {
      reporter: ['text', 'html']
    }
  }
});
