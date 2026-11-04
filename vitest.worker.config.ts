import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['worker/**/*.spec.ts'],
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
