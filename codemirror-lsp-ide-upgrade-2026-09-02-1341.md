# CodeMirror + LSP for the multi-app IDE — Implementation Guide

**Date:** 2026-09-02 13:41 UTC
**Target:** `/root/multi-app` (`gemini-multimodal-chat`) — pre-renderer IDE upgrade
**Status:** The core round trip was **built and verified working on this machine** before this document was written. Code below is transcribed from a running prototype, not composed from memory.
**Companion:** `/root/monaco/codemirror-monaco-comparison-report-2026-09-02-1329.md`

---

## 1. Bottom line

You can have Monaco's one genuine advantage — **type-aware completion** — on CodeMirror, for **+19.9 KB gzip**.

Measured on this machine, same Vite, same headless Chromium 151, same probe:

| Configuration | Payload (gzip) | `answer.toFi` → ? |
|---|---:|---|
| Plain CodeMirror 6 | 162.2 KB | ❌ nothing |
| **CodeMirror + `@codemirror/lsp-client`** | **182.1 KB** | ✅ **`toFixed`** |
| Monaco (real load for one JS file) | 2549.8 KB | ✅ `toFixed` + signature |

**CodeMirror + LSP costs 14× less than Monaco and reaches feature parity on the thing that matters.**

The language server advertised **23 capabilities** in the verified run — not just completion:

```
textDocumentSync         completionProvider       codeActionProvider
codeLensProvider         definitionProvider       documentFormattingProvider
documentRangeFormatting  documentHighlightProvider documentSymbolProvider
executeCommandProvider   hoverProvider            inlayHintProvider
linkedEditingRange       renameProvider           referencesProvider
selectionRangeProvider   signatureHelpProvider    workspaceSymbolProvider
implementationProvider   typeDefinitionProvider   foldingRangeProvider
semanticTokensProvider   workspace
```

Hover types, go-to-definition, rename-symbol, find-references, inlay hints, diagnostics, and formatting all become available from the same connection. `@codemirror/lsp-client` ships editor extensions for each.

---

## 2. Why this fits multi-app specifically

Three facts about your codebase decide the architecture:

1. **`components/CodeEditor.tsx` is a raw 77-line `<textarea>`.** No editor library, no highlighting. This is greenfield — you are not migrating off anything, so there is no swap cost.
2. **You have a Node backend.** `server.js` runs Express on `:8080`, and `vite.config.ts` already proxies `/api` to it. Fractal (the SAG example) is browser-only and would have to fight `tsserver` into a web worker. **You don't.** You can run a real language server as a child process, server-side, which is the well-trodden path.
3. **Your files are virtual.** `types/project.ts:8` — `ProjectFile { path, content, projectId }`, generated in memory by `/api/builder/generate`. There is no directory on disk for a language server to read. **This is the one genuinely hard part of the integration**, and §5 is about it.

---

## 3. Architecture options

### Option A — Server-side language server over WebSocket ✅ **Recommended**

```
Browser                          Express (:8080)                  child process
┌────────────────────┐           ┌──────────────────┐            ┌─────────────┐
│ CodeMirror         │           │ WS endpoint      │            │ typescript- │
│ @codemirror/       │◄─ ws ────►│ /api/lsp         │◄─ stdio ──►│ language-   │
│   lsp-client       │  (JSON)   │ (framing bridge) │ (LSP+CL)   │ server      │
└────────────────────┘           └──────────────────┘            └─────────────┘
```

**Pros:** real tsserver, full capability set, no browser CPU/memory cost, no bundle cost beyond the client, works on low-end phones because the phone does no analysis.
**Cons:** requires the server to be reachable; needs a real workspace on disk (§5); is a security surface (§8).
**Verified:** yes — this exact topology was built and probed successfully.

### Option B — TypeScript in a browser web worker

`@typescript/vfs` (1.6.4) + the TypeScript compiler in a worker, driving `@codemirror/autocomplete` directly. No LSP protocol.

**Pros:** no server dependency, works offline, no security surface.
**Cons:** you ship the TypeScript compiler to the browser — this is exactly the ~1.4 MB gzip cost that makes Monaco heavy, so **you lose the entire size advantage**. Poor fit for phones.
**Use when:** the editor must work with no backend.

### Option C — Lexical completion only

Ship CodeMirror with `basicSetup` and stop. You get keyword and in-scope identifier completion (verified: `ans` → `answer`, `fun` → `function`), highlighting, folding, search — no type awareness.

**Use when:** you want the IDE upgrade shipped this week and type intelligence is a later milestone. **This is a legitimate Phase 1** (§9).

---

## 4. Verified working implementation

Everything in this section ran successfully. Package versions confirmed live on npm at time of writing.

### 4.1 Dependencies

```sh
# client
npm i codemirror @codemirror/lang-javascript @codemirror/lsp-client

# server
npm i ws typescript-language-server
npm i -E typescript@6.0.3        # see §7.1 — do NOT let this float to 7.x
```

| Package | Verified version |
|---|---|
| `codemirror` | 6.0.2 |
| `@codemirror/lsp-client` | 6.2.5 |
| `@codemirror/lang-javascript` | 6.2.5 |
| `typescript-language-server` | 6.0.0 |
| `typescript` | **6.0.3 (pinned)** |
| `ws` | 8.21.3 |

### 4.2 Server — the WebSocket ↔ stdio bridge

Language servers speak LSP over stdio with `Content-Length` framing. Browsers speak WebSocket with plain frames. The bridge translates. **This is the entire server-side integration.**

```js
// server/lsp-bridge.mjs
import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';

export function attachLspBridge(httpServer, { path = '/api/lsp', workspaceRoot }) {
  const wss = new WebSocketServer({ server: httpServer, path });

  wss.on('connection', (socket) => {
    const server = spawn('./node_modules/.bin/typescript-language-server', ['--stdio'], {
      cwd: workspaceRoot, stdio: 'pipe',
    });
    server.stderr.on('data', d => console.error('[tsls]', String(d).trim().slice(0, 200)));

    // stdio -> ws : strip Content-Length framing
    let buf = Buffer.alloc(0);
    server.stdout.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const sep = buf.indexOf('\r\n\r\n');
        if (sep < 0) break;
        const m = /content-length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString());
        if (!m) { buf = buf.subarray(sep + 4); continue; }
        const len = Number(m[1]);
        if (buf.length < sep + 4 + len) break;              // frame incomplete, wait
        const body = buf.subarray(sep + 4, sep + 4 + len).toString();
        buf = buf.subarray(sep + 4 + len);
        if (socket.readyState === socket.OPEN) socket.send(body);
      }
    });

    // ws -> stdio : add Content-Length framing
    socket.on('message', (data) => {
      const body = Buffer.from(data.toString(), 'utf8');
      server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      server.stdin.write(body);
    });

    socket.on('close', () => server.kill());
    server.on('exit', () => { try { socket.close(); } catch {} });
  });
}
```

Wiring it into `server.js` requires promoting `app.listen(port)` to an explicit HTTP server, because `ws` needs the server object:

```js
// server.js — replace `app.listen(port, ...)`
import http from 'node:http';
import { attachLspBridge } from './server/lsp-bridge.mjs';

const httpServer = http.createServer(app);
attachLspBridge(httpServer, { workspaceRoot: WORKSPACE_ROOT });   // see §5
httpServer.listen(port, () => { /* existing log */ });
```

Vite must proxy the WebSocket in dev — note `ws: true`:

```ts
// vite.config.ts
server: {
  proxy: {
    '/api/lsp': { target: 'ws://localhost:8080', ws: true },   // must precede '/api'
    '/api':     { target: 'http://localhost:8080', changeOrigin: true },
  }
}
```

> Order matters. Vite matches proxy keys in insertion order; if `'/api'` comes first it swallows `/api/lsp` and the socket never upgrades.

### 4.3 Client — transport and editor

```js
import { basicSetup, EditorView } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { LSPClient, languageServerSupport } from '@codemirror/lsp-client';

// @codemirror/lsp-client's Transport is a 3-method interface: send / subscribe / unsubscribe.
// It does NOT open the socket for you, and it does not queue pre-open messages — so we do.
function webSocketTransport(url) {
  const handlers = new Set();
  const socket = new WebSocket(url);
  const queue = [];
  socket.onopen = () => { queue.splice(0).forEach(m => socket.send(m)); };
  socket.onmessage = (e) => handlers.forEach(h => h(String(e.data)));
  return {
    send(message) { socket.readyState === 1 ? socket.send(message) : queue.push(message); },
    subscribe(h) { handlers.add(h); },
    unsubscribe(h) { handlers.delete(h); },
  };
}

const client = new LSPClient({ rootUri: ROOT_URI })
  .connect(webSocketTransport(`ws://${location.host}/api/lsp`));

const view = new EditorView({
  parent: hostElement,
  doc: file.content,
  extensions: [
    basicSetup,
    javascript({ typescript: true, jsx: file.path.endsWith('x') }),
    languageServerSupport(client, `${ROOT_URI}/${file.path}`, 'typescript'),
  ],
});
```

`client.initializing` is a promise that resolves when the handshake completes — use it to gate UI that depends on the server, and to show a "language server connecting…" state.

**The message queue is not optional.** `LSPClient.connect()` sends `initialize` immediately, synchronously, before the socket has opened. Without the queue that first message is dropped and the client hangs forever in `initializing`.

---

## 5. The hard part: your files are virtual

`typescript-language-server` resolves modules, reads `tsconfig.json`, and loads `lib.d.ts` **from a real filesystem**. Your `ProjectFile[]` lives in memory.

Three ways to bridge this, in ascending order of effort:

### 5.1 Materialize to a temp workspace ✅ recommended to start

On project open, write the project's files to `os.tmpdir()/multi-app/<projectId>/`; on save, write through. The language server reads a normal directory and nothing else changes.

```js
// server/workspace.js  (sketch — path validation is mandatory, see §8)
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(os.tmpdir(), 'multi-app-ws');

export async function materialize(projectId, files) {
  const dir = path.join(ROOT, projectId);
  await fs.rm(dir, { recursive: true, force: true });
  for (const f of files) {
    const target = path.resolve(dir, f.path);
    if (!target.startsWith(dir + path.sep)) throw new Error('path escape refused');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, f.content, 'utf8');
  }
  await ensureTsconfig(dir);   // see §7.2 — the server needs one
  return dir;
}
```

**Pros:** simple, robust, real module resolution, `npm`-installed types work if you also materialize `node_modules` or a `package.json`.
**Cons:** disk I/O per project; needs cleanup; two sources of truth to keep in sync.

### 5.2 Custom `Workspace` on the client

`@codemirror/lsp-client` exports an abstract `Workspace` class, and `LSPClientConfig.workspace` accepts a factory. The default "only opens files that have an active editor, and only allows one editor per file" — which is wrong for a multi-file project where cross-file types matter.

Implementing `Workspace` lets you tell the server about **all** project files via `textDocument/didOpen` without touching disk, so imports between generated files resolve.

**Pros:** no filesystem, single source of truth, works for cross-file completion.
**Cons:** you must implement the abstract class correctly; `lib.d.ts` and `node_modules` types still need to come from somewhere real.

### 5.3 Hybrid ✅ the actual answer for a mature build

Materialize once for the type environment (`tsconfig.json`, `package.json`, `node_modules` types), then keep live edits in memory through a custom `Workspace`. Disk provides the ambient types; memory provides the current truth. This is what production browser IDEs do.

**Recommendation:** start at 5.1 to get it working, move to 5.3 when cross-file completion on unsaved buffers starts mattering.

---

## 6. Mobile

Your app is mobile-conscious — `MobileTabBar.tsx`, `md:hidden` chrome, comments reasoning about a 390px screen. That posture is exactly why this architecture is right:

- **Analysis happens on the server.** The phone runs a 182 KB editor, not a type-checker. Monaco would put a 1.45 MB `ts.worker` on the handset and run it there.
- **CodeMirror supports touch as a first-class concern.** Verified here: tap placed the cursor and typing worked under emulated touch. Monaco's README answers mobile support with `No.`
- **Budget the completion popup for small screens.** `@codemirror/autocomplete` is configurable; cap `maxRenderedOptions` and consider disabling `activateOnTyping` on narrow viewports so the popup does not cover the line being typed.
- **Debounce.** Each keystroke can produce a round trip. On mobile data this matters — throttle document sync.

⚠️ **Partially verified.** The measurements were taken on real phone hardware (NX779J, Android 15, aarch64 under Termux `proot-distro`), so the performance figures are genuine phone-silicon numbers. What was *not* exercised is the **Android Chrome application**: Playwright drove a desktop-Linux Chromium under proot with synthetic CDP events, so the soft keyboard and IME composition pipeline were never involved. Verify the real keyboard before committing to the interaction design — see §11.1 for how to close this.

---

## 7. Gotchas — each of these cost real time

### 7.1 TypeScript 7 breaks `typescript-language-server` 🔴

`npm i typescript` today resolves to **7.0.2**, the native Go port. It **does not ship `tsserver.js`**. `typescript-language-server` wraps `tsserver.js`, so it fails at handshake with:

```
{code: -32603, message: "Request initialize failed with message:
 The TypeScript installation ... no valid TypeScript installation was found. Exiting."}
```

The TS 7 package ships only a `tsc` binary (compiler-only; no `--lsp` flag) plus a native platform package (`@typescript/typescript-linux-arm64` here).

**Fix:** pin TypeScript 6.x — `npm i -E typescript@6.0.3`. Verified on this device: `typescript-language-server` 6.0.0 initializes cleanly against TypeScript 6.0.3, which still ships `lib/tsserver.js`. 6.0.3 is the newest version that works; 7.x does not. This matches what multi-app already declares (`^5.4.5`), but `^` will drift you into 7 on a fresh install. **Pin it exactly.**

Revisit when TS 7's own LSP server ships as a usable standalone; at that point this bridge gets simpler, not harder.

### 7.2 The workspace needs a `tsconfig.json`

Without one, the server starts but infers a minimal, wrong project and completions are poor or absent. Materialize one (§5.1). Minimum viable:

```json
{ "compilerOptions": { "target": "ESNext", "module": "ESNext",
  "moduleResolution": "bundler", "strict": true, "lib": ["DOM","ESNext"] } }
```

### 7.3 The `initialize` race

Covered in §4.3. Symptom: `client.initializing` never resolves, no error, no server log. Cause: the first message was sent before the socket opened. Fix: queue.

### 7.4 Vite proxy ordering

`/api/lsp` must be declared before `/api`, and must set `ws: true`. Otherwise the upgrade request is proxied as plain HTTP and the socket closes immediately.

### 7.5 Framing bugs are silent

An off-by-one in the `Content-Length` handling produces a connection that opens, accepts messages, and never replies. If the handshake hangs, log the raw stdio bytes before suspecting the client.

---

## 8. Security — read this before exposing the endpoint 🔴

**This is a code-execution-adjacent surface in an app that generates code from AI output.** Treat it accordingly.

1. **`tsserver` reads the filesystem.** A client that controls `rootUri` and document URIs can ask the server about paths outside the intended workspace. **Validate and confine every path server-side** — resolve against the project root and reject anything that escapes it (the `startsWith(dir + path.sep)` check in §5.1 is the minimum, not the whole answer).
2. **Bind the socket to a project the caller is entitled to.** The connection must carry a project identity that the server verifies; it must not accept a client-supplied absolute root.
3. **One server process per connection is a DoS vector.** `tsserver` is memory-hungry. Cap concurrent processes, idle-timeout them, and kill on socket close (the reference bridge does the last one).
4. **Do not expose `/api/lsp` publicly without auth.** Your Express app currently uses `cors()` with no origin restriction. A WebSocket endpoint spawning child processes needs stricter treatment than a JSON route.
5. **`workspace/executeCommand` is in the advertised capability set.** Make sure you are not proxying commands you have not audited.

---

## 9. Suggested phasing

**Phase 1 — Replace the textarea (half a day, no backend work)**
Swap `CodeEditor.tsx`'s `<textarea>` for a CodeMirror instance with `basicSetup` and language modes. Immediate win: highlighting, line numbers, folding, search, bracket matching, undo history. **162 KB gzip, 711 ms build, 398 ms render** — all measured. Keep the existing save button and dirty-dot logic exactly as they are; they are good and mobile-aware.

**Phase 2 — Bridge + LSP for the active file (1–2 days)**
Add the WS bridge, materialize the workspace (§5.1), wire `languageServerSupport`. Ship completion, hover, and diagnostics. **+19.9 KB.**

**Phase 3 — Cross-file intelligence (2–3 days)**
Custom `Workspace` (§5.2/5.3) so imports between generated files resolve on unsaved buffers. This is where it starts feeling like a real IDE.

**Phase 4 — The rest of the capability set (incremental)**
Go-to-definition, find-references, rename-symbol, inlay hints, formatting. Each is one exported extension from `@codemirror/lsp-client` plus a keybinding — small, independent, individually shippable.

Phase 1 is worth doing regardless of whether Phases 2–4 ever happen.

---

## 10. Reproducing the verification

The working prototype:

```sh
mkdir cmtest && cd cmtest && npm init -y
npm i codemirror @codemirror/lang-javascript @codemirror/lsp-client vite
npm i ws typescript-language-server
npm i -E typescript@6.0.3            # NOT 7.x — see §7.1

mkdir workspace
echo 'const answer = 42;' > workspace/main.ts
cat > workspace/tsconfig.json <<'JSON'
{ "compilerOptions": { "target":"ESNext","module":"ESNext",
  "moduleResolution":"bundler","strict":true,"lib":["DOM","ESNext"] } }
JSON

# bridge.mjs = §4.2 bridge, standalone on port 8181
# main.js    = §4.3 client, rootUri pointing at ./workspace
node bridge.mjs &
npx vite build && npx vite preview --port 5401 --strictPort
```

Then drive it:

```js
await page.evaluate(() => window.__ed.focus());
await page.keyboard.type("\nanswer.toFi");
await page.keyboard.press('Control+Space');
// .cm-tooltip-autocomplete li  ->  "toFixed"
```

**Observed result:** `lspReady: true`, 23 server capabilities, `autocompleteVisible: true`, `items: ["toFixed"]`, zero page errors. Screenshot confirms the popup renders over line 3.

---

## 11. What this document does *not* establish

1. **Real phone hardware — but not the real browser.** All timings came from a physical Android phone (NX779J, Android 15) under Termux `proot-distro`, so they are phone-silicon numbers, not desktop numbers. The untested layer is **Android Chrome itself**: touch was emulated and the soft keyboard/IME never ran. This is closable today — `adb` is installed and `playwright._android.devices()` exists in Playwright 1.62.1, so enabling Android wireless debugging and pairing adb allows driving the real Chrome directly. Until then, real-browser touch and IME behavior remain the largest open risk.
2. **Single-file workspace only.** Cross-file module resolution — the actual §5 problem — was not exercised by the prototype. §5 is reasoned design, not verified behavior.
3. **Not integrated into multi-app.** No code in `/root/multi-app` was modified. The prototype lives in the session scratchpad.
4. **No load testing.** One connection, one small file. Concurrent-project memory behavior of `tsserver` is unmeasured, and §8.3 is a real concern at scale.
5. **No latency measurement over a real network.** Localhost round trips tell you nothing about mobile data.
6. **Security review not performed.** §8 lists the surfaces I can see from reading the code; it is a starting checklist, not an audit.
7. **`@codemirror/lsp-client` 6.2.5 behavior** beyond completion (rename, references, inlay hints) was confirmed *advertised* by the server, not exercised end to end.

---

*Generated 2026-09-02 13:41 UTC. §4 code is transcribed from a verified running prototype; §5 and §8 are design guidance and should be reviewed before implementation.*
