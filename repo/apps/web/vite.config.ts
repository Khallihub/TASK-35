import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    // Coverage thresholds enforce a floor so regressions in coverage fail
    // CI rather than silently rotting. Tune via --coverage on the CLI.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.ts',
        'src/env.d.ts',
        'src/router/**',
      ],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 65,
        branches: 60,
      },
    },
  },
})
