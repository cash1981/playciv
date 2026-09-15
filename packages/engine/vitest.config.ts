import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The engine is pure functions, so the tests need no isolation
    pool: 'threads',
  },
})
