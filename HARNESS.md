# Harness — what the generation pipeline claims, and what proves it

Written 2026-09-05, alongside A2. `DESIGN.md`'s sibling: that file records what the shell
looks like and why; this one records what the builder's prompts and schemas claim, and
whether anything checks them. Not a proposal document — a durable record, so a later
change is a decision rather than a drift.

## What a declaration is here

A declaration is a statement that must hold, paired with a mechanism that proves it, at a
named level. The three levels, in this codebase's own terms:

- **`lint`** — can't be written wrong. Checked against the artifact before anything runs,
  usually by not letting the model write it at all (`scaffoldFor`).
- **`gate`** — checked by running something and capturing the result: `tsc`, esbuild, the
  sandboxed preview actually executing.
- **`review`** — checked by a person. Nothing in this pipeline currently has a
  human-review step, so this level does not appear below except to say where it would be
  the honest answer and isn't built.

A statement with no mechanism is not a weak declaration. It reads as a guarantee and
behaves as nothing — worse than an absent rule, because an absent rule is visibly absent.
The rule that follows: **every claim below ships with its mechanism, or is labelled as a
gap.** A known gap is still a declaration — a statement about the limits of what exists.

## The table

| Claim | Mechanism | Level |
|---|---|---|
| Every app has one router, mounted once | `scaffoldFor` writes `src/main.tsx`; the model never touches it | `lint` |
| Tailwind v4 is imported correctly, entry exists, tsconfig is exact | `scaffoldFor` writes `vite.config.ts`/`tsconfig.json`/`index.html`/`src/index.css` | `lint` |
| `package.json` lists exactly the packages the code imports | `packageJsonFor` derives it from `importedPackages`, never from the model's own list | `lint` |
| An import resolves only to a package the preview can actually load | `providers/allowlist.js`'s `PREVIEW_PACKAGES`, checked by `attributeBundleErrors` (gate) and enforced by `packageJsonFor` refusing to declare an unlisted one (lint) | `lint` + `gate` |
| Every allowlisted package is genuinely installed | `check:generate`'s "every allowlisted package is actually installed" — a check on the declaration itself | `gate` (CI-time) |
| **A shared data shape (`PhotoItem`, `ServicePackage`, …) means the same thing everywhere** | `scaffoldFor`'s `typesFileFor` writes `src/types.ts` from the plan's `entities[]`; `fileInstruction` includes its literal content, not just its path | `lint` (A2) |
| A dropped page/component is restored before generation spends a request on it | `coverPlan`/`planCoverage` | `lint` |
| A page/component the plan approved actually exists in the output | `validateBuild`'s `plan-page-missing`/`plan-component-missing` | `gate` |
| The code type-checks under strict TypeScript | `tsc`, `typecheck/runner.js` | `gate` |
| The bundle resolves and the app runs without throwing or rendering nothing | `preview/bundle.js` + `previewVerdict`'s sandboxed run | `gate` |
| The generated app **satisfies its acceptance criteria** | `/api/builder/check-acceptance` — the model that wrote the code reports whether it believes each criterion holds | **self-report, not `review` or `gate`** (A2) |
| The generated app **matches its chosen aesthetic directive** (typography/motion/background) | none | **labelled gap** (A2) — `Step_Theme.tsx`'s caption states this plainly |
| The design contract's palette/typography tokens were actually *used*, not just declared | none beyond the CSS custom-property convention itself | **labelled gap** — not built this phase |

### Why acceptance criteria are a self-report, not a gate

A model judging whether its own code satisfies a criterion is not an independent
observer — the same defendant grading its own homework, which is exactly what the memory
ladder's independence property already forbids for every other signal. Building a real
per-criterion gate (a generated Playwright assertion per criterion, run against the
preview) is real, buildable work — deferred to A3, once the IDE can drive the preview and
there is a natural place for generated tests to live. Until then: the self-check closes
the *silence* (a person now sees an actual answer) without pretending it closes the
*verification gap*. Always `severity: 'warning'`, always suffixed "(self-reported...not
independently verified)", never present in `memory/proposals.js`'s `PROPOSAL_TABLE` — see
its `NOT_A_LESSON` entry for `acceptance-criterion-unmet`.

### Why the aesthetic directive stays a labelled gap, not a mechanism

"Does this look editorial" is close to unfalsifiable, and this pipeline has no
human-reviewer role to make `review` a real option. Building an automated mechanism here
would be theatre — scoring a subjective quality with a number nobody should believe. The
correct move, per the three-question test below, is to say so where a person can see it,
which is what `Step_Theme.tsx`'s caption does.

## The three-question test

Applied to any new claim before it ships:

1. **What must be true?** If it can't be stated as a sentence that could be false, it's a
   preference, not a declaration.
2. **What reads it?** Name the function or the check. "The model should" is not a
   mechanism.
3. **At what level, and what happens on failure?** If the answer is "nothing," it's
   documentation — which may be fine, but say so rather than implying otherwise.

## Effort levels — where a mechanism replaced a guess, and where it didn't

A hardcoded cap (an effort level, a round count, a concurrency limit) is what gets written
when there's no mechanism yet to reason about the risk with. Once a mechanism exists, the
cap that was standing in for it should be reconsidered — but three different reasons hide
behind "it's just a cap," and only one of them means "raise it":

| Constant | Was | Now | Why |
|---|---|---|---|
| Manifest step effort (`providers/generate.js`) | `low` | `medium` | Now cross-references entities; bounded at 8,192 tokens, no shared-budget risk. Effort spends latency, not quota — raising it costs nothing against the daily request ceiling. |
| Per-file generation effort | `medium` | `high` | Bounded at 16,384 tokens per file. Correctly applying a frozen shape is exactly where more careful reasoning helps. |
| Repair effort | `medium` | `high` | Same bound, and repair is argued from the compiler's own diagnostics — the highest-leverage place for more thinking. |
| Whole-app fallback effort (`server.js`) | `medium` | **unchanged** | Shares its 65,536-token ceiling with thinking — the documented original cause of truncation. Raising effort here could make truncation *worse*. Needs an A4 bench measurement before it is touched, not a guess. |
| `concurrency = 3`, `maxFiles = 10`, `MAX_ROUNDS = 3` | — | **unchanged** | Not risk-hedges — quota-hedges. `gemini-3.7-flash` (the builder default) allows 20 requests/day; a full repair pass can already spend up to 30 of them. Entities should *reduce* how often repair fires; that's an A4 question, not a reason to raise these now. |

**The axis that matters going forward:** effort is a per-request token-budget dial; quota
is a request-count ceiling. They are independent, and conflating them — "we raised effort,
so we can also raise concurrency" — would undo the separation this phase went to some
trouble to establish.

## Prompt ordering, for caching

`generatePromptFor` (`providers/generate.js`) puts the fully-static block (stack rules,
the allowlist instruction, the design contract's non-variable sub-rules) first, and the
per-build variable block (the plan, acceptance criteria, palette, typography) last. This
string is the prefix of every manifest, per-file and repair request in one generation run
— sent whole, unchanged, ten to twenty times per build. Gemini's implicit prefix caching
(2.5+) matches the longest shared prefix across requests; a longer byte-identical block at
the front means more of that repetition is free instead of paid, and — because the
invariant block never varies *between* builds either — the same prefix can in principle be
shared across different users' builds too, not only within one build's own retries.

## Extending this table

When a new claim is added to the generate prompt or plan schema, add a row here in the
same turn — not later, not "when someone asks." A table that only grows when someone
notices a gap is exactly the failure this document exists to prevent.
