import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Vitest 4's multi-worker pool crashes on this Windows/Node 24 setup with
    // "Cannot read properties of undefined (reading 'config')". The suite is fast
    // and DB-free, so run it in a single fork — green bar over parallelism.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['server/services/**', 'src/utils/**'],
      reporter: ['text', 'html'],
    },
  },
})
