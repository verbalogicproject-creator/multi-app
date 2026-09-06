# What needs to be fixed — post-architecture-audit

Written 2026-09-06, the designated final deliverable of the `architecture/` audit,
produced after the interactive doc itself (per the requested sequencing: web-docs
first, this synthesis last, so it's informed by what they found rather than
guessing ahead of them). Full evidence for every item below lives in
`architecture/` — this file is the prioritized, human-readable "so what do I
actually do" on top of it, not a second copy of the evidence. Re-derive, don't
hand-update: when this list needs revising, revisit `architecture/` (regenerate
what's generated, re-run `node architecture/server.js --verify`) rather than
editing this file's claims independently of it — that's exactly the drift this
whole audit exists to stop.

## Priority order, and why

Per the stated priority: **the generation pipeline is what this project is
for**, so fixing what makes it unreliable outranks everything else, including
things that are individually more severe in the abstract (e.g. the security
posture, already closed — see below).

---

## 1. Generation pipeline — fix these first

### 1.1 The repair loop can ship a worse candidate than it started with
**Confirmed on a real build** (`architecture/hetrodox-unconventional-approaches.json#repair-can-end-worse-than-it-started`).
`server.js`'s `repairIfNeeded` (line 766) only reverts a repaired file if *that
file's own* error count didn't fall — it never compares the project's
*aggregate* error count before vs. after, and never restores the best-seen
snapshot if the final round wasn't the best one. A real build went from 47 to
61/62 errors and shipped the worse state.

**Fix:** track the lowest aggregate-error snapshot across all rounds; if the
loop's last round isn't the best one seen, restore the best instead of
trusting the last round unconditionally. Add a regression test with synthetic
diagnostics asserting the aggregate never regresses past the pre-repair state.

### 1.2 The memory/lesson system is nearly blind to real usage
**Confirmed by direct measurement**
(`architecture/hetrodox-unconventional-approaches.json#memory-cannot-see-most-real-usage`).
Only 6 episodes were ever recorded across 570 per-build database files; 23 real
API calls were logged by the quota governor on one day versus 2 episodes
recorded in memory that same day. The learning system this pipeline depends on
to get better over time has almost nothing to learn from — not because it's
broken, but because its fire-and-forget, never-block design (a deliberate,
correct tradeoff for reliability) has the side effect of losing most attempts.

**Fix:** instrument the client to find out why so few attempts produce a
recorded episode (most iteration happening outside the wizard? reloads
abandoning episodes silently? open/close calls not being reached?) before
building anything on top of this data (including the planned semantic-recall
upgrade — see `architecture/memory-system-ladder.json`).

### 1.3 The MCP memory server is scoped to a store nothing writes to
**Confirmed, and now understood mechanically**
(`architecture/memory-system-ladder.json#engineInternals.scopeResolutionAndTheRealDefect`).
`.multi-memory.json` resolves the `multi-memory` MCP server to a single
project-scoped `builder.db`; real generation history lives in per-build
`.multi-memory/build-<id>.db` files with no `buildId` parameter anywhere in the
MCP tool surface to reach them. An external agent asking this surface "what has
generation learned" gets a confident, wrong answer: nothing.

**Fix (design decision needed, not attempted in this audit):** add a
`buildId`-scoped mode to the MCP tools, or periodically roll per-build data
into the project-scoped store, or repoint resolution at the per-build
directory with a required `buildId` argument. Do this **before** B3 (storage
foundation / Cloud Run deploy per `~/.claude/plans/CONSOLIDATED-PATH.md`) —
deploying the current scope resolution would ship the same blind spot.

### 1.4 A build's request count can exceed its own model's daily quota
**Arithmetic confirmed, real-world trigger not yet confirmed**
(`architecture/hetrodox-unconventional-approaches.json#quota-vs-request-count`).
The one real build with full telemetry needed 21 requests for generation alone
on a 20/day-limited model, before any repair. Mitigated by real, working
429-as-transient retry/fallback — but the fallback's final link is a
non-coding-tuned model, so the likely failure mode is a **silent quality
downgrade**, not a crash.

**Fix:** surface `fellBack`/`servedModel` prominently in the Step_Generate UI
(currently just an attribution fact); measure actual fallback frequency once
1.2 is fixed and more episodes are captured.

### 1.5 Two open questions the project has already correctly flagged, still open
- Whole-app-fallback effort frozen at `medium`, pending an unrun "A4 bench" —
  `architecture/hetrodox-unconventional-approaches.json#whole-app-fallback-effort-frozen`.
  First measure how often this fallback path is even hit before spending effort
  tuning it.
- `MAX_ROUNDS=3` repair bound is reasoned but unmeasured —
  `architecture/hetrodox-unconventional-approaches.json#bounded-nonlooping-repair-heuristic`.
  Blocked on 1.2 (need more captured episodes with repair telemetry to measure
  against).

---

## 2. Reconciling `~/.claude/plans/CONSOLIDATED-PATH.md` against what's shipped

That document (last updated 2026-09-03) is itself stale — found during this
audit, see `architecture/gaps-bugs-and-need-to-handle.json#consolidated-path-stale`.
For the record, so the next session doesn't have to re-derive it:

| Stage | CONSOLIDATED-PATH.md said | Actually, as of this audit |
|---|---|---|
| 1 — Editor | Complete 2026-09-03 | Confirmed still true |
| 2 — Type errors on screen | Not started | **Shipped** — `typecheck/` module, CodeMirror diagnostics wired (`components/CodeEditor.tsx`) |
| 3 — Builder learns from type errors | Not started | **Shipped** — `type-error` is a live code in `memory/proposals.js`'s `PROPOSAL_TABLE` |
| 4 — The safety floor (auth, CORS, bind) | Not started, "gets worse with time" | **Shipped** — commit `ee18fd7`, `auth/` module, `bootPosture` (`auth/config.js`) |

Recommend updating `CONSOLIDATED-PATH.md` itself to reflect this (out of this
audit's scope to edit directly, per the "separation, not absorption" decision
— but it should not keep saying Stage 1 is the only thing done).

**What CONSOLIDATED-PATH.md still correctly lists as open**, unaffected by this
audit: Android Chrome never exercised on real hardware, cross-file `tsc`
resolution unmeasured, concurrent `tsc` under memory pressure untested — see
`architecture/gaps-bugs-and-need-to-handle.json#openRisksFromConsolidatedPath`.

---

## 3. Everything else already labelled, still open

Already admitted by the project itself, not new findings — kept here only so
the priority ordering is complete. Full detail in
`architecture/gaps-bugs-and-need-to-handle.json`:

- Acceptance criteria are a self-report, never a gate (deferred, real work).
- Aesthetic-directive match has no mechanism (deliberately left as a labelled
  gap — building one would be theatre).
- Design-token *usage* (not just declaration) is unverified.
- On-demand npm packages for the verification path — full plan exists
  (`ON-DEMAND-PACKAGES.md`), not built.
- Two gitignored, uncommitted docs (`multi-app-auth-integration.md`,
  `multi-app-how-to-integrate-auth.md`) hold what looks like a plaintext OAuth
  secret on disk, predate the real `auth/` implementation — worth deleting or
  rotating the credential if still valid.

---

## 4. Deferred on purpose, not urgent

- The on-device RAG stack (Termux/llama.cpp) for semantic memory recall —
  sequence **after** §1.2 above, not before (`architecture/memory-system-ladder.json`).
  Methodology reference queued for that work:
  `~/projects/kg-rag-cookbook/TS-kg-rag-of-kg-rag.md`.
- `multi-graph-memory` Stages 5–6 (M2 retrieval fusion, M3 dashboard, M4
  multi-tenant MCP) — each with its own planning pass, per CONSOLIDATED-PATH.md.

---

## How this doc was produced

Via the protocol formalized in `de-clutter-protocol-finder-of-truth.md`: every
claim above traces to either a `--verify`-checked generated file, a directly
measured real build/database, or a specific cited line in this repo or
`multi-graph-memory`. Nothing here is restated from a doc's own confidence
without checking it against the system first.
