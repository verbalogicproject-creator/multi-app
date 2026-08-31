# Gemini Multimodal Chat + App Builder

Private, single-user AI assistant: text/coding chat with tool use, projects/agents/personas,
and a guided web-app builder. Vite + React 19 client, Express proxy backend (the browser never
holds the API key). Originally exported from Google AI Studio; restored to run standalone.

## Run locally

**Prerequisites:** Node.js 24+

```sh
npm install
cp .env.example .env        # then set GEMINI_API_KEY
npm run dev:server          # Express backend on :8080
npm run dev                 # Vite frontend on :5173 (proxies /api to :8080)
```

Production: `npm run build` then `npm start` (serves the built client from `dist/` on :8080).

Health check: `curl localhost:8080/healthz` (also reports the active model registry).

## Configuration

| Env var | Purpose | Default |
|---------|---------|---------|
| `GEMINI_API_KEY` | Gemini API key (required; `API_KEY` accepted as legacy fallback) | — |
| `PORT` | Backend port | `8080` |
| `MODEL_CHAT` / `MODEL_CODING` / `MODEL_BUILDER` | Text model overrides | `gemini-2.5-flash` |
| `MODEL_IMAGE` / `MODEL_VIDEO` | Media model overrides (features currently flagged off) | `gemini-2.5-flash-image` / `veo-3.1-generate-preview` |

Feature flags live in `utils/features.ts`. Image editing, video generation, and live audio are
**off** until each is re-verified against current models (live audio additionally requires
server-side ephemeral tokens). Model-generated Python (Pyodide) runs only after you click **Run**
on the approval card.

## Checks

```sh
npm run typecheck   # strict tsc, zero errors expected
npm run build       # production bundle
npm run smoke       # backend health (server must be running)
```

## Roadmap (deferred features)

1. **Image edit** — enable flag, verify `gemini-2.5-flash-image` (or `gemini-3.1-flash-image`).
2. **Video gen** — enable flag, verify Veo 3.1; bound the status poll loop (timeout + abort) and
   stop returning multi-MB base64 data URLs.
3. **Live audio** — server-minted ephemeral tokens, current live model, AudioWorklet migration.
4. Hardening beyond single-user use: see `production-release-roadmap.md`.

## On-device development note (Android/PRoot)

`node_modules` cannot live on Android shared storage (no symlinks). Work in `/root/multi-app`
(this repo) and mirror sources to
`/mnt/sdcard/Download/claude-projects/AI-LAB/multi` for backup:

```sh
rsync -a --exclude node_modules --exclude dist --exclude .git --exclude .env \
  /root/multi-app/ /mnt/sdcard/Download/claude-projects/AI-LAB/multi/
```
