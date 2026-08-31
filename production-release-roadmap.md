# Production Release Roadmap

## Purpose and Status

This roadmap turns the current AI Studio prototype into a stable, reliable, privately deployed MVP. It is based on the August 23, 2026 production audit. The application is salvageable, but it is not deployable today: the backend does not parse, several provider integrations are retired, privileged model tools execute automatically, chat state crosses agent boundaries, and no release gates exist.

**Recommended strategy:** selectively reconstruct the runtime and safety boundaries while retaining useful React components. Do not rewrite the whole UI.

## MVP Product Decision

The first producing MVP is a **private, single-user AI project assistant**, not a public SaaS product.

### Included in MVP

- Same-origin authenticated access for one administrator.
- Reliable text and coding chat through the server only.
- Projects, virtual files, personas, and agents.
- Durable, agent-keyed conversation history.
- Read-only AI tools and proposed file changes shown as diffs.
- Explicit user approval before create, update, or delete operations.
- Versioned project import/export with verified backup restoration.
- Streaming responses with cancel, timeout, visible failure, and retry controls.
- Health checks, structured logs, quotas, CI, and a reproducible production artifact.

### Deferred Behind Disabled Feature Flags

- Live audio and browser-to-Gemini connections.
- Image editing and video generation.
- Pyodide/model-generated code execution.
- Autonomous file mutation.
- Web-app builder, virtual terminal, and automatic dependency analysis.
- Public registration, multi-tenancy, billing, collaboration, and cloud file storage.

Deferred code must not be reachable from the UI or API. Each feature returns only after its own threat model, provider-contract tests, resource limits, and end-to-end release gate pass.

## Target Architecture

- **Client:** Vite/React/TypeScript, with all dependencies bundled locally. Remove the AI Studio import map and runtime Tailwind/JSZip/Pyodide CDNs.
- **Server:** compiled TypeScript Express application on Node 24 LTS. It owns provider credentials, authentication, request validation, quotas, and provider calls.
- **Provider boundary:** a `GeminiProvider` adapter selected through validated configuration. Model IDs are configuration, not scattered constants. Startup rejects missing or retired required capabilities.
- **Data:** versioned IndexedDB repositories for projects, files, agents, conversations, and messages. Storage methods reject on failure; UI state changes only after committed persistence.
- **Streaming:** a typed same-origin SSE protocol with `meta`, `delta`, `tool_proposal`, `error`, and mandatory `done` events. Client cancellation propagates to the provider.
- **Access:** one-admin login using a server-side password hash and signed `Secure`, `HttpOnly`, `SameSite=Strict` session cookie. The service binds to `127.0.0.1` by default; remote exposure requires TLS and a documented reverse proxy.

Keep client storage behind repository interfaces so a later multi-user edition can replace IndexedDB with PostgreSQL and object storage without rewriting components.

## Delivery Phases

### Phase 0 — Establish a Reproducible Baseline (1–2 days)

**Work**

- Move or initialize this folder as a deliberately tracked standalone repository.
- Add `.gitignore`, `.env.example`, supported-browser policy, and secret-handling notes.
- Pin Node 24 LTS in `engines` and `.nvmrc`; declare the npm version/package manager.
- Record current localStorage keys and create fixtures for any data that must migrate.
- Add feature flags defaulting every deferred feature to off.

**Checkpoint**

- A clean clone at an exact commit runs `npm ci --ignore-scripts` without manifest/lock drift.
- No `.env`, API key, generated output, or `node_modules` file is tracked.
- `git status --short` is empty after validation.

### Phase 1 — Restore Build and Runtime Integrity (3–4 days)

**Work**

- Replace `server.js` with typed server modules and separate client/server/shared TypeScript configurations.
- Use type-only imports and a compiled production entry point.
- Validate environment configuration once at startup; standardize on `GEMINI_API_KEY`.
- Remove import-map and development CDN dependencies; install Tailwind and JSZip through npm. Do not load Pyodide in the MVP bundle.
- Introduce the provider adapter and a supported configurable text model.
- Add `/healthz` for process health and `/readyz` for configuration/provider readiness.
- Implement graceful shutdown for HTTP connections and active streams.

**Checkpoint**

```sh
npm run typecheck
npm run lint
npm run build
npm run test:startup
npm run smoke
```

The compiled server starts without credentials in a documented degraded/test mode, fails clearly for invalid production configuration, serves the built client, and passes both health endpoints.

### Phase 2 — Secure the Cost and Tool Boundaries (4–5 days)

**Work**

- Require an authenticated session for every `/api` route.
- Restrict CORS and validate `Origin`, JSON bodies, query strings, and provider payloads with shared schemas.
- Add security headers, request IDs, rate limiting, concurrency ceilings, and daily/request token budgets.
- Set small explicit JSON limits; reject unexpected MIME types and oversized uploads even though media routes remain disabled.
- Add provider deadlines and bounded retries. Retry transient failures only before stream output begins.
- Change tool calls into proposals. Read tools may run only against the selected project; mutations require a reviewed diff and fresh confirmation.
- Remove `runPython` from the advertised tool set and production bundle.

**Checkpoint**

- Anonymous, cross-origin, malformed, oversized, and over-quota requests receive deterministic 4xx responses without provider calls.
- Tests prove a synthetic `deleteFile`, `updateFile`, or `runPython` model response cannot cause an effect without approval.
- A bundle scan finds no provider credential or secret value.

### Phase 3 — Repair Data Ownership and Durability (4–5 days)

**Work**

- Introduce IndexedDB stores and schema migrations for projects, files, agents, conversations, and messages.
- Key every conversation by agent and project; reset or load history atomically when switching agents.
- Make storage failures visible and preserve the last committed state.
- Implement versioned export/import that reads from durable storage, validates schema and checksums, and reports file/message counts before restore.
- Provide a one-time localStorage migration with a preview and recoverable backup.

**Checkpoint**

- Agent A history never appears in or gets sent as Agent B history.
- Forced quota, malformed-record, interrupted-migration, and duplicate-import tests do not produce false success or destroy prior data.
- A project with unloaded files exports completely; export-delete-import restores byte-identical files and message counts.

### Phase 4 — Make Chat Failure-Safe (3–4 days)

**Work**

- Replace the current per-read NDJSON parser with typed SSE framing and a mandatory terminal event.
- Preserve split UTF-8 and fragmented records across transport reads.
- Propagate `AbortController` cancellation from UI to server and provider.
- Add first-byte and total deadlines, a maximum tool-step count, and visible retry guidance.
- Normalize provider 400, 401, 429, timeout, cancellation, and 5xx failures into safe user-facing errors and structured logs.

**Checkpoint**

- Tests split every event at every byte boundary without losing or duplicating content.
- Truncated streams end in an error state, never a completed assistant response.
- Hung, rate-limited, disconnected, and cancelled provider simulations release resources and restore an interactive UI.

### Phase 5 — Add Quality Gates and Product Polish (4–6 days)

**Work**

- Add Vitest unit tests, React Testing Library component tests, Supertest API tests, and Playwright browser flows.
- Cover authentication, streaming, agent isolation, storage migration, backup restore, tool approval, quota handling, and provider failures.
- Add ESLint, Prettier, accessibility checks, dependency scanning, and secret scanning.
- Remove duplicate/dead components and replace `any` at external boundaries with validated types.
- Update README, architecture, operations, security, backup, and troubleshooting documentation.

**Checkpoint**

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
npm run audit:deps
npm run ci
```

All critical flows and every repaired audit defect have deterministic regression tests. There are no unresolved critical/high dependency advisories without a documented, time-bounded exception.

### Phase 6 — Package, Operate, and Release (2–3 days)

**Work**

- Produce a multi-stage, non-root container or an equivalently reproducible service artifact.
- Configure TLS termination, secret injection, log retention, restart policy, memory/CPU ceilings, and backup location.
- Add CI on Node 24 LTS for the real deployment architecture; add arm64 where deployment requires it.
- Run a bounded soak test, backup/restore drill, restart test, and provider-degraded-mode test.
- Record artifact digest, source commit, configuration schema version, test receipts, and rollback steps.

**Checkpoint / Release Gate**

- Clean exact commit and immutable artifact digest.
- All `npm run ci` gates pass in CI and a clean proot Ubuntu checkout.
- `/healthz` and `/readyz` behave correctly during startup, steady state, provider failure, and shutdown.
- No P0/P1 audit finding remains open.
- Memory stays within the configured ceiling during the single-user soak test.
- Previous artifact can be restored without data loss; any data migration is backward-compatible or has a verified restore procedure.

## Required Package Scripts

The repaired repository should expose at least:

```json
{
  "dev": "run client and server development processes",
  "dev:client": "start Vite",
  "dev:server": "start typed server in watch mode",
  "typecheck": "check client, server, and shared types",
  "lint": "run ESLint with zero warnings",
  "format:check": "verify formatting",
  "test": "run deterministic unit tests",
  "test:integration": "run API and persistence tests",
  "test:e2e": "run critical Playwright flows",
  "test:startup": "verify configuration and server startup",
  "build": "build client and server",
  "start": "run compiled production server",
  "smoke": "exercise built health, login, and chat surfaces",
  "audit:deps": "run current dependency/advisory checks",
  "ci": "run every required release gate"
}
```

## Proot Ubuntu and CI Policy

Use `proot-ubuntu` as a clean Linux/glibc ARM64 validation environment:

1. Start from a clean checkout, not the dirty Termux tree.
2. Install the pinned Node/npm toolchain inside proot.
3. Run `npm ci` and `npm run ci` inside proot.
4. Build and smoke-test the artifact there.

Never copy or share `node_modules` among Termux, proot, CI, or the production host. Native packages such as esbuild/Rollup binaries are platform-specific. Proot validation does not replace CI on the actual deployment architecture, commonly Linux amd64.

## Reliability Rules for All Future Features

Every provider-backed feature must have:

- A server-owned credential or short-lived delegated token.
- A supported model capability checked through configuration.
- Authentication, ownership, quota, input limits, timeout, cancellation, and bounded retry behavior.
- A disabled/degraded UI state when the provider is unavailable.
- Mocked success/failure contract tests plus a controlled live smoke test.
- Structured logs without prompts, project contents, credentials, or generated media by default.
- A feature flag and rollback path independent of the core chat release.

## Risks and Decisions Needed

Before implementation begins, the owner must confirm:

1. Whether the first deployment is loopback-only or remotely accessible behind TLS.
2. Whether existing localStorage projects must be migrated or may be exported manually.
3. The monthly provider budget and per-request/token ceilings.
4. Supported browsers and the production CPU architecture.
5. Data-retention and diagnostic-log policy.

Default if unanswered: loopback-first deployment, migrate existing local data, conservative quotas, current Chrome/Firefox/Safari, Linux amd64 plus arm64 CI, and no prompt/content logging.

## Estimate and Recommended Next Route

The scoped private MVP is approximately **21–29 engineer-days**, or **4–6 weeks for one experienced full-stack engineer**. Two engineers can reduce calendar time, but security, migrations, and release qualification remain sequential gates.

Begin with Phase 0 and Phase 1 only. After the clean build and startup checkpoint, re-estimate from the actual compiler, dependency, and provider-contract failures. Do not reactivate deferred media, Live, builder, or execution features merely because the core MVP builds.
