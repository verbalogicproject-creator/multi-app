# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Vite-powered React 19 client and an Express API proxy. `index.tsx` and `App.tsx` bootstrap the UI. Reusable views live in `components/`, with the guided app builder under `components/builders/`. Put shared state in `context/`, reusable React behavior in `hooks/`, API and platform integrations in `services/`, general helpers in `utils/`, and domain types in `types/`. The Node backend is the root-level `server.js`; production assets are generated into `dist/`. Static entry metadata lives in `index.html` and `metadata.json`.

Builder-specific modules worth knowing before changing that flow:

- `services/buildStorage.ts` — persistence of in-progress builder state and the saved-build library (quota-aware, evicts oldest).
- `utils/validateBuild.ts` — deterministic post-generation checks; pure and dependency-free, so it is the easiest place to add a new quality gate.
- `utils/palettes.ts` / `utils/designContract.ts` — design tokens and the self-contained HTML preview rendered from them.
- `context/AppContext.tsx` — builder state machine, candidate promotion and the evidence trail.

Two invariants to preserve: builder state is persisted on **content fields only** (never on `status`, which churns once per streaming chunk), and colours arriving from a model or from storage must pass `sanitizeColors` before reaching the preview or a prompt.

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

## Commit & Pull Request Guidelines

Recent history uses concise imperative subjects, sometimes with Conventional Commit prefixes such as `feat:`, `chore:`, or scoped forms like `docs(custom):`. Keep each commit focused. Pull requests should explain the behavior change, list verification performed, link relevant issues, and include screenshots or recordings for UI changes. Call out environment-variable, API-contract, or dependency changes explicitly.
