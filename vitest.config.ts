import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    deps: {
      // node:sqlite (Node >= 22.5) is newer than Vite's builtin list.
      external: ['node:sqlite'],
    },
    server: {
      deps: {
        external: ['node:sqlite'],
      },
    },
  },
});
