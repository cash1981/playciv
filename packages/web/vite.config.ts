import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

// One id per build: the Workers build's commit when there is one, else the time. It goes into
// the bundle and into version.json, so an open tab can tell when a newer build is deployed.
const buildId = process.env['WORKERS_CI_COMMIT_SHA'] ?? process.env['GITHUB_SHA'] ?? Date.now().toString(36)

const versionFile = (): Plugin => ({
  name: 'playciv-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: buildId }) })
  },
})

export default defineConfig(({ command }) => ({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(command === 'build' ? buildId : 'dev') },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
        },
      },
    },
  },
  server: {
    port: 5173,
    // API calls go to the server, so the client avoids CORS and absolute URLs
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
}))
