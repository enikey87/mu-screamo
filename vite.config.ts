import { defineConfig } from 'vitest/config'

// base './' — сборка открывается и с диска, и с GitHub Pages в подпапке /mu-screamo/
export default defineConfig({
  base: './',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
