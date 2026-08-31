import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Motoren er rene funksjoner, så testene trenger ingen isolasjon
    pool: 'threads',
  },
})
