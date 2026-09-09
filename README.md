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
npm run dev:server          # Express backend on :8050
npm run dev                 # Vite frontend on :5173 (proxies /api to :8050)
```

Production: `npm run build` then `npm start` (serves the built client from `dist/` on :8050).

Health check: `curl localhost:8050/healthz` (also reports the active model registry).

The backend is on **8050, not 8080** — 8080 is the port every other tool reaches
for first, and one of them took it here mid-session, which hangs the dev proxy
rather than failing it. `PORT` still overrides; if you move it, move
`API_TARGET` with it.

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
5. **Export** — a **live preview** (the generated project bundled server-side and run in a
   sandboxed iframe, not a static snapshot), ZIP download, "Open in IDE", save/rename in the build
   library, the validation verdict, and the build record.

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

## Providers and models

Four providers are supported. A provider whose API key is absent from `.env` is
hidden entirely — no errors, its models simply do not appear in the picker.

| Provider | Models exposed | Notes |
|----------|----------------|-------|
| Google Gemini | 3.5 Flash, 3.5 Flash-Lite, 3.7 Flash, 3.1 Pro (preview) | Free tier with daily request ceilings; the default for chat and the builder |
| Anthropic Claude | Haiku 4.5, Sonnet 5, Opus 5, Fable 5 | Paid per token |
| OpenAI | GPT-5.6 Luna, Terra, Sol | Paid per token |
| NVIDIA NIM | Llama 3.2 11B, Nemotron Nano 3, Nemotron Lightning, MiniMax M3, Kimi K3 | Free credits; OpenAI-compatible endpoint |

Every model in the catalog was confirmed with a live call on this account. That
matters most for NVIDIA, whose `/v1/models` advertises 83 models but returns
`404 Not found for account`, `410 end-of-life`, or a timeout for many of them —
only models that actually answered are listed.

Pick a model per request with the **Model** dropdown (Auto uses the defaults
below). Free-tier models show requests left; paid models show approximate spend
today, and generating a full project on a paid model asks for confirmation with
a cost estimate first.

### Configuration

| Env var | Purpose | Default |
|---------|---------|---------|
| `GEMINI_API_KEY` | Google key (required; `API_KEY` accepted as legacy fallback) | — |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `NVIDIA_API_KEY` | Optional; each unlocks that provider's models | — |
| `PORT` | Backend port | `8050` |
| `API_TARGET` | Where `vite dev`/`preview` proxy `/api` | `http://localhost:8050` |
| `MODEL_CHAT` / `MODEL_CODING` | Chat + coding defaults | `gemini-3.5-flash` |
| `MODEL_BUILDER` | Builder codegen default | `gemini-3.7-flash` |
| `MODEL_IMAGE` / `MODEL_VIDEO` | Media models (features flagged off) | `gemini-3.1-flash-image` / `veo-3.1-generate-preview` |
| `QUOTA_LIMITS` | JSON overriding assumed daily free-tier request limits | see `server.js` |
| `MODEL_PRICES` | JSON overriding per-1M token prices used for spend estimates | see `providers/catalog.js` |
| `MEMORY_DB_DIR` | Where the builder's memory database is written | `.multi-memory/` |

Feature flags live in `utils/features.ts`. Image editing, video generation and
live audio are **off** pending re-verification against current models.

### How the provider layer works

`server.js` never talks to a model SDK directly (except the flagged-off media
features). Everything goes through `providers/`:

- **`catalog.js`** — the single source of truth. Adding a model is one entry:
  its id, provider, capabilities, price, output ceiling and fallback chain.
- **`google.js` / `anthropic.js` / `openai.js` / `nvidia.js`** — adapters
  implementing one interface (`streamChat`, `streamJson`, `generateJson`,
  `generateText`) that yields normalized events (`text`, `thinking`,
  `toolCalls`, `usage`).
- **`schemas.js` / `tools.js`** — declared once in the strict dialect every
  provider accepts, then translated per provider.
- **`prompts.js`** — a system prompt per provider, written in each vendor's
  documented house style rather than one shared lowest common denominator.
- **`effort.js`** — one internal reasoning scale mapped to four different
  provider mechanisms, with per-model clamping.

The differences the adapters absorb are not cosmetic. Gemini 3.x rejects the
legacy `thinkingBudget` and its models disagree about which thinking levels
exist; Anthropic 5-gen models need adaptive thinking plus `effort` while
Haiku 4.5 rejects `effort` and needs a token budget; OpenAI uses the Responses
API; NVIDIA emits reasoning before content and will starve the answer without
extra headroom, and cannot constrain output to a schema at all. Each of those
was found by a failing live call, not by reading a doc.

### How memory works

The builder records what it did and recalls what it learned. The engine is
[`multi-graph-memory`](/root/multi-graph-memory), consumed as a local `file:`
dependency; this app supplies the facts and the human gate, and owns none of the
storage logic.

**One database, shared by every build**, at `.multi-memory/builder.db`, under the
constant project id `builder`. A lesson here is about the model and the
toolchain rather than about one application, so it would be worth nothing locked
inside the build that learned it — an earlier design kept a database per build,
and every build started from zero because nothing ever asked the previous one
what it had found out.

A build id is still minted when a wizard run starts and travels with it — in
localStorage, in the request body of every builder call, and into
`SavedBuild.memory` when the result is kept — but it is now an *attribution
dimension* (`cycleId` on events, `baseRevisionId` on episodes) rather than the
name of a file. The stock `multi-memory` CLI reads the same store. Any
`.multi-memory/build-*.db` files on disk predate this and are read by nothing.

**Where the facts come from** is split by who can see them:

- The **server** records what only it knows — which model actually served a call
  after fallback. `planning.answer`, `contract.delta` and `candidate.created` are
  emitted inside the `/api/builder/*` handlers, after the response, never on the
  critical path.
- The **client** records what only it knows — that a generation started, what the
  validator said, and whether a human kept or discarded the result. Those go
  through `services/memoryService.ts` to `/api/memory/*`.

**An episode is one generation attempt.** It opens when generation starts and
closes exactly once: `verified` when the validator passed, `failed` when it did
not or the attempt threw, `abandoned` when a reload or a reset cut it short. The
engine *reuses* an episode that is still open for the same objective, so a
double-tap joins the attempt in flight rather than forking it — which makes
closing the thing that matters, and is why an episode left open by a reload is
closed at startup before anything can join it.

**The validator's verdict decides the outcome, never the act of adopting the
result.** Keeping a candidate the validator rejected is recorded as a
`human.decision` and closes the episode `failed`. Closing it `verified` would let
an override manufacture the evidence a lesson is later promoted on.

**Verdicts are recorded as stable issue codes**, not messages
(`utils/validateBuild.ts`). Events are immutable: reword a check's message and
every stored verdict keyed on the old wording would read as a different kind of
failure.

**Nothing waits on memory.** Every client call bounds itself at 2s and answers
`null` rather than throwing; the server bridge catches everything and reports
`{degraded, reason}` on `/api/memory/state`. With the engine absent the builder
behaves identically and records nothing. One call is awaited — opening an
episode — because a null episode id is what makes every later tap a no-op.

**How a build teaches the next one.** A failed verdict proposes a lesson through
a declared table in `memory/proposals.js` — one entry per validator issue code,
no model anywhere in the decision. Proposing is idempotent, because the engine
derives a lesson's id from its own text, so the tenth build to break the same way
proposes the same lesson rather than a tenth copy.

A proposal then has to earn its place:

```
proposed ──► qualified ──► approved
   │             │             └─ a human said yes. Only from the CLI or the panel.
   │             └─ tried in a LATER, DIFFERENT attempt, and that attempt passed.
   └─ something broke once, and the table says what it teaches.
```

The engine only ever puts `qualified` and `approved` lessons in its governed
recall, so a proposal cannot climb on its own — it would never be injected, so
never applied, so never qualify. That is the engine declining to decide, not an
oversight: whether an unproven note is worth trying is the host's call. This app
makes that call in one bounded place. The **next** attempt after a failure carries
at most three proposals — only those about the issue codes that actually just
broke — in their own block, labelled as unproven, separate from the governed one.
Each is recorded as applied, so if the attempt passes, "it helped" is checkable
rather than asserted. A failure that stops recurring stops being trialled.

Promotion itself is the engine's, not ours: it refuses reuse unless the episode
is distinct from the one that proposed the lesson, actually recorded applying it,
and closed `verified`.

Approval of a lesson is human-only and lives at
`POST /api/memory/lessons/:id/approve`. It is declared in no tool schema and
reachable from no prompt, which is a structural property rather than a check.

## Checks

```sh
npm run typecheck        # strict tsc, zero errors expected
npm run build            # production bundle
npm run smoke            # backend health (server must be running)

# Every pure check under Vitest: the generation pipeline, the memory learning
# loop end to end on a throwaway database (a failure proposes a lesson, the next
# attempt trials it, passing promotes it to qualified), auth's OAuth state-nonce
# handling, and colocated utils tests. No model, no server, no key — every rung
# is enforced by the engine itself, so a break here is a real break rather than
# a flaky test.
npm test

# The memory loop again, through a real server process: builds the engine's dist, spawns
# the backend on a free port over a scratch database, drives the routes, proves
# recall reached the outgoing prompt and that the art-direction bar excludes a
# lesson it would otherwise have recalled, restarts and re-reads, then cross-checks
# with the multi-memory CLI. Spends nothing: the server is started with a
# deliberately invalid key, so builder calls fail at the model — which is the
# proof, since recall runs before the model and leaves its receipt either way.
npm run smoke:memory

# Live provider contract tests: streaming + usage, tool call, tool-result
# round-trip, and schema-constrained JSON. Costs a few cheap requests.
npm run smoke:providers -- gemini-3.5-flash-lite claude-haiku-4-5 gpt-5.6-luna meta/llama-3.2-11b-vision-instruct
```

Read a build's memory back with the engine's own CLI — the same databases, no
export step:

```sh
export MULTI_MEMORY_BUILDS=/root/multi-app/.multi-memory
cd /root/multi-graph-memory
node bin/multi-memory.ts --build <buildId> episode list
node bin/multi-memory.ts --build <buildId> events --limit 20
node bin/multi-memory.ts --build <buildId> attribution
```

A build id with no database is refused by name and lists the ids that do exist,
so "No episodes recorded" always means a build that genuinely recorded nothing.
The server prints its database directory at boot for the same reason — the port
may already be taken, and the process answering your requests is then not the one
you started.

## Roadmap

Next cycles, in the order chosen:

1. **Memory** — recording and recall are wired end to end (see *How memory works*
   above): the engine is `/root/multi-graph-memory`, every builder call is
   attributed, and a wizard run now leaves a readable episode behind. What remains
   is the half that closes the loop — a deterministic lesson proposer that turns a
   failed verdict into a candidate lesson, the reuse ratchet that promotes one only
   after a *different* episode benefits from it, and a Memory panel with the
   one-click human approval the CLI already has.
2. **Agent link (SAG-lite)** — a localhost-only, token-gated channel where the running app
   publishes bounded context (active project, current step, selection, diagnostics) and accepts
   typed directives, each answered with an effect receipt describing what actually happened. Lets a
   terminal agent drive the app instead of guessing at it.
3. **Git-backed history and a repair loop** — `isomorphic-git` over IndexedDB for real diffs,
   revert and branch-per-candidate (also escaping the ~5 MB localStorage ceiling), then use
   validator output to regenerate only the broken file instead of the whole project.
4. **Skill personas** — personas upgraded from a prose blob to a structured
   contract (purpose, anti-patterns, allowed tools, output shape) — a per-project record of decisions and failures injected
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
