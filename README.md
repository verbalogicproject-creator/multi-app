# Gemini Multimodal Chat + App Builder

Private, single-user AI assistant: text/coding chat with tool use, projects/agents/personas,
and a guided web-app builder that goes from an idea to a downloadable React project.
Vite + React 19 client, Express proxy backend (the browser never holds the API key).
Originally exported from Google AI Studio; restored and extended to run standalone.

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

## The builder

A five-step wizard, reachable from **AI Tools**:

1. **Idea** — describe the app in a sentence.
2. **Blueprint** — Gemini drafts a plan (pages, components, acceptance criteria). Every field is
   editable in place, and a feedback box asks the AI to revise it; your manual edits are included
   in what gets sent, and untouched parts are kept stable so the change is legible.
3. **Style** — 12 curated palettes as six-role hex tokens, per-role colour pickers, and five
   typography options. A **live design preview** renders the tokens as a real page (nav, type
   scale, buttons with hover/disabled, card, form fields, success/error/empty states) at no model
   cost. **Suggest 3 directions** asks Gemini for three distinct art directions with rationale.
4. **Generate** — streams progress: which model is serving, what phase it is in, and each file as
   it is written. The result is validated before it is accepted (see below).
5. **Export** — visual preview, ZIP download, "Open in IDE", save/rename in the build library, the
   validation verdict, and the build record.

### Safety rails

- **Nothing is lost to a reload.** Wizard state is persisted; a finished build auto-saves to a
  library of the 10 most recent builds. A generation interrupted by a reload recovers to the style
  step with the plan intact rather than a dead spinner.
- **A model's claim of success is not evidence.** `utils/validateBuild.ts` checks the generated
  files without any model call: unresolved relative imports, truncated files, lazy placeholders
  (`// ... rest of the code`, empty JSX, TODOs, lorem ipsum), empty or invalid JSON files, dangling
  `index.html` references, and planned pages/components that were never generated.
- **Candidate promotion.** A generation lands in a candidate slot and is promoted only once it
  passes, so a bad run can never overwrite a good build. A failed candidate is held for review with
  *Generate again / Keep it anyway / Back to style*.
- **Quota governor.** The server counts requests per model per day (`logs/quota.json`); badges show
  what is left and generation asks for confirmation when the budget is nearly spent.
- **Approval before effects.** Model-generated Python (Pyodide) runs only after you click **Run**.

## Configuration

| Env var | Purpose | Default |
|---------|---------|---------|
| `GEMINI_API_KEY` | Gemini API key (required; `API_KEY` accepted as legacy fallback) | — |
| `PORT` | Backend port | `8080` |
| `MODEL_CHAT` / `MODEL_CODING` | Chat + coding models | `gemini-3.5-flash` |
| `MODEL_BUILDER` | Builder codegen model | `gemini-3.7-flash` |
| `MODEL_IMAGE` / `MODEL_VIDEO` | Media models (features currently flagged off) | `gemini-3.1-flash-image` / `veo-3.1-generate-preview` |
| `QUOTA_LIMITS` | JSON overriding the assumed daily per-model limits | see `server.js` |

The model picker in the UI overrides these per request (Auto, 3.5 Flash-Lite, 3.7 Flash,
3.1 Pro preview). Builder requests retry on transient 429/503 and fall back to the coding model.

Feature flags live in `utils/features.ts`. Image editing, video generation and live audio are
**off** until each is re-verified against current models.

## Checks

```sh
npm run typecheck   # strict tsc, zero errors expected
npm run build       # production bundle
npm run smoke       # backend health (server must be running)
```

## Roadmap

Next cycles, in the order chosen:

1. **Agent link (SAG-lite)** — a localhost-only, token-gated channel where the running app
   publishes bounded context (active project, current step, selection, diagnostics) and accepts
   typed directives, each answered with an effect receipt describing what actually happened. Lets a
   terminal agent drive the app instead of guessing at it.
2. **Real running preview** — execute generated React in the preview iframe (esbuild-wasm or
   Sucrase with import maps) instead of a static snapshot, keeping today's static preview as the
   fallback.
3. **Git-backed history and a repair loop** — `isomorphic-git` over IndexedDB for real diffs,
   revert and branch-per-candidate (also escaping the ~5 MB localStorage ceiling), then use
   validator output to regenerate only the broken file instead of the whole project.
4. **Project memory and skill personas** — a per-project record of decisions and failures injected
   into prompts (inspectable, pinnable, forgettable), and personas upgraded from a prose blob to a
   structured contract (purpose, anti-patterns, allowed tools, output shape).

Deferred media features: image edit (verify current image model), video generation (verify Veo 3.1,
bound the status poll, stop returning multi-MB data URLs), live audio (server-minted ephemeral
tokens, AudioWorklet). Hardening beyond single-user use: see `production-release-roadmap.md`.

### Standing rules

- Never execute model-chosen dependencies or model-generated code without explicit approval.
- Report what was **observed** separately from what is **proposed**; a model asserting success is
  never evidence that something works.

## On-device development note (Android/PRoot)

`node_modules` cannot live on Android shared storage (no symlinks). Work in `/root/multi-app`
(this repo) and mirror sources to `/mnt/sdcard/Download/claude-projects/AI-LAB/multi` for backup:

```sh
rsync -a --delete --exclude node_modules --exclude dist --exclude .git \
  --exclude .env --exclude logs \
  /root/multi-app/ /mnt/sdcard/Download/claude-projects/AI-LAB/multi/
```
