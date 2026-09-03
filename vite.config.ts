import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Where the backend lives.
 *
 * Overridable because 8080 is a popular port on this device and it has already
 * been taken by an unrelated app mid-session. When that happens the proxy does
 * not fail — it connects to the stranger and waits, so every `/api` call hangs
 * and `waitUntil: 'networkidle'` never fires. The UI audit then dies on an
 * opaque `page.goto` timeout that looks exactly like broken UI. Set
 * `API_TARGET=http://localhost:8090` (and `PORT=8090 node server.js`) to move.
 */
const API_TARGET = process.env.API_TARGET || 'http://localhost:8080'

const proxy = {
  '/api': { target: API_TARGET, changeOrigin: true },
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy },
  // `vite preview` needs the same proxy: the UI audit runs against the built
  // output rather than the dev server, because transpiling on demand for a
  // couple of dozen fresh browser contexts kills the dev server on this device.
  preview: { proxy },
})
