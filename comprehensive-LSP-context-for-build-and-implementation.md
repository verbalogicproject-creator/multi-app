# Comprehensive LSP Context for Build and Implementation

**Target:** `/root/multi-app` (`gemini-multimodal-chat`) — pre-renderer IDE upgrade
**Date:** 2026-09-02
**Supersedes:** `codemirror-lsp-ide-upgrade-2026-09-02-1341.md` (kept for the LSP prototype detail in §7)
**Companion:** `/root/monaco/codemirror-monaco-comparison-report-2026-09-02-1329.md`

Every code block in §4, §5 and §7 was built and run on this device before being written down. Where something is design rather than verified behavior, it says so. Measurements come from a physical Android phone (NX779J, Android 15, aarch64, Termux `proot-distro`) — real phone silicon, not desktop numbers.

---

> **Ordering:** this document survives whole and is the implementation detail for
> Stages 1–3 of `~/.claude/plans/CONSOLIDATED-PATH.md`. Its decision was adopted:
> CodeMirror + `tsc`, LSP deferred. One correction — §7 trap 1 says `^5.4.5` will
> drift to TypeScript 7. It cannot; a caret is major-locked. `typescript@latest`
> *is* 7.0.2 with no `tsserver.js`, so the exact pin (now `5.9.3` in
> `package.json`) is right, but the reason is reproducibility and Track C.

## 1. The decision

**Build Track A and Track B. Treat Track C as optional and probably unnecessary.**

| Track | What it is | Cost | Verdict |
|---|---|---|---|
| **A** | CodeMirror replaces the `<textarea>` | 162 KB gzip, half a day | **Build it.** Value is immediate and independent. |
| **B** | `tsc --noEmit` → inline diagnostics | ~15 KB gzip + a server route | **Build it.** This is the feature that actually matters here. |
| **C** | Full LSP over WebSocket | +20 KB gzip + a bridge + a security surface | **Defer.** Solves a problem you may not have. |

### Why C is probably wrong for this app

LSP's headline feature is type-aware completion. Completion pays off when **a human authors substantial TypeScript by hand**. In this app the model generates the files and the human reviews them, renames a thing, tweaks a string. On a soft keyboard nobody writes a generic constraint. You would be paying for a WebSocket bridge, a `tsserver` process per connection, a TypeScript-5 version pin, and a code-execution-adjacent security surface, to accelerate typing that isn't happening.

### Why B is right

Your builder generates code, and generated code has type errors — routinely. **Surfacing those errors is the valuable half of LSP, and it is the cheap half.** You already have `npx tsc --noEmit` in the workflow and a Node backend to run it in. No WebSocket, no persistent server process, no framing protocol, no version pin trap.

### The one condition that would flip this

`components/` uses `md:` breakpoints throughout, so this runs on desktop too. **If desktop users turn out to do real hand-authoring**, hover-types and go-to-definition earn their keep and Track C becomes worth building. That is a product observation you can only make after Track A ships. Ship A, watch, then decide.

---

## 2. What was verified

| Claim | Result |
|---|---|
| CodeMirror builds and renders on this device | ✅ 711 ms build, 398 ms render |
| CodeMirror bundle | ✅ 500,418 B raw / **166,100 B gzip**, one chunk |
| Monaco bundle, real load for one JS file | 10.79 MB raw / **2.49 MB gzip** |
| CodeMirror touch: tap places cursor, typing works | ✅ (emulated touch — see §11) |
| `tsc --noEmit --pretty false` output format | ✅ exact format captured, §5.1 |
| tsc exit codes | ✅ `2` with errors, `0` clean |
| Parsed tsc → CodeMirror squiggles | ✅ 3 diagnostics → 3 underlines → 3 gutter markers |
| Hover tooltip carries message + code | ✅ `"Type 'string' is not assignable to type 'number'.\nTS2322"` |
| Full LSP round trip (Track C) | ✅ `answer.toFi` → `toFixed`, 23 server capabilities |
| LSP client bundle cost | ✅ +19.9 KB gzip over plain CodeMirror |

---

## 3. House constraints this must respect

From `AGENTS.md`. **Violating any of these produces a change that looks correct and is not.**

1. **`utils/validateBuild.ts` is pure and dependency-free.** It is described as "the easiest place to add a new quality gate" — and a type check is exactly a quality gate. But **tsc is a subprocess**, so it *cannot* live inside `validateBuild.ts`. Track B's checker runs server-side and produces `BuildIssue[]` in the same shape. Putting a `spawn` inside that module breaks the property that makes it testable.
2. **A verdict is recorded by stable issue `code`, never by message.** TypeScript error codes (`TS2322`) are already stable identifiers — a good fit. The *validator* code should be one new `BuildIssueCode`, not one per TS code.
3. **Adding a validator check means adding a row to `PROPOSAL_TABLE` or `NOT_A_LESSON` in `memory/proposals.js`.** A code in neither is logged as an open question. This is not optional cleanup; it is the mechanism the file exists for. §5.4 gives the row.
4. **No memory tap may gate a builder transition.** If type-check results are fed to memory, the tap is additive and fire-and-forget. A failing typecheck must not block a transition that would otherwise proceed.
5. **Style:** four-space indent, semicolons, single-quoted imports, functional components. HTTP calls in `services/`, types in `types/`. No formatter is configured.
6. **Before submitting:** `npx tsc --noEmit` and `npm run build`, then exercise the affected flows with both processes running.

---

## 4. Track A — CodeMirror replaces the textarea

`components/CodeEditor.tsx` is currently 77 lines wrapping a `<textarea>`. **Keep its outer shell exactly as it is** — the desktop header, the dirty-dot, the mobile floating save button, and the comment explaining why the mobile button is absolutely positioned are all correct and mobile-aware. Only the `<textarea>` element is replaced.

```sh
npm i codemirror @codemirror/lang-javascript @codemirror/lang-css @codemirror/lang-html
```

```tsx
// components/CodeEditor.tsx — replacing only the <textarea>
import { basicSetup, EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import React, { useEffect, useRef } from 'react';

const languageFor = (path: string) =>
    path.endsWith('.css') ? css()
    : path.endsWith('.html') ? html()
    : /\.[cm]?[jt]sx?$/.test(path) ? javascript({ typescript: /\.tsx?$/.test(path), jsx: path.endsWith('x') })
    : [];

const Editor: React.FC<{ path: string; value: string; onChange: (v: string) => void }> =
({ path, value, onChange }) => {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);

    useEffect(() => {
        if (!host.current) return;
        const instance = new EditorView({
            parent: host.current,
            state: EditorState.create({
                doc: value,
                extensions: [
                    basicSetup,
                    languageFor(path),
                    EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
                ],
            }),
        });
        view.current = instance;
        return () => { instance.destroy(); view.current = null; };
    }, [path]);

    return <div ref={host} className="flex-1 min-h-0 overflow-auto" />;
};
```

**Trap: the `[path]` dependency is deliberate.** Keying the effect on `value` would tear down and rebuild the editor on every keystroke, losing cursor, selection, undo history and scroll position. Recreate on *file change*, not on *content change*. If you must push external content into an open editor, dispatch a transaction instead of remounting:

```tsx
view.current?.dispatch({
    changes: { from: 0, to: view.current.state.doc.length, insert: nextContent },
});
```

**What this buys immediately:** syntax highlighting, line numbers, bracket matching, code folding, search, multi-level undo, and a real selection model — at 166 KB gzip and a 398 ms render on this phone.

---

## 5. Track B — type diagnostics without LSP

Two landing points. They share a parser and are independently useful.

- **5.2 Editor surface** — squiggles in the IDE. Human-facing.
- **5.3 Validator surface** — a `BuildIssue` on generated output. Machine-facing, feeds the memory loop.

### 5.1 The exact tsc contract

Verified on this device with TypeScript 5.9.3 (format is unchanged in 6.x):

```
broken.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.
broken.ts(3,7): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.
broken.ts(4,11): error TS2304: Cannot find name 'undefinedThing'.
```

- Format: `path(line,col): severity TScode: message`
- **`line` and `col` are 1-indexed.**
- Exit code **2** when there are errors, **0** when clean. *Do not treat a non-zero exit as a failure to run* — it is the normal path.
- Elaborated diagnostics can continue onto following **indented** lines. TS 5.9 flattened the cases tried here, but the parser should append indented lines to the previous diagnostic anyway; it is two lines of code and the alternative is dropped context.

```ts
// services/tscDiagnostics.ts  (types in types/, per AGENTS.md)
export interface TscDiagnostic {
    path: string;
    line: number;      // 1-indexed, as tsc reports
    col: number;       // 1-indexed
    severity: 'error' | 'warning';
    code: string;      // e.g. 'TS2322'
    message: string;
}

const LINE_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.*)$/;

export const parseTsc = (output: string, filterPath?: string): TscDiagnostic[] => {
    const out: TscDiagnostic[] = [];
    for (const raw of output.split(/\r?\n/)) {
        if (/^\s/.test(raw) && out.length) {
            out[out.length - 1].message += '\n' + raw.trim();
            continue;
        }
        const m = LINE_RE.exec(raw);
        if (!m) continue;
        const [, path, line, col, severity, code, message] = m;
        if (filterPath && path !== filterPath) continue;
        out.push({ path, line: +line, col: +col, severity: severity as 'error' | 'warning', code: 'TS' + code, message });
    }
    return out;
};
```

### 5.2 Editor surface — verified working

`@codemirror/lint` `Diagnostic` takes **absolute document offsets**, not line/col. The conversion is where this goes wrong.

```sh
npm i @codemirror/lint
```

```ts
import { setDiagnostics, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';

export const toDiagnostics = (state: EditorState, parsed: TscDiagnostic[]): Diagnostic[] =>
    parsed.flatMap((d) => {
        if (d.line < 1 || d.line > state.doc.lines) return [];       // stale line — drop it
        const lineObj = state.doc.line(d.line);
        const from = Math.min(lineObj.from + d.col - 1, lineObj.to);
        const word = /\w+/.exec(state.doc.sliceString(from, lineObj.to));
        const to = word && word.index === 0 ? from + word[0].length : lineObj.to;
        return [{ from, to, severity: d.severity, source: d.code, message: d.message }];
    });

// push results when they arrive from the server
view.dispatch(setDiagnostics(view.state, toDiagnostics(view.state, parsed)));
```

Add `lintGutter()` to the extensions for the margin markers.

**Verified:** 3 parsed diagnostics produced 3 `.cm-lintRange-error` underlines, 3 `.cm-lint-marker-error` gutter markers, and a hover tooltip reading `Type 'string' is not assignable to type 'number'. / TS2322`. Zero page errors.

> 🔴 **Trap — stale diagnostics land on the wrong text.** tsc runs against content that was sent to the server. By the time results return, the buffer may have moved, and offsets computed from old line numbers will underline the wrong tokens with total confidence. **Tag every request with the document revision and drop results whose revision no longer matches.** The `d.line > state.doc.lines` guard above prevents a crash; it does not prevent a *wrong* squiggle. This is the failure that looks like it works.

### 5.3 Validator surface

Add one code to the union in `utils/validateBuild.ts`:

```ts
export type BuildIssueCode =
    | 'no-files'
    // ... existing codes ...
    | 'type-error';
```

**The check itself does not go in `validateBuild.ts`** — see §3.1. It runs server-side, materializes the generated files to a scratch directory, runs tsc, and emits `BuildIssue[]` in the existing shape:

```js
// server-side; one BuildIssue per diagnostic, code is the stable validator code
const issues = parseTsc(output).map((d) => ({
    severity: 'error',
    code: 'type-error',
    file: d.path,
    message: `${d.code}: ${d.message}`,
}));
```

Note `unresolved-import` already exists as a lexical check. tsc will find the same class of problem more accurately; **keep both** — the lexical one is free and runs without a toolchain, and the codes stay distinct so the memory table can tell them apart.

### 5.4 The `PROPOSAL_TABLE` obligation

Per `AGENTS.md`, a new validator code in neither map is logged as an open question. `type-error` earns a real lesson — it is specific, actionable, and the model can do something about it:

```js
// memory/proposals.js — inside PROPOSAL_TABLE
'type-error': {
    trigger: 'Generated code failed a strict TypeScript check',
    recommendation:
        'Write code that type-checks under strict mode. Annotate props and state, ' +
        'do not assign across incompatible types, and do not reference identifiers ' +
        'that were never declared or imported.',
    scope: BUILD_SCOPE,
},
```

Do not put it in `NOT_A_LESSON` — that map is for codes where guidance would be vacuous (`no-files`) or where the call is a human judgement (`plan-page-missing`). A type error is neither.

**Then honour §3.4:** feeding this to memory is a fire-and-forget tap. A failing typecheck must not gate a builder transition.

### 5.5 Where the check runs

The generated project is virtual — `types/project.ts:8`, `ProjectFile { path, content }` held in memory. tsc needs a real directory.

```js
// materialize to a scratch dir, run tsc, discard
const dir = path.join(os.tmpdir(), 'multi-app-tsc', projectId);
for (const f of files) {
    const target = path.resolve(dir, f.path);
    if (!target.startsWith(dir + path.sep)) throw new Error('path escape refused');   // mandatory
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, f.content, 'utf8');
}
```

A `tsconfig.json` must be written alongside, or tsc infers a minimal wrong project and the diagnostics are worthless:

```json
{ "compilerOptions": { "target": "ESNext", "module": "ESNext",
  "moduleResolution": "bundler", "strict": true, "noEmit": true,
  "jsx": "react-jsx", "lib": ["DOM", "ESNext"] } }
```

**The path-escape check is not optional.** `f.path` originates from model output.

**Expect unresolved-import noise.** Without `node_modules`, every `import React from 'react'` becomes `TS2307: Cannot find module`. Either materialize a minimal `node_modules` with the type packages, or filter `TS2307` for bare specifiers and let the existing `unresolved-import` check own that class. **Filtering is the cheaper start**; say so in the code comment so the next reader knows it was a choice.

---

## 6. Sequencing

| Phase | Work | Independent value |
|---|---|---|
| **1** | Track A — CodeMirror in `CodeEditor.tsx` | Highlighting, folding, search, real undo. Ships alone. |
| **2** | Track B server route + parser (§5.1, §5.5) | Type errors visible on generated output. |
| **3** | Track B editor surface (§5.2) + revision guard | Squiggles in the IDE. |
| **4** | Track B validator + `PROPOSAL_TABLE` (§5.3, §5.4) | The builder learns from its own type errors. |
| **5** | Track C, *only if* desktop hand-authoring proves real | Completion, hover, go-to-definition. |

Phase 4 is the one with compounding value and it is the one most likely to be skipped. **Type errors the model makes, fed back as lessons, are exactly the loop this repo is built around** — the generated code is the model's output, the type checker is a deterministic judge, and `PROPOSAL_TABLE` is already the mechanism for turning a stable failure code into guidance.

---

## 7. Track C — full LSP, if you get there

The prototype in `codemirror-lsp-ide-upgrade-2026-09-02-1341.md` §4 is verified working: `@codemirror/lsp-client` 6.2.5 over a WebSocket bridge to `typescript-language-server` 6.0.0, giving `answer.toFi` → `toFixed` and 23 advertised capabilities for +19.9 KB gzip. Read that document rather than rebuilding it.

Three traps carry over, and each costs a day if hit cold:

1. 🔴 **TypeScript 7 breaks `typescript-language-server`.** `npm i typescript` resolves to 7.0.2 — the native Go port, which ships **no `tsserver.js`**. Handshake dies with `-32603 ... no valid TypeScript installation was found`. **Pin `typescript@6.0.3` exactly** — verified working; it is the newest release that still ships `tsserver.js`. Your `^5.4.5` will drift into 7 on a fresh install. *This also affects Track B* if you ever depend on `tsserver` rather than `tsc` — Track B uses `tsc` only, which TS 7 still ships, so Track B is safe either way.
2. **The `initialize` race.** `LSPClient.connect()` sends its first message synchronously, before the socket opens. Without an outbound queue it is dropped and `client.initializing` never resolves — no error, no server log.
3. **Vite proxy ordering.** `/api/lsp` must be declared *before* `/api` and set `ws: true`, or the upgrade is proxied as plain HTTP.

---

## 8. Mobile

The architecture is right for a phone because **all analysis happens server-side**. The handset runs a 166 KB editor. Monaco would put a 1.45 MB `ts.worker` on the device and run type-checking there.

- CodeMirror treats touch as first-class; Monaco's README answers mobile support with `No.`
- Cap `maxRenderedOptions` on any completion popup and consider disabling `activateOnTyping` on narrow viewports — a popup covering the line being typed is worse than no popup.
- Debounce the typecheck request. Every keystroke is not a round trip; a 500 ms trailing debounce plus the revision guard from §5.2 is the whole policy.
- `lintGutter()` markers are small touch targets. The lint panel (`openLintPanel`) is the better mobile affordance for reading errors.

---

## 9. Security

Track B is far smaller than Track C here, but not zero.

1. **Path escape.** `ProjectFile.path` comes from model output. The `startsWith(dir + path.sep)` check in §5.5 is mandatory, not illustrative.
2. **tsc is a subprocess.** Bound it: timeout, output cap, one concurrent run per project, kill on client disconnect.
3. **Scratch directories need cleanup**, or a long-running server accumulates generated projects in `/tmp`.
4. If Track C ever ships: `cors()` is currently unrestricted, and a WebSocket endpoint that spawns child processes needs stricter treatment than a JSON route. `workspace/executeCommand` is in the advertised capability set — do not proxy commands you have not audited.

---

## 10. Verification

Per `AGENTS.md`, before submitting: `npx tsc --noEmit`, `npm run build`, then exercise the flows with both processes running.

Specific to this work:

- **Editor:** open a file, type, switch files, switch back. Cursor and undo history must survive within a file and reset across files. A remount-per-keystroke bug is invisible until you try to undo.
- **Diagnostics:** generate a build with a deliberate type error and confirm the squiggle lands on the right token. Then **edit the line and confirm the stale squiggle disappears rather than sliding onto the wrong text** — that is the §5.2 trap, and it passes review while being wrong.
- **Validator:** confirm `unmappedCodes()` returns nothing after adding `type-error`. A code in neither map is logged as an open question, which is a silent pass.
- **Memory:** confirm the tap is additive — a failing typecheck must not block a transition. Per `AGENTS.md`, never assert something was absent from a recall without first proving it would otherwise have been present.

---

## 11. What this document does not establish

1. **Android Chrome was never exercised.** Measurements come from real phone hardware, but the browser was a desktop-Linux Chromium under proot driven by synthetic CDP events. The soft keyboard and IME composition pipeline never ran. Closable today — `adb` is installed and `playwright._android.devices()` exists in Playwright 1.62.1; it needs Android wireless debugging enabled and adb paired.
2. **No code in this repo was modified.** All prototypes live in the session scratchpad.
3. **Cross-file type resolution was not exercised.** The verified prototypes used a single file. §5.5's `node_modules` problem is reasoned, not measured.
4. **No load testing.** One connection, one small file. Concurrent tsc runs under memory pressure on a phone are unmeasured, and §9.2 is a real concern.
5. **Multi-line elaborated diagnostics were not reproduced** on TS 5.9.3 — the parser handles them defensively on documented behavior, not on an observed sample.
6. **Security review not performed.** §9 is a starting checklist from reading the code, not an audit.
