import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Where the backend lives.
 *
 * **8050, not 8080.** 8080 is the default everything else reaches for, and on this
 * device an unrelated app took it mid-session. When that happens the proxy does
 * not fail — it connects to the stranger and waits, so every `/api` call hangs
 * and `waitUntil: 'networkidle'` never fires, and the UI audit dies on an opaque
 * `page.goto` timeout that looks exactly like broken UI. Moving off the crowded
 * port removes the collision; `assertBackend` in `scripts/ui-harness.mjs` catches
 * it if one happens anyway. Still overridable: `API_TARGET=http://localhost:9000`
 * alongside `PORT=9000 node server.js`.
 */
const API_TARGET = process.env.API_TARGET || 'http://localhost:8050'

const proxy = {
  '/api': { target: API_TARGET, changeOrigin: true },
}

/**
 * The typecheck/preview scratch tree, which the server writes into on every run.
 *
 * It lives inside the repo deliberately — TypeScript resolves `react` by walking
 * *up* looking for `node_modules`, so a project materialised here sees the real
 * `@types/react`, and one in `/tmp` sees nothing at all. The cost is that vite's
 * watcher would otherwise notice every write: its defaults only ignore
 * `node_modules` and `.git`, so a dot-directory is watched like any other, and a
 * typecheck during `npm run dev` would reload the page it was checking.
 */
const watch = { ignored: ['**/.preview-work/**'] }

/**
 * React gets its own chunk.
 *
 * Not to shrink the bundle — the bytes are the same either way — but to stop them
 * being re-downloaded. Default chunking put react-dom, react and scheduler in the same
 * file as application code, so every deploy changed that file's hash and every returning
 * visitor fetched ~560K of framework they already had. React changes when React is
 * upgraded; app code changes constantly. Splitting on that boundary is the difference.
 *
 * Matched with a trailing slash so `node_modules/react/` does not also claim
 * `node_modules/react-dom/`, and `jsx-runtime` is inside `react/` already.
 */
const manualChunks = (id: string) =>
  /node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react-vendor' : undefined

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { rollupOptions: { output: { manualChunks } } },
  server: { proxy, watch },
  // `vite preview` needs the same proxy: the UI audit runs against the built
  // output rather than the dev server, because transpiling on demand for a
  // couple of dozen fresh browser contexts kills the dev server on this device.
  preview: { proxy },
})
