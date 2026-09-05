# On-demand npm packages — a report, not an implementation

Written 2026-09-05, alongside A2, at Eyal's request: how to move the *verification* path
(this repo's own `tsc`/esbuild) from a curated allowlist to arbitrary packages, later. Not
built now — this is the plan to have on hand when it's time.

## Where things actually stand today

Two different things both got called "the dependency problem," and A0/A1 solved different
halves of it:

- **The preview a person looks at** (`components/builders/SandpackAppPreview.tsx`, A0)
  already resolves any npm package, via Sandpack's CDN-backed bundler. Solved.
- **The verdict** — `tsc` (`typecheck/runner.js`) and esbuild (`preview/bundle.js`) — still
  only resolves the curated allowlist (`providers/allowlist.js`, A1), because both of
  those run against multi-app's own `node_modules` (`preview/bundle.js`'s
  `requireFromRoot = createRequire(path.join(ROOT, 'package.json'))`). Nothing here lets
  the *verification* path see a package outside that list. This report is about that half.

Sandpack cannot become this mechanism — see `DESIGN.md`'s "the one exception, taken with
its eyes open": collapsing the verdict into the same bundler the preview runs in is the
exact failure A1 was written to close. On-demand install has to happen in
multi-app's own process, where `tsc`/esbuild already run.

## The resolution seam

`preview/bundle.js:180-196` is the exact spot. Today, a bare specifier that isn't in
`react-router-dom`'s shim resolves like this:

```js
try {
    return { path: requireFromRoot.resolve(args.path), namespace: 'file' };
} catch {
    return { errors: [{ text: `Could not resolve "${args.path}" — the package is not installed in this preview.` }] };
}
```

On-demand means the `catch` branch gets a second chance before it becomes an error:

1. Check a **per-project cache directory** (e.g. `.preview-work/<projectId>/on-demand/`,
   alongside the existing `.preview-work/` used for `tsc`'s `node_modules` walk —
   `AGENTS.md` already documents why that directory has to live inside the repo rather
   than `/tmp`). If the package is already there, resolve from it and return.
2. If not, spawn `npm install --prefix .preview-work/<projectId>/on-demand
   --ignore-scripts --no-audit --no-fund <package>@latest` and wait for it.
3. Resolve from the now-populated cache directory; on install failure, produce the same
   `unresolved-import` shape the curated path already produces, so `attributeBundleErrors`
   doesn't need a new code — see below.

`tsc`'s runner needs the same fallback — it currently resolves types by walking up from
`.preview-work/` looking for `node_modules`, so the on-demand cache directory should be a
sibling `node_modules`-shaped tree it can already see, not a second lookup mechanism.

## `--ignore-scripts` is not negotiable

Already written into this plan's constraints once (A1): the difference between installing
a package and executing its author's arbitrary code at install time. On-demand makes this
sharper, not softer — a curated allowlist is nine packages a human already looked at;
on-demand is *whatever a model asked for*, which is adversarial input by construction.
`--ignore-scripts --no-audit --no-fund` stays load-bearing. The cost: a package whose
runtime behavior depends on a native build step (most don't; some do — anything with a
`.node` binary) will resolve but may not actually run. That failure needs to surface as a
runtime error from `previewVerdict`'s sandboxed execution, not a silent success.

## What the install costs, and the interaction with existing timeouts

`preview/bundle.js`'s `TIMEOUT_MS = 20_000` bounds the whole bundle today, on the
assumption that resolution is instant (it's a local `require.resolve`). A real `npm
install` is not instant — plausibly several seconds to tens of seconds for a package with
its own dependency tree, on a cold cache. This means:

- The install phase needs its **own** timeout, separate from the bundle timeout, so a slow
  install doesn't read as "the whole preview is broken."
- The cache directory makes the *second* request for the same package free — this matters
  because a generation run can request the same file (and therefore the same import)
  multiple times across manifest/repair rounds.
- A generation that reaches for three never-before-seen packages could add real wall-clock
  time to a build. Worth surfacing as its own status message ("Installing lucide-react…"),
  the same way `Step_Generate.tsx` already surfaces "Fixing N files the compiler
  rejected…" for repair.

## What `attributeBundleErrors` needs to become

Today it's a two-way judgment (`services/previewVerdict.ts:58-76`): a package on the
allowlist that fails is the environment's problem; a package off it is the model's. With
on-demand, "off the curated list" stops meaning "the model's problem" — it means "try to
install it first." The judgment becomes three-way:

| Outcome | Attribution | Code |
|---|---|---|
| Curated package fails to resolve | environment (multi-app's own install is broken) | `unresolved-import`, but now genuinely unexpected — worth its own alert, not a model lesson |
| Not curated, on-demand install succeeds, then fails to resolve/run | the package itself (bad export, native binary, etc.) | new: `on-demand-runtime-error` or similar |
| Not curated, on-demand install fails outright (network, 404, no such version) | the model, for naming a package that doesn't exist or isn't installable this way | keep `unresolved-import`, message names the install failure |

The allowlist itself doesn't go away — it becomes the **fast path** (no install, no
network, always available offline) rather than the **only** path. The generate prompt's
instruction changes from "you may only import from this list" to "these resolve
instantly; anything else on npm works too, at the cost of an install."

## Why this was deferred rather than built in A1 or A0

A1 needed a closed, verifiable list first — on-demand install without a working
attribution model would have reintroduced exactly the certification hole A1 closed
(a package that fails to install would need to be distinguishable from one that fails for
any other reason, and that distinction didn't exist yet). A0 answered the more urgent
half — the *preview* — with something that shipped in one session because CDN resolution
needs no install step at all. On-demand for the *verdict* is real infrastructure work
(a resolution seam, a second timeout, a three-way attribution model, cache lifecycle) with
a real security surface (`--ignore-scripts`) — worth doing once there's evidence (from A4's
bench) that the curated list is actually the binding constraint on generation quality,
rather than assuming it and building the more complex thing first.

## Rough shape of the work, when it's time

1. `preview/bundle.js`: the on-demand `onResolve` fallback, a per-project cache directory,
   a separate install timeout.
2. `typecheck/runner.js`: point its `node_modules` walk at the same cache directory.
3. `services/previewVerdict.ts`: the three-way `attributeBundleErrors`.
4. `server.js`'s generate prompt: allowlist becomes "fast path," not "the only path."
5. Cache lifecycle: an eviction policy (LRU by project, or a size cap) — this is the one
   piece with no existing precedent in this repo to model it on.
6. Gates: `check:preview` gains a case for "a genuinely uncached package resolves and
   runs," and one for "a nonexistent package name fails as the model's problem, not
   silently as an environment error."
