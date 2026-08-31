# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Vite-powered React 19 client and an Express API proxy. `index.tsx` and `App.tsx` bootstrap the UI. Reusable views live in `components/`, with the guided app builder under `components/builders/`. Put shared state in `context/`, reusable React behavior in `hooks/`, API and platform integrations in `services/`, general helpers in `utils/`, and domain types in `types/`. The Node backend is the root-level `server.js`; production assets are generated into `dist/`. Static entry metadata lives in `index.html` and `metadata.json`.

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

There is no automated test framework or coverage threshold yet. Before submitting changes, run `npx tsc --noEmit` and `npm run build`, then manually exercise affected chat, upload, streaming, or builder flows with both development processes running. If adding tests, prefer colocated `*.test.ts` or `*.test.tsx` files and add the runner command to `package.json`.

## Commit & Pull Request Guidelines

Recent history uses concise imperative subjects, sometimes with Conventional Commit prefixes such as `feat:`, `chore:`, or scoped forms like `docs(custom):`. Keep each commit focused. Pull requests should explain the behavior change, list verification performed, link relevant issues, and include screenshots or recordings for UI changes. Call out environment-variable, API-contract, or dependency changes explicitly.
