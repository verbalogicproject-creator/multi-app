# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Vite-powered React 19 client and an Express API proxy. `index.tsx` and `App.tsx` bootstrap the UI. Reusable views live in `components/`, with the guided app builder under `components/builders/`. Put shared state in `context/`, reusable React behavior in `hooks/`, API and platform integrations in `services/`, general helpers in `utils/`, and domain types in `types/`. The Node backend is the root-level `server.js`; production assets are generated into `dist/`. Static entry metadata lives in `index.html` and `metadata.json`.

Builder-specific modules worth knowing before changing that flow:

- `services/buildStorage.ts` — persistence of in-progress builder state and the saved-build library (quota-aware, evicts oldest).
- `utils/validateBuild.ts` — deterministic post-generation checks; pure and dependency-free, so it is the easiest place to add a new quality gate.
- `utils/palettes.ts` / `utils/designContract.ts` — design tokens and the self-contained HTML preview rendered from them.
- `context/AppContext.tsx` — builder state machine, candidate promotion, the evidence trail, and the client-side memory taps.
- `services/memoryService.ts` — the client's only route to memory. Every function answers `null` rather than throwing.
- `memory/bridge.js` / `memory/routes.js` — the server's side: one `GraphMemory` per build, and the `/api/memory/*` surface.

Provider layer (`providers/`): `server.js` routes every model call through one interface — `streamChat`, `streamJson`, `generateJson`, `generateText`, each yielding normalized `{text, thinking, toolCalls, usage}` events. **Adding a model is one entry in `providers/catalog.js`**; adding a provider is one adapter plus a line in `providers/index.js`. Capability flags in the catalog (`efforts`, `thinkingStyle`, `maxOutput`, `tools`, `jsonMode`) exist because provider behaviour is genuinely not uniform — an unsupported thinking level, an over-large `max_tokens`, or the wrong reasoning parameter is a hard 400, not a graceful degrade. Verify a new model with `npm run smoke:providers -- <model-id>` before adding it; do not infer capabilities from a sibling model.

Invariants to preserve:

- Builder state is persisted on **content fields only** — never on `status`, which churns once per streaming chunk.
- Colours arriving from a model or from storage must pass `sanitizeColors` before reaching the preview or a prompt.
- **No memory tap may gate a builder transition.** Taps are additive and fire-and-forget; the one awaited call is opening an episode, and a null episode id makes every later tap a no-op. If memory can change what the builder does, the tap is wrong.
- **`builderState.memory.episodeId` is non-null only while an episode is open.** Every close path clears it, which is what makes an id still present at startup unambiguously an episode a reload cut short.
- **Read the memory link from `memoryRef.current`, never from `builderState.memory`, and write it only through `setMemory`.** A handler closes over the state of the render that created it, and a generation opens its episode *during* that handler — so a handler reading state sees the episode id from before it existed. That is not theoretical: it made a verified build fail to close its own episode, which the next reload then recorded as `abandoned`. The same hazard applies to `evidence`, which is why `promoteFiles` takes an `evidenceBase` from the generation that called it.
- **An event's `domain` must come from the engine's declared vocabulary** (`MemoryDomain` in `services/memoryService.ts`, mirroring the engine's `LESSON_DOMAINS`). An undeclared domain fails schema validation and the whole event is refused — the bridge can only report that as a count, so the union is the thing that catches it.
- **A verdict is recorded by stable issue `code`, never by message.** Events are immutable; rewording a check must not read downstream as a new kind of failure.

## Build, Test, and Development Commands

- `npm install` installs the locked dependencies from `package-lock.json`.
- `npm run dev` starts the Vite frontend; `/api` requests proxy to port 8080.
- `npm start` starts the Express backend on `PORT` or port 8080.
- `npm run build` creates the production frontend bundle in `dist/`.
- `npx tsc --noEmit` runs the strict TypeScript check without writing files.

Run the frontend and backend in separate terminals for full local development. Create `.env.local` or export environment variables locally; the backend expects `GEMINI_API_KEY` (legacy `API_KEY` also accepted). Never commit credentials.

## Coding Style & Naming Conventions

Follow the existing TypeScript/React style: four-space indentation, semicolons, single-quoted imports, and functional components. Name components and type declarations in `PascalCase`, hooks as `useCamelCase`, functions and variables in `camelCase`, and component files to match their exported component (for example, `components/ChatPanel.tsx`). Keep HTTP calls in `services/` and avoid duplicating shared interfaces outside `types/`. No formatter or linter is configured, so keep edits consistent with surrounding code.

## Testing Guidelines

There is no test runner wired into `package.json` yet. Before submitting changes, run `npx tsc --noEmit` and `npm run build`, then exercise the affected chat, upload, streaming or builder flows with both processes running.

The pure modules (`utils/validateBuild.ts`, `utils/palettes.ts`, `utils/designContract.ts`, `services/buildStorage.ts`) are deliberately dependency-free and have been verified by bundling them with the local `esbuild` binary and running assertions under Node with a `localStorage` shim — a practical pattern on this device, where a browser test runner is impractical. If you add a runner, prefer colocated `*.test.ts` files and add the command here.

When touching generation, verify against the live API rather than trusting types: check that acceptance criteria and theme tokens actually appear in generated output, and that the validator does not fire on real (good) model output.

The memory lifecycle needs **no model and no key** to verify: `/api/memory/*` calls no provider. Start the backend on a spare port with a scratch database directory (`PORT=8177 MEMORY_DB_DIR=/tmp/scratch npm start`), replay the open → events → close sequence over HTTP, then read it back with `multi-memory --build <id> episode list`.

Read the two boot lines before trusting a run. A second server on an occupied port dies with `EADDRINUSE` while the one already there keeps answering — writing to whatever database *it* was started with — so the server prints `Memory databases: <dir>` alongside its port, and `/api/memory/state` reports the same `databaseDir`. A refused event comes back with the engine's own reason in `rejected[].reason`, naming the field it rejected and the vocabulary it wanted; the bridge's last failure is also on `/api/memory/state`.

## Commit & Pull Request Guidelines

Recent history uses concise imperative subjects, sometimes with Conventional Commit prefixes such as `feat:`, `chore:`, or scoped forms like `docs(custom):`. Keep each commit focused. Pull requests should explain the behavior change, list verification performed, link relevant issues, and include screenshots or recordings for UI changes. Call out environment-variable, API-contract, or dependency changes explicitly.
