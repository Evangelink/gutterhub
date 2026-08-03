import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // LCOV so the extension can eat its own dog food; text for the terminal.
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'artifacts/coverage',
      include: ['src/**/*.ts'],
      // The UI and entry points drive browser APIs that the node test environment has
      // no way to exercise, so counting them would only depress the number misleadingly.
      exclude: ['src/ui/**', 'src/content/**', 'src/background/**'],
    },
  },
});
