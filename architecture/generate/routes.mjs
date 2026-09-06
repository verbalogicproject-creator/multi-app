#!/usr/bin/env node
// Generates ../rest-curl-api-endpoints-schema.json.
//
// The route inventory (method + path + file:line) is extracted by regex from the
// actual route-registration calls — never hand-typed, so a route that's added,
// removed or remounted shows up here automatically. Purpose/request/response/curl
// text is hand-authored (a read pass over each handler cannot be mechanized) and
// cross-checked against the extracted inventory in --verify mode: an endpoint with
// no documentation entry, or a documentation entry for an endpoint that no longer
// exists, is a FAIL, not a silent gap.
//
// Run: node architecture/generate/routes.mjs
// Verify: node architecture/generate/routes.mjs --verify

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '..', 'rest-curl-api-endpoints-schema.json');

// path -> full mount prefix, read from server.js's own app.use() calls.
const MOUNTS = {
    'memory/routes.js': '/api/memory',
    'preview/routes.js': '/api/preview',
    'typecheck/routes.js': '/api/typecheck',
};

function extractFromFile(relFile, prefix = '') {
    const abs = path.join(ROOT, relFile);
    const text = readFileSync(abs, 'utf8');
    const lines = text.split('\n');
    const found = [];
    const re = /\b(?:app|router|memoryRouter)\.(get|post|put|delete|patch)\(\s*['"]([^'"]*)['"]/;
    lines.forEach((line, i) => {
        const m = line.match(re);
        if (!m) return;
        const [, method, routePath] = m;
        if (relFile === 'server.js' && routePath === '*') return; // SPA fallback, not an API route
        const full = (prefix + routePath).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
        found.push({ method: method.toUpperCase(), path: full, file: relFile, line: i + 1 });
    });
    return found;
}

function extractAll() {
    const fromServer = extractFromFile('server.js');
    const fromRouters = Object.entries(MOUNTS).flatMap(([file, prefix]) => extractFromFile(file, prefix));
    // Auth routes register their own absolute paths already (auth/google.js, auth/github.js).
    const fromAuth = [...extractFromFile('auth/google.js'), ...extractFromFile('auth/github.js')];
    return [...fromServer, ...fromRouters, ...fromAuth];
}

// Hand-authored documentation, keyed by "METHOD path", produced by a full read of
// every handler body (see the architecture-audit session this generator was
// written in for the exact citations). One entry per extracted route, cross-checked
// below rather than trusted on its own.
const DOCUMENTED = {
    "GET /api/quota": { purpose: "Returns today's per-model request/token usage counters plus the configured daily quota limits and default model ids.", request: "None.", response: "200 {date, counts:{modelId:number}, tokens:{modelId:{in,out}}, limits:{modelId:number}, models:{chat,coding,builder,image,video}}.", curl: "curl -s http://localhost:8050/api/quota", notes: "No model call; reads/writes in-memory quotaState, persisted to logs/quota.json." },
    "GET /api/models": { purpose: "Lists every usable model (provider has a configured key) with capabilities/pricing/daily limit, plus per-task defaults.", request: "None.", response: "200 {models:[{id,provider,providerLabel,label,hint,thinking,tools,priceIn,priceOut,dailyLimit,paid}], defaults:{chat,coding,builder,image,video}}.", curl: "curl -s http://localhost:8050/api/models", notes: "No model call — filters providers/catalog.js's CATALOG by configured env keys." },
    "POST /api/chat-stream": { purpose: "Streams a single-turn plain-text chat reply from the default (or requested) chat model.", request: "{prompt: string (required), model?: string}.", response: "200 text/plain streamed chunks; 400 {message} if prompt missing; 500 {message} on failure before any bytes sent.", curl: "curl -N -X POST http://localhost:8050/api/chat-stream -H 'Content-Type: application/json' -d '{\"prompt\":\"Write a haiku about databases\"}'", notes: "Single provider.streamChat call at effort 'low', maxOutputTokens 4096." },
    "POST /api/edit-image": { purpose: "Edits an uploaded image per a text prompt using Gemini's image model.", request: "multipart/form-data: file (image, required), prompt (string, required).", response: "200 JSON array of parts [{text?}|{imageUrl?: data URL}]; 400/500 {message}.", curl: "curl -X POST http://localhost:8050/api/edit-image -F 'file=@photo.png' -F 'prompt=Make the background sunset orange'", notes: "Multer in-memory upload. Calls @google/genai directly, not through providers/ — feature flagged off in the UI." },
    "POST /api/generate-video": { purpose: "Starts asynchronous video generation (optionally image-to-video) via Veo, returns an operation name to poll.", request: "multipart/form-data: prompt (required), file? (starting frame).", response: "200 {operationName}; 400/500 {message}.", curl: "curl -X POST http://localhost:8050/api/generate-video -F 'prompt=A drone shot over a neon city'", notes: "Direct @google/genai call; client must poll /api/video-status." },
    "GET /api/video-status": { purpose: "Polls a Veo operation and, once complete, downloads and returns the finished video inline as a base64 data URL.", request: "query operationName (required).", response: "200 {done:false} | {done:true, videoUrl} | {done:true, error}; 400/500 {message}.", curl: "curl -s 'http://localhost:8050/api/video-status?operationName=...'", notes: "Re-downloads and base64-inlines the whole video server-side on each completed poll." },
    "POST /api/coding-chat-stream": { purpose: "Streams a multi-turn coding-assistant reply, including tool calls and optional web-search grounding, as NDJSON.", request: "{history?, projects?, persona?, useWebSearch?, customStyles?, lowLatencyMode?, model?, mode?}.", response: "200 application/x-ndjson lines {text?, thinking?, functionCalls?, groundingMetadata?}; 500 {message}.", curl: "curl -N -X POST http://localhost:8050/api/coding-chat-stream -H 'Content-Type: application/json' -d '{\"history\":[{\"author\":\"user\",\"parts\":[{\"text\":\"How do I center a div?\"}]}]}'", notes: "Routed provider-agnostically through providers/, unlike chat-stream/edit-image/video." },
    "GET /api/npm-search": { purpose: "Proxies an npm registry search, returning up to 5 matches.", request: "query packageName (required).", response: "200 [{name,version,description}] or {error}; 400/500 {message}.", curl: "curl -s 'http://localhost:8050/api/npm-search?packageName=zod'", notes: "No model call; plain fetch against registry.npmjs.org." },
    "POST /api/analyze-dependencies": { purpose: "Asks the coding model to summarize libraries/frameworks apparent across provided source files.", request: "{files:[{content, ...}]} required non-empty.", response: "200 {summary}; 500 {message}.", curl: "curl -X POST http://localhost:8050/api/analyze-dependencies -H 'Content-Type: application/json' -d '{\"files\":[{\"content\":\"import { z } from \\\"zod\\\";\"}]}'", notes: "Single generateText call against MODELS.coding." },
    "POST /api/builder/plan": { purpose: "Generates (or, given previousPlan+feedback, revises) a structured project plan from a one-line idea.", request: "{idea, model?, previousPlan?, feedback?, buildId?, episodeId?}.", response: "200 PLAN_SCHEMA {projectName, projectDescription, pages, components, acceptanceCriteria, entities}; 500 {message}.", curl: "curl -X POST http://localhost:8050/api/builder/plan -H 'Content-Type: application/json' -d '{\"idea\":\"A recipe sharing app\"}'", notes: "Structured-output call via withModelFallback over the builder model chain; memory event fires after the response is sent, never on the critical path." },
    "POST /api/builder/directions": { purpose: "Proposes exactly three distinct art directions (palette + typography) for the theme step.", request: "{idea?, plan?, model?, buildId?, episodeId?}.", response: "200 {directions:[{name,rationale,typography,colors}]} — exactly 3; 500 {message}.", curl: "curl -X POST http://localhost:8050/api/builder/directions -H 'Content-Type: application/json' -d '{\"idea\":\"A recipe sharing app\"}'", notes: "Same fallback-chain pattern as /plan; recall runs with directionGeneration:true, excluding taste lessons." },
    "POST /api/builder/generate": { purpose: "The generation pipeline entry point: manifest-then-per-file, streaming progress, then a compiler-driven repair pass.", request: "{plan (required), theme?, model?, buildId?, episodeId?}.", response: "Streaming application/x-ndjson — phase/manifest/file/progress lines, then a final line with files/manifest/missing/repair stats; 500 {message} before any bytes, or a final {error} NDJSON line mid-stream.", curl: "curl -N -X POST http://localhost:8050/api/builder/generate -H 'Content-Type: application/json' -d '{\"plan\":{\"projectName\":\"RecipeShare\",\"pages\":[{\"name\":\"HomePage\",\"path\":\"/\"}],\"components\":[],\"acceptanceCriteria\":[],\"entities\":[]}}'", notes: "See harness-agentic-loop.json for the repair-round mechanics — this is the pipeline the generation-pipeline audit is about." },
    "POST /api/builder/check-acceptance": { purpose: "Has the model self-report, per acceptance criterion, whether the generated files satisfy it — a labelled self-check, never a gate.", request: "{plan:{acceptanceCriteria}, files, model?}.", response: "200 {issues:[{severity:'warning', code:'acceptance-criterion-unmet', message}]}; 500 {message}.", curl: "curl -X POST http://localhost:8050/api/builder/check-acceptance -H 'Content-Type: application/json' -d '{\"plan\":{\"acceptanceCriteria\":[\"Users can view recipes\"]},\"files\":{}}'", notes: "Every message suffixed '(self-reported...not independently verified)'; never in memory/proposals.js's PROPOSAL_TABLE." },
    "POST /api/builder/edit": { purpose: "The peer-programmer edit: applies a natural-language instruction to an existing project, returns only changed files merged over the current set, then typechecks.", request: "{files, plan?, diagnostics?, instruction (required), model?, buildId?, episodeId?}.", response: "200 {files, changedPaths, summary, typecheck:{completed,ok,issues}}; 400/500 {message}.", curl: "curl -X POST http://localhost:8050/api/builder/edit -H 'Content-Type: application/json' -d '{\"files\":{},\"instruction\":\"Add a heading\"}'", notes: "Single structured-output call at effort 'high', then a real tsc run — no browser preview at this route." },
    "GET /healthz": { purpose: "Liveness probe that also reports whether the /api surface is currently enforcing authentication.", request: "None.", response: "200 {ok:true, models, auth:'enforced'|'open'}.", curl: "curl -s http://localhost:8050/healthz", notes: "Mounted outside /api so a liveness probe never needs a session." },
    "POST /api/memory/episodes/open": { purpose: "Opens (or rejoins an already-open matching) memory episode, or a no-op null id if memory is unavailable.", request: "{buildId?, objective?, baseRevisionId?}.", response: "200 {episodeId: string|null} always.", curl: "curl -X POST http://localhost:8050/api/memory/episodes/open -H 'Content-Type: application/json' -d '{\"buildId\":\"build-123\",\"objective\":\"plan a recipe app\"}'", notes: "Bounded to 2s; never gates the builder — the route only ever answers 200." },
    "POST /api/memory/episodes/close": { purpose: "Closes an episode with a final outcome and checks whether any lessons it used now qualify for promotion.", request: "{buildId?, episodeId (required), outcome: verified|failed|abandoned (required), provider?, model?}.", response: "200 {closed, qualified}; 400 {message} on invalid outcome.", curl: "curl -X POST http://localhost:8050/api/memory/episodes/close -H 'Content-Type: application/json' -d '{\"episodeId\":\"ep-1\",\"outcome\":\"verified\"}'", notes: "The promotion ratchet lives here: a lesson only counts toward promotion once the attempt that used it closes 'verified'." },
    "POST /api/memory/events": { purpose: "Batch-records builder lifecycle events plus evidence, and derives lesson proposals from failed verdicts.", request: "{buildId?, episodeId?, events?[max 32], evidence?[max 32]}.", response: "200 {accepted, accepted_ids, rejected, evidenceIds, proposed}; an unrecognized kind lands in rejected, never an HTTP error.", curl: "curl -X POST http://localhost:8050/api/memory/events -H 'Content-Type: application/json' -d '{\"episodeId\":\"ep-1\",\"events\":[{\"kind\":\"verification.completed\",\"domain\":\"build\",\"payload\":{\"codes\":[\"unresolved-import\"]}}]}'", notes: "Only verification.completed events can produce proposals, via memory/proposals.js's declared table — no model involved." },
    "GET /api/memory/state": { purpose: "Reports memory-engine health and, given a buildId, that build's episode/lesson/evidence/event counts.", request: "query buildId (optional).", response: "200 {health:{available,probed,reason,databaseDir,openBuilds,failures,lastInjection,lastTrial}, build|null}.", curl: "curl -s 'http://localhost:8050/api/memory/state?buildId=build-123'", notes: "probe() forces the engine to actually load before answering." },
    "POST /api/memory/lessons/:lessonId/approve": { purpose: "The human gate: promotes a qualified lesson to 'approved' under a named approver.", request: "path lessonId; body {buildId?, approvedBy (required)}.", response: "200 {ok:true, lesson} | {ok:false, message}; 400 if approvedBy missing.", curl: "curl -X POST http://localhost:8050/api/memory/lessons/lesson-42/approve -H 'Content-Type: application/json' -d '{\"approvedBy\":\"you@example.com\"}'", notes: "Reachable from no prompt or tool schema — no model can approve its own lesson." },
    "POST /api/preview/build": { purpose: "Bundles a generated project with esbuild and compiles its CSS into one self-contained HTML document for the sandboxed iframe preview.", request: "{files} — object, non-empty, ≤400 entries / 4MB.", response: "200 {ok:true, html, entry, bytes, styleError, ...} | {ok:false, errors, durationMs} (bundle failure is not an HTTP error); 400/413/500 {error}.", curl: "curl -X POST http://localhost:8050/api/preview/build -H 'Content-Type: application/json' -d '{\"files\":{\"index.html\":\"<div id=root></div>\"}}'", notes: "No model call — pure esbuild over a virtual filesystem." },
    "POST /api/typecheck": { purpose: "Runs the real tsc against in-memory project files and returns typed diagnostics.", request: "{projectId (required), revision?, files (required, ≤400/4MB)}.", response: "200 {revision, completed, ok, issues, diagnostics, truncated, checked, durationMs}; 400/413/500 {error}.", curl: "curl -X POST http://localhost:8050/api/typecheck -H 'Content-Type: application/json' -d '{\"projectId\":\"build-123-check\",\"files\":{\"src/App.tsx\":\"export default function App(){return null}\"}}'", notes: "Mounted at /api/typecheck, router path '/'. Cancels the tsc run on client disconnect." },
    "GET /api/auth/google": { purpose: "Mints a CSRF state nonce and redirects to Google's OAuth consent screen.", request: "None — any incoming state is ignored.", response: "302 redirect; sets multi_app_oauth_state cookie (httpOnly, 10 min).", curl: "curl -i http://localhost:8050/api/auth/google", notes: "Exempt from the /api auth gate." },
    "GET /api/auth/google/callback": { purpose: "Validates state, exchanges the code, fetches the profile, checks ALLOWED_EMAILS, issues the session cookie.", request: "query code, state (required), error?.", response: "302 to successRedirect with multi_app_session cookie (7-day) | 400 (state mismatch/missing code) | 403 (not allowlisted) | 500.", curl: "curl -i 'http://localhost:8050/api/auth/google/callback?code=...&state=...'", notes: "The state cookie is cleared before anything else can fail, making the nonce single-use even on a failed exchange." },
    "GET /api/auth/session": { purpose: "Reports whether the request carries a valid session and, if so, the user's profile.", request: "Reads the session cookie or an Authorization: Bearer header.", response: "200 {authenticated:false,user:null} | {authenticated:true,user:{...}} — always 200 at the handler level.", curl: "curl -s http://localhost:8050/api/auth/session -H 'Cookie: multi_app_session=<jwt>'", notes: "This route's own middleware never rejects; the actual 401 for an unauthenticated caller comes from the app-wide /api gate, not this handler." },
    "POST /api/auth/logout": { purpose: "Clears the session cookie.", request: "None.", response: "200 {success:true, message}.", curl: "curl -X POST http://localhost:8050/api/auth/logout -H 'Cookie: multi_app_session=<jwt>'", notes: "Stateless JWTs are not revoked server-side — only the browser's cookie is cleared." },
    "GET /api/auth/github": { purpose: "Mints a CSRF state nonce and redirects to GitHub's OAuth authorize page.", request: "None.", response: "302 redirect; sets multi_app_oauth_state cookie.", curl: "curl -i http://localhost:8050/api/auth/github", notes: "Only mounted when GITHUB_CLIENT_ID/SECRET are set; refuses to construct without ALLOWED_GITHUB_USERS." },
    "GET /api/auth/github/callback": { purpose: "Validates state, exchanges the code for a token, fetches the profile, checks ALLOWED_GITHUB_USERS, issues the shared session cookie.", request: "query code, state (required), error?.", response: "302 with multi_app_session cookie | 400 | 403 | 500.", curl: "curl -i 'http://localhost:8050/api/auth/github/callback?code=...&state=...'", notes: "Issues sessions under the identical cookie name and JWT secret as Google — indistinguishable to requireAuth." },
};

const MIDDLEWARE_NOTE = {
    path: '/api (app.use middleware)',
    file: 'server.js',
    line: 126,
    statement: 'The actual per-request authorization gate: wraps every /api/* route except /api/auth/* with auth.requireAuth, but only when enforceAuth is true (authConfigProblems().length === 0 — real Google client id/secret, a real >=32-char JWT_SECRET, and a non-empty ALLOWED_EMAILS, evaluated once at module load).',
    level: 'gate',
    distinctFrom: 'bootPosture (server.js:82) — a separate, boot-time check that can process.exit(1) before the server ever binds if unconfigured auth is combined with a non-loopback HOST. This middleware is the per-request enforcement; bootPosture is the boot-time refusal.',
};

function buildSchema() {
    const extracted = extractAll();
    const documentedKeys = new Set(Object.keys(DOCUMENTED));
    const extractedKeys = new Set(extracted.map(r => `${r.method} ${r.path}`));

    const endpoints = extracted.map((r) => {
        const key = `${r.method} ${r.path}`;
        const doc = DOCUMENTED[key];
        return {
            method: r.method,
            path: r.path,
            mechanism: { file: r.file, line: r.line },
            ...(doc ?? { purpose: null, level: 'gap', note: 'extracted route has no documentation entry yet — see DOCUMENTED in generate/routes.mjs' }),
        };
    });

    const orphanedDocs = [...documentedKeys].filter(k => !extractedKeys.has(k));

    return {
        $schema: 'declaration-v1',
        generatedBy: 'architecture/generate/routes.mjs',
        generatedFrom: 'regex extraction over server.js + memory/routes.js + preview/routes.js + typecheck/routes.js + auth/google.js + auth/github.js (the route inventory), merged with a hand-authored DOCUMENTED registry (purpose/request/response/curl) cross-checked against it',
        totalEndpoints: endpoints.length,
        orphanedDocumentationEntries: orphanedDocs.length > 0 ? orphanedDocs : undefined,
        appWideMiddleware: [MIDDLEWARE_NOTE],
        endpoints,
    };
}

const output = buildSchema();
const json = JSON.stringify(output, null, 2) + '\n';

if (process.argv.includes('--verify')) {
    if (!existsSync(OUT)) { console.error('FAIL rest-curl-api-endpoints-schema.json does not exist'); process.exit(1); }
    const onDisk = readFileSync(OUT, 'utf8');
    const undocumented = output.endpoints.filter(e => e.level === 'gap');
    if (undocumented.length > 0) {
        console.error(`FAIL ${undocumented.length} route(s) extracted from source have no documentation entry: ${undocumented.map(e => `${e.method} ${e.path}`).join(', ')}`);
        process.exit(1);
    }
    if (output.orphanedDocumentationEntries) {
        console.error(`FAIL DOCUMENTED has entries for routes that no longer exist in source: ${output.orphanedDocumentationEntries.join(', ')}`);
        process.exit(1);
    }
    if (onDisk !== json) { console.error('FAIL rest-curl-api-endpoints-schema.json is stale — re-run: node architecture/generate/routes.mjs'); process.exit(1); }
    console.log(`ok rest-curl-api-endpoints-schema.json matches source (${output.totalEndpoints} endpoints, all documented)`);
    process.exit(0);
}

writeFileSync(OUT, json);
console.log(`wrote ${path.relative(ROOT, OUT)} (${output.totalEndpoints} endpoints)`);
