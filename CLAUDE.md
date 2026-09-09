# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A private, single-user AI assistant: text/coding chat with tool use, projects/agents/personas, and a
guided web-app builder that goes from an idea to a downloadable, previewable React project. Vite +
React 19 client, Express proxy backend — the browser never holds a provider API key. Four LLM
providers (Gemini, Claude, OpenAI, NVIDIA NIM), a graph-memory system that lets builds learn from
their own failures, and an IDE (CodeMirror + a real `tsc`/esbuild verification pipeline) that can
open a generated project and keep editing it with model help.

Read `README.md` first for the product-level tour (providers, the builder wizard, memory lifecycle,
env vars). Read `AGENTS.md` for the load-bearing invariants and the reasoning behind non-obvious
design choices — it is denser and more important than this file for anything touching the builder,
memory, or the provider layer. `DESIGN.md`, `HARNESS.md`, and `ON-DEMAND-PACKAGES.md` are living
records of specific subsystems (visual design tokens, generation-prompt declarations, and a deferred
on-demand-package design respectively) — read the relevant one before changing what it covers, and
update it as part of the change rather than letting it drift.

## Commands

```sh
npm install                # locked deps from package-lock.json
npm run dev:server         # Express backend on :8050 (not 8080 — see below)
npm run dev                # Vite frontend on :5173, proxies /api to :8050
npm start                  # production: serve dist/ from the Express backend
npm run build              # production frontend bundle -> dist/
npm run typecheck          # tsc --noEmit, strict, zero errors expected
```

The backend must run on **8050, not 8080** — 8080 is contended by other tools on this device, and a
stranger holding it hangs the dev proxy instead of failing it. `PORT` overrides the backend; move
`API_TARGET` with it if you do.

There is no lint/format command configured. Pure logic is covered by Vitest under `npm test`;
everything that needs a real browser, a spawned server, or a live model stays a standalone script,
run separately:

```sh
npm test                    # Vitest — pure logic: providers/, memory/, auth config, utils/
npm run test:watch          # the same, in watch mode
npm run smoke:memory        # spawns a real server on a scratch DB with a deliberately bad key
npm run check:auth          # spawns the real server.js — boot posture, CORS allowlist, /api gate
npm run check:css           # asserts no CSS declarations were dropped
npm run audit:ui            # build + real Chrome (CDP) pass over every declared UI surface
npm run check:editor        # build + CDP: CodeMirror, undo/redo/save semantics, diagnostics
npm run check:preview       # build + CDP: the sandboxed iframe preview and its failure modes
npm run check:pipeline      # build + CDP: plan-mode -> brief -> "Send to Builder" hand-off
npm run smoke:providers -- <model-id> [<model-id> ...]   # live calls, costs real requests
```

Run the whole set before calling any change to the builder, memory, provider layer, IDE, or auth
done — `npm test` first (seconds, no build), then the CDP ones (need `npm run build` and, for
`audit:ui`/`check:editor`/`check:preview`/`check:pipeline`, the backend running on :8050).
`smoke:providers` is the only one that spends real quota — pass specific model ids rather than
running it broadly.

Two tiers, split by what they need: `test/*.test.mjs` holds pipeline-level tests that span several
modules together (generation, the memory ladder) and don't map to one file to colocate next to;
`*.test.ts`/`*.test.js` colocated beside the module they test (`utils/patchFile.test.ts`,
`auth/index.test.js`) is for a genuinely standalone module. Vitest was picked over Node's own
`node --test` (which the sibling `multi-graph-memory` repo uses) because this repo already depends on
Vite for the frontend build — reusing that toolchain beats adding a second one; `multi-graph-memory`
has no Vite dependency to reuse, hence its own choice. `vitest.config.ts` is deliberately separate
from `vite.config.ts` — the React/Tailwind plugins that file configures have nothing to verify in a
Node-environment logic test.

A script under `scripts/` that spawns a real server or drives Playwright follows the same
`ok(label, condition, detail)` pattern each one already used before Vitest existed — printing
`ok`/`FAIL` per line and a final pass/fail summary — rather than being ported to Vitest, since a
`beforeAll` that spawns a process or launches Chrome is a different kind of setup cost than what
`npm test` should carry by default.

**A check must fail by a *named* assertion when its fix is reverted.** This repo's convention (see
`AGENTS.md`) is to prove that before considering a fix or a gate done: revert the change, confirm the
specific assertion (not just "some test") goes red, then restore. Several commit messages in this
repo's history record exactly that revert-and-restore step as verification.

## Architecture

### Provider layer (`providers/`)

`server.js` never talks to a model SDK directly (a couple of flagged-off media features aside).
Everything goes through one interface — `streamChat`, `streamJson`, `generateJson`, `generateText` —
each yielding normalized `{text, thinking, toolCalls, usage}` events:

- `catalog.js` — single source of truth for every model: id, provider, capabilities (`efforts`,
  `thinkingStyle`, `maxOutput`, `tools`, `jsonMode`), price, output ceiling, fallback chain. Adding a
  model is one entry here; adding a provider is one adapter (`google.js` / `anthropic.js` /
  `openai.js` / `nvidia.js`) plus a line in `index.js`.
- `schemas.js` / `tools.js` — structured-output schemas and tool declarations, written once in the
  strict dialect every provider's structured-output mode accepts (every property required, no
  optionals, `additionalProperties: false`, no length/pattern constraints), then translated per
  provider.
- `prompts.js` — one system prompt per provider family, in each vendor's own documented house style
  (XML-tagged third-person prose for Claude, lean imperative for OpenAI, structured markdown for
  Gemini, short numbered rules for the NVIDIA-hosted open models) rather than one shared
  lowest-common-denominator prompt.
- `effort.js` — one internal reasoning-effort scale mapped to each provider's actual mechanism, with
  per-model clamping (an unsupported thinking level or an oversized `max_tokens` is a hard 400, not a
  graceful degrade).
- `generate.js` / `scaffold.js` / `salvage.js` / `aesthetic.js` / `allowlist.js` — the app-builder's
  generation strategy specifically (see below).

Verify a new model with `npm run smoke:providers -- <model-id>` before adding it to the catalog;
capabilities are never inferred from a sibling model — provider behavior genuinely is not uniform.

### The app builder

A five-step wizard (`components/builders/`, state machine in `context/AppContext.tsx`) that turns an
idea into a validated React project: Idea → Blueprint (plan with typed `entities[]` and acceptance
criteria) → Style (palette/typography tokens + an aesthetic directive, `providers/aesthetic.js`) →
Generate → Export.

**Generation asks for a manifest first** (file paths + one-line purpose, no code), then one request
per file against it (`providers/generate.js`). That is what keeps the whole thing under the model's
output-token ceiling rather than recovering from truncation after the fact, and it makes a stopped
build resumable — what's missing is a set difference against the manifest, not a guess.

**A model's claim of success is never evidence.** `utils/validateBuild.ts` is a pure, dependency-free
post-generation check (unresolved imports, truncated files, lazy placeholders, invalid JSON, dangling
`index.html` references, planned-but-missing pages). A generation lands in a candidate slot and is
only promoted once it passes; a failed candidate is held for review. `providers/salvage.js` similarly
decides, without a model, whether a cut-off response counts as evidence at all — an instrument failure
(ran out of output budget) must never be scored as if the model wrote bad code.

**Independent verification, on purpose, more than once:** `typecheck/` runs the real `tsc` against
generated code inside the repo (so it resolves the real `@types/react`, not nothing, the way `/tmp`
would); `preview/` bundles with esbuild over a virtual filesystem and runs the result in a sandboxed
iframe at an opaque origin (shimmed `history`/`localStorage`/`document.cookie`, `MemoryRouter` swapped
in for `BrowserRouter`); Sandpack (`components/builders/SandpackAppPreview.tsx`) gives a second,
independent live preview. These must never collapse into each other — the failure this whole
verification stack exists to prevent is "every judge that reads the code passed a build that does not
run."

### Memory (`memory/`, consumed from `/root/multi-graph-memory`)

The builder records what it did and recalls what it learned, in **one SQLite database shared by
every build** — `.multi-memory/builder.db`, scoped to the constant project id `builder`
(`memory/bridge.js`). That is deliberate: a builder lesson is about the model and the toolchain
("this model writes unterminated template literals"), not about one application, so every build
inherits them. The build id survives as an attribution dimension (`cycleId` on events,
`baseRevisionId` on episodes), which keeps one build's own history separable while its lessons stay
common property. The `build-*.db` files beside it are pre-unification residue.
A failed validator verdict proposes a lesson through a declared table
(`memory/proposals.js`, one entry per validator issue code — no model in that decision); a lesson
climbs `proposed → qualified → approved` only by being tried in a *later, different* attempt that then
passes, with `approved` reserved for a human via `POST /api/memory/lessons/:id/approve`. **Nothing on
the builder's critical path waits on memory** — every client call bounds itself at 2s and answers
`null` rather than throwing. See README's "How memory works" for the full lifecycle and the
`AGENTS.md` invariants list for the specific hazards already found and fixed (stale closures over
`builderState.memory`, an event's `domain` needing the engine's declared vocabulary, `tsc` diagnostic
codes vs. message text, etc.) — several are the kind of bug that reintroduces itself silently on the
next refactor if the invariant isn't read first.

### The IDE and the peer-programmer loop

`components/IdeView.tsx` (CodeMirror editor, file tree, a drawer with Terminal/Problems/Ask tabs) is
what a generated project opens into. `types/project.ts`'s `Project.origin` carries the plan, theme,
and acceptance criteria a project was built from, so the model isn't reasoning about a project it has
amnesia about. `hooks/useChat.ts` attaches a fresh file tree, `tsc` diagnostics summary, and preview
verdict to every coding-mode chat turn (computed fresh each time, not read from the IDE's own live
component state — a deliberate choice to avoid coupling to two heavily-covered components). Tool
calls execute as a queue (`utils/toolSequence.ts`'s `splitAtApprovalGate`): a `runPython` call pauses
the sequence for approval wherever it occurs, and everything queued behind it survives to resume
afterward rather than being dropped. `/api/builder/edit` (`components/EditPanel.tsx`, the "Ask" tab)
is "generate again, but with feedback" — a natural-language instruction against the whole current file
set, verified through the same typecheck → preview pipeline generation itself uses before it lands.

### Auth (`auth/`)

Google/GitHub OAuth gating the whole `/api` surface. The actual invariant (`auth/config.js`'s
`bootPosture`) is **"reachable from the network or unauthenticated, but not both"** — not "auth is off
in dev." Unconfigured + bound to loopback (`127.0.0.1`, the default): the server starts, unenforced, with
a `console.warn` naming exactly what's missing. Unconfigured + bound to a non-loopback host
(`HOST=0.0.0.0`, e.g. testing from a phone on the LAN): `server.js` calls `process.exit(1)` before it
ever listens. A default JWT signing secret, an empty allowlist, or an unvalidated redirect are the kind
of default that works in development and is wide open the moment the host isn't loopback — that's the
condition the fatal path exists for, not misconfiguration by itself. Verify changes here with two
gates, not by hand: `npm test`'s `auth/index.test.js` asserts CSRF `state` validation and the
second-provider allowlist in-process (a throwaway Express app, `globalThis.fetch` stubbed — the only
way to prove a *negative*, that a bad `state` never reaches Google at all); `npm run check:auth`
spawns the real `server.js` and asserts cookie flags, fail-closed CORS, and forged-session rejection
against it — properties of that file's own wiring, not of any module it imports.

## Coding conventions

Four-space indentation, semicolons, single-quoted imports, functional components. Components and
types in `PascalCase`, hooks as `useCamelCase`, functions/variables in `camelCase`; a component file
matches its exported component's name. Keep HTTP calls in `services/`, shared interfaces in `types/`,
pure logic in `utils/` (kept dependency-free where possible — several are deliberately checkable by
bundling with the local `esbuild` binary and running assertions under plain Node with a `localStorage`
shim, without a browser). No formatter or linter is configured; match surrounding code.

## Non-obvious invariants worth reading before touching related code

These are compressed from `AGENTS.md`, which has the full reasoning and the incidents each one
prevents — read it before relying on this summary for anything in the builder or memory path:

- Builder state persists on **content fields only**, never on `status` (churns once per stream chunk).
- Colors from a model or from storage pass `sanitizeColors` before reaching the preview or a prompt.
- No memory tap may gate a builder transition — taps are fire-and-forget; a null episode id makes
  every later tap a no-op by design.
- Read the memory link from `memoryRef.current`, never from `builderState.memory` (a stale-closure
  hazard that has already caused a real bug: an episode opened mid-handler wasn't visible to the
  handler that opened it, so a completed build was recorded `abandoned` on the next reload).
- An event's `domain` must come from the engine's declared vocabulary (`MemoryDomain` in
  `services/memoryService.ts`); an undeclared one fails schema validation for the whole event.
- A `tsc` diagnostic's `code` is decided by its error range (TS1xxx/TS17xxx = grammar, TS2xxx+ =
  types), never by the fact that `tsc` produced it.
- A verdict is recorded by stable issue `code`, never by message text — rewording a check's message
  must not read downstream as a new kind of failure.
- "A filter is a blind spot" and "presence is not validity" — a narrowed check must say what it can no
  longer see (or be paired with one that covers the excluded set), and an id crossing a collection
  boundary (project id, persona id, etc.) is resolved at the point of use, with a miss handled
  explicitly, never just checked for non-null and trusted.
