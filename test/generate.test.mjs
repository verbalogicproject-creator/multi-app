/**
 * Truncation is an instrument failure, and the ladder must not learn from it.
 *
 * A model that runs out of output budget stops mid-character. Everything before the
 * cut is intact; everything after it never existed. Both halves of that were being
 * got wrong at once:
 *
 *   1. The complete files were thrown away with the incomplete one — measured, eleven
 *      of them in a single run.
 *   2. The validators ran over the wreckage and proposed lessons from it. Also
 *      measured: three lessons, all three wrong, including "always emit index.html"
 *      for a build whose own streamed log shows index.html was emitted.
 *
 * The second is the dangerous one. A lesson only needs one passing build afterwards to
 * be promoted to `qualified` and injected into every later prompt as governed recall —
 * so a single truncation can teach the builder, permanently, to fix a mistake nobody
 * made.
 *
 * Everything asserted here is pure: no model, no network, no server. That is the point.
 * The logic that decides whether a run counts as evidence must be checkable without
 * the instrument whose failure it exists to detect.
 *
 * Setup/fixture code stays at module scope, unchanged in position, exactly as it ran in
 * this file's previous life as a plain script (`scripts/check-generate.mjs`) — Vitest
 * finishes evaluating a test file's top-level statements, awaits included, before running
 * any `it()`, so every fixture below is fully computed by the time an assertion reads it.
 * Only the assertion call sites changed shape, from `ok(label, cond, detail)` to
 * `it(label, () => expect(cond, detail).toBe(true))`.
 */
import { describe, it, expect } from 'vitest';
import * as esbuild from 'esbuild';
import { PREVIEW_PACKAGES, packageOf, OPTIONAL_PACKAGES } from '../providers/allowlist.js';
import { Buffer } from 'node:buffer';
import { salvageFiles, isTruncation } from '../providers/salvage.js';
import { toBuildIssues } from '../typecheck/parse.js';
import { proposalsFor, unmappedCodes, PROPOSAL_TABLE, NOT_A_LESSON } from '../memory/proposals.js';
import { normaliseManifest, manifestGaps, missingFrom, manifestInstruction, fileInstruction, generateFromManifest, filesNeedingRepair, importedPaths, repairInstruction, repairRound, planCoverage, coverPlan, acceptanceIssuesFrom, generatePromptFor } from '../providers/generate.js';
import { scaffoldFor, packageJsonFor, importedPackages, SCAFFOLD_PATHS, KNOWN_VERSIONS as KNOWN_VERSIONS_FOR_TEST, typesFileFor } from '../providers/scaffold.js';
import { AESTHETIC_DIMENSIONS, buildAestheticDirective } from '../providers/aesthetic.js';
import { buildSystemPrompt } from '../providers/prompts.js';

const file = (path, content) => JSON.stringify({ path, content });

// ── 1. What survived the cut ──────────────────────────────────────────────────
const TRUNCATED =
    '{"files":[' +
    file('package.json', '{"name":"harbour"}') + ',' +
    file('src/App.tsx', 'export default function App() {\n  return <main>harbour</main>;\n}') + ',' +
    '{"path":"src/Broken.tsx","content":"export const B = () => {\\n  const s = \\"unterm';

const cut = salvageFiles(TRUNCATED);

/* The walk has to be string-aware. Source code is mostly braces, so a naive depth
   counter ends at the first `}` inside a file's content — which is immediately. */
const BRACEY = '{"files":[' + file('x.ts', 'function f() { return { a: [1, 2] }; }') + ',{"path":"cut';
const bracey = salvageFiles(BRACEY);

const WHOLE = JSON.stringify({ files: [{ path: 'a.ts', content: 'export const a = 1;' }] });
const whole = salvageFiles(WHOLE);

describe('1. a truncated response still contains finished files', () => {
    it('the complete files are recovered', () => {
        expect(cut.files.length, cut.files.map(f => f.path).join(', ')).toBe(2);
    });
    it('and their content is intact, not clipped', () => {
        expect(cut.files[1]?.content.endsWith('}'), JSON.stringify(cut.files[1]?.content?.slice(-24))).toBe(true);
    });
    it('and the half-written one is dropped', () => {
        expect(!cut.files.some(f => f.path === 'src/Broken.tsx')).toBe(true);
    });
    it('and it reports that it rescued something', () => { expect(cut.salvaged).toBe(true); });

    it('braces inside file content do not end the walk early', () => {
        expect(bracey.files.length === 1 && bracey.files[0].content.endsWith('}'), bracey.files[0]?.content).toBe(true);
    });

    it('a complete response parses without salvage', () => {
        expect(whole.files.length === 1 && whole.salvaged === false, `salvaged=${whole.salvaged}`).toBe(true);
    });
    it('genuine garbage salvages nothing', () => { expect(salvageFiles('not json at all').files.length).toBe(0); });
    it('and neither does an empty response', () => { expect(salvageFiles('').files.length).toBe(0); });
});

describe('2. every provider says "I ran out of room" in its own word', () => {
    for (const [reason, expected] of [['MAX_TOKENS', true], ['max_tokens', true], ['length', true],
                                      ['max_output_tokens', true], ['STOP', false], ['tool_calls', false],
                                      [undefined, false], [null, false]]) {
        it(`${String(reason)} → ${expected}`, () => { expect(isTruncation(reason)).toBe(expected); });
    }
});

// ── 3. The right lesson for the right failure ─────────────────────────────────
const SYNTAX_DIAGS = [
    { path: 'src/data/storage.ts', line: 91, col: 138, severity: 'error', code: 'TS1002', message: 'Unterminated string literal.' },
    { path: 'src/components/NewsletterForm.tsx', line: 19, col: 6, severity: 'error', code: 'TS17008', message: "JSX element 'div' has no corresponding closing tag." },
];
const SEMANTIC_DIAGS = [
    { path: 'src/App.tsx', line: 4, col: 24, severity: 'error', code: 'TS2322', message: "Type 'string' is not assignable to type 'number'." },
];

const syntaxCodes = toBuildIssues(SYNTAX_DIAGS).map(i => i.code);
const semanticCodes = toBuildIssues(SEMANTIC_DIAGS).map(i => i.code);
const syntaxProposals = proposalsFor({ ok: false, codes: { 'syntax-error': 2 } });

describe('3. a syntax error is not a type error', () => {
    /* This is the exact mis-lesson observed: a wall of TS1002 proposed "annotate props
       and state", which has nothing to do with a file that was cut in half. */
    it('TS1002 and TS17008 are syntax-error', () => {
        expect(syntaxCodes.every(c => c === 'syntax-error'), syntaxCodes.join(', ')).toBe(true);
    });
    it('TS2322 is still type-error', () => {
        expect(semanticCodes.every(c => c === 'type-error'), semanticCodes.join(', ')).toBe(true);
    });

    it('and a syntax failure proposes syntax guidance', () => { expect(syntaxProposals[0]?.code).toBe('syntax-error'); });
    it('which is advice about closing and escaping, not about typing', () => {
        expect(/escape|close|terminate/i.test(syntaxProposals[0]?.recommendation ?? ''), syntaxProposals[0]?.recommendation?.slice(0, 70)).toBe(true);
    });
});

// ── 4. The guard, proved against its own absence ──────────────────────────────
/* The codes a truncated build actually produced, from the real run. */
const WRECKAGE = { 'syntax-error': 6, 'unbalanced-braces': 1, 'missing-index-html': 1, 'type-error': 2 };

/* Never assert that something was absent without first proving it would otherwise
   have been present — or "the guard works" and "the table is empty" look identical. */
const conclusive = proposalsFor({ ok: false, checked: 4, codes: WRECKAGE });
const inconclusive = proposalsFor({ ok: false, checked: 4, codes: WRECKAGE, inconclusive: true });

describe('4. an instrument failure proposes nothing', () => {
    it('the same verdict DOES propose when the run completed', () => {
        expect(conclusive.length > 0, conclusive.map(p => p.code).join(', ')).toBe(true);
    });
    it('and proposes nothing at all once marked inconclusive', () => {
        expect(inconclusive.length, inconclusive.map(p => p.code).join(', ')).toBe(0);
    });
    it('so the false lesson from the real run cannot recur', () => {
        expect(!inconclusive.some(p => /index\.html/.test(p.recommendation ?? '')),
            'a model that was cut off before writing index.html did not forget index.html').toBe(true);
    });
});

// ── 5. The table still answers for every code ─────────────────────────────────
const allCodes = Object.fromEntries(
    [...Object.keys(PROPOSAL_TABLE), ...Object.keys(NOT_A_LESSON)].map(c => [c, 1]),
);

describe('5. the table has an answer for every code it can be asked about', () => {
    it('no code is unmapped', () => { expect(unmappedCodes(allCodes), JSON.stringify(unmappedCodes(allCodes))).toEqual([]); });
    it('a passing verdict still teaches nothing', () => { expect(proposalsFor({ ok: true, codes: {} }).length).toBe(0); });
});

// ── 6. The manifest is what puts the ceiling out of reach ─────────────────────
const raw = [
    { path: './index.html', purpose: 'entry' },
    { path: 'index.html', purpose: 'duplicate' },
    { path: 'src/main.tsx', purpose: 'mount' },
    { path: '', purpose: 'nameless' },
    { path: 'src/App.tsx', purpose: 'routes' },
    { path: 'package.json', purpose: 'deps' },
];
const clean = normaliseManifest(raw);

const promised = [{ path: 'index.html' }, { path: 'src/App.tsx' }, { path: 'src/pages/Home.tsx' }];
const got = { 'index.html': '<!doctype html>', 'src/App.tsx': 'export default () => null;', 'src/pages/Home.tsx': '   ' };

/* Measured on a real 16-file build: every path resolved and tsc still found 28 errors,
   because `types/tide.ts` exported `CoastalStation` while `Header.tsx` imported
   `Station`, and `App.tsx` default-imported a named export. The manifest carries the
   contract now for exactly that reason. */
const contract = normaliseManifest([
    { path: 'src/types/tide.ts', purpose: 'types', exports: ['CoastalStation', 'TideEvent'] },
    { path: 'src/components/Header.tsx', purpose: 'nav', exports: ['default Header'] },
    { path: 'src/index.css', purpose: 'styles', exports: [] },
]);

const withContract = fileInstruction({ manifest: contract, path: 'src/components/Header.tsx', purpose: 'nav', written: [] });

const instruction = fileInstruction({
    manifest: [{ path: 'src/types.ts', purpose: 'shared types' }, { path: 'src/App.tsx', purpose: 'routes' }],
    path: 'src/App.tsx', purpose: 'routes', written: ['src/types.ts'],
});

describe("6. the manifest makes the build bounded and resumable", () => {
    it('a leading ./ is not a different file', () => {
        expect(clean.filter(f => f.path === 'index.html').length, clean.map(f => f.path).join(', ')).toBe(1);
    });
    it('entries with no path are dropped', () => { expect(!clean.some(f => f.path === '')).toBe(true); });
    it('order is preserved', () => { expect(clean[0].path === 'index.html' && clean[1].path === 'src/main.tsx').toBe(true); });
    it('a runaway manifest is capped', () => {
        expect(normaliseManifest(Array.from({ length: 500 }, (_, i) => ({ path: `src/f${i}.ts`, purpose: 'x' }))).length,
            'spending 500 requests to discover a runaway is the wrong time to find out').toBe(60);
    });

    /* Checked before any file is generated: N requests against a manifest that was never
       going to produce a runnable app is the expensive way to learn it cannot. */
    it('a manifest that cannot run is rejected up front', () => {
        expect(manifestGaps([{ path: 'src/App.tsx' }, { path: 'src/index.css' }]).includes('index.html'),
            JSON.stringify(manifestGaps([{ path: 'src/App.tsx' }]))).toBe(true);
    });
    it('and a complete one passes', () => { expect(manifestGaps(clean), JSON.stringify(manifestGaps(clean))).toEqual([]); });
    it('src/main.jsx satisfies the entry requirement too', () => {
        expect(manifestGaps([{ path: 'index.html' }, { path: 'package.json' }, { path: 'src/main.jsx' }, { path: 'src/App.tsx' }]).length).toBe(0);
    });

    /* The set difference is the resume list. Under the single-shot shape a stopped build
       was simply lost; here what is absent is computable. */
    it('a manifest entry with no file is missing', () => {
        expect(missingFrom(promised, got).includes('src/pages/Home.tsx'), JSON.stringify(missingFrom(promised, got))).toBe(true);
    });
    it('and a whitespace-only file counts as missing too', () => { expect(missingFrom(promised, got).length).toBe(1); });
    it('a complete project is missing nothing', () => {
        expect(missingFrom(promised, { ...got, 'src/pages/Home.tsx': 'export default () => null;' }).length).toBe(0);
    });

    it('the manifest request forbids code', () => { expect(/no code/i.test(manifestInstruction())).toBe(true); });
    it('and asks for the export contract, not just paths', () => {
        expect(/exports/i.test(manifestInstruction()), 'paths agreeing was never the failure — names were').toBe(true);
    });

    it('normalisation keeps the exports', () => { expect(contract[0].exports.length, JSON.stringify(contract[0])).toBe(2); });
    it('and tolerates an entry that exports nothing', () => {
        expect(Array.isArray(contract[2].exports) && contract[2].exports.length === 0).toBe(true);
    });

    it('every manifest line names what it exports', () => {
        expect(withContract.includes('exports: CoastalStation, TideEvent'), 'a file cannot import a name it was never told about').toBe(true);
    });
    it('a file that exports nothing says so', () => { expect(withContract.includes('exports nothing')).toBe(true); });
    it('and the request is held to the contract', () => { expect(/Honour the manifest's export contract/.test(withContract)).toBe(true); });

    /* Files are written by separate requests that never see each other's output, so the
       manifest travelling with each one is the only thing keeping imports agreeing. */
    it('each file request carries the whole manifest', () => {
        expect(instruction.includes('src/types.ts') && instruction.includes('shared types')).toBe(true);
    });
    it('and names exactly the file it wants', () => {
        expect(instruction.includes('Write exactly one file: `src/App.tsx`')).toBe(true);
    });
    it('and says what already exists to import from', () => {
        expect(/Already written[^]*src\/types\.ts/.test(instruction)).toBe(true);
    });
});

// ── 7. The whole run, driven by a stub ───────────────────────────────────────
// The branches that matter most here are the ones that occur least: a manifest that
// cannot produce a runnable app, and a single file cut short. Neither can be reached
// on demand with a real model, which is why the orchestration takes its dependencies
// as arguments — so this can reach both without one.
const PATH_RE = /Write exactly one file: `([^`]+)`/;

const stub = ({ manifest, content = () => 'export const x = 1;', truncate = [] }) => {
    const calls = { manifest: 0, files: [], manifestEfforts: [], fileEfforts: [] };
    const provider = {
        async generateJson({ effort } = {}) { calls.manifest++; calls.manifestEfforts.push(effort); return { object: { files: manifest } }; },
        async *streamJson({ prompt, effort }) {
            const path = PATH_RE.exec(prompt)?.[1];
            calls.files.push(path);
            calls.fileEfforts.push(effort);
            if (truncate.includes(path)) {
                /* Exactly what a budget overrun looks like: valid JSON, cut mid-string. */
                yield { text: `{"path":"${path}","content":"export const half = ` };
                yield { finishReason: 'MAX_TOKENS' };
                return;
            }
            yield { text: JSON.stringify({ path, content: content(path) }) };
        },
    };
    return { calls, provider };
};

const drive = async ({ manifest, truncate = [], content, prefill = {} }) => {
    const { calls, provider } = stub({ manifest, truncate, content });
    const emitted = [];
    const result = await generateFromManifest({
        models: ['stub-model'],
        run: async (models, attempt, onServed) => { const r = await attempt(models[0]); onServed?.(models[0]); return r; },
        getProvider: () => provider,
        systemFor: () => 'system',
        basePromptFor: () => 'PLAN',
        emit: (e) => emitted.push(e),
        schemas: { manifest: {}, file: {} },
        concurrency: 2,
        prefill,
    });
    return { result, calls, emitted };
};

const GOOD_MANIFEST = [
    { path: 'index.html', purpose: 'entry' },
    { path: 'package.json', purpose: 'deps' },
    { path: 'src/main.tsx', purpose: 'mount' },
    { path: 'src/App.tsx', purpose: 'routes' },
];

const happy = await drive({ manifest: GOOD_MANIFEST });
const cutRun = await drive({ manifest: GOOD_MANIFEST, truncate: ['src/App.tsx'] });
/* The expensive mistake this guards: N file requests against a manifest that could
   never produce a runnable app. Assert the requests were not made. */
const doomed = await drive({ manifest: [{ path: 'src/App.tsx', purpose: 'routes' }, { path: 'src/index.css', purpose: 'style' }, { path: 'README.md', purpose: 'docs' }] });

describe('7. the orchestration, without a model', () => {
    it('every manifest entry is requested once', () => {
        expect(happy.calls.files.length === 4 && new Set(happy.calls.files).size === 4, happy.calls.files.join(', ')).toBe(true);
    });
    it('and every one lands in the result', () => {
        expect(Object.keys(happy.result.record).length, Object.keys(happy.result.record).join(', ')).toBe(4);
    });
    it('so nothing is missing', () => { expect(happy.result.missing.length, JSON.stringify(happy.result.missing)).toBe(0); });
    it('the manifest is announced before any file is written', () => {
        expect(happy.emitted.findIndex(e => e.manifest) < happy.emitted.findIndex(e => e.file),
            JSON.stringify(happy.emitted.slice(0, 3))).toBe(true);
    });

    it('one truncated file does not take the others with it', () => {
        expect(Object.keys(cutRun.result.record).length, Object.keys(cutRun.result.record).join(', ')).toBe(3);
    });
    it('the cut file is named as truncated', () => {
        expect(cutRun.result.truncatedFiles.includes('src/App.tsx'), JSON.stringify(cutRun.result.truncatedFiles)).toBe(true);
    });
    it('and it is missing rather than half-written', () => {
        expect(cutRun.result.missing.includes('src/App.tsx') && cutRun.result.record['src/App.tsx'] === undefined,
            'a file cut mid-string must never be stored as content').toBe(true);
    });

    it('a manifest with no entry point is refused', () => { expect(Boolean(doomed.result.unusable), JSON.stringify(doomed.result).slice(0, 90)).toBe(true); });
    it('and not one file request is spent on it', () => {
        expect(doomed.calls.files.length, `${doomed.calls.files.length} request(s) were made against a manifest that cannot run`).toBe(0);
    });
});

// ── 8. The repair pass ───────────────────────────────────────────────────────
// The export contract killed the import-name failures and revealed the next layer:
// files agreeing on names and disagreeing on shapes. No manifest fixes that without
// carrying the code, so the compiler's own diagnostics drive a correction instead.
const DIAGS = [
    { path: 'src/TideCard.tsx', line: 22, col: 9, code: 'TS2339', message: "Property 'height' does not exist on type 'TideEntry'." },
    { path: 'src/TideCard.tsx', line: 30, col: 4, code: 'TS2339', message: "Property 'height' does not exist on type 'TideEntry'." },
    { path: 'src/App.tsx', line: 20, col: 6, code: 'TS2322', message: "Type '{ x: string; }' is not assignable." },
];
const grouped = filesNeedingRepair(DIAGS);

const REC = {
    'src/types.ts': 'export interface TideEntry { time: string; }',
    'src/TideCard.tsx': "import { TideEntry } from './types';\nexport const C = (e: TideEntry) => e.height;",
};

const fix = repairInstruction({
    manifest: [{ path: 'src/TideCard.tsx', purpose: 'one tide', exports: ['C'] }],
    path: 'src/TideCard.tsx', purpose: 'one tide',
    content: REC['src/TideCard.tsx'], diagnostics: grouped[0].diagnostics,
    sources: [{ path: 'src/types.ts', content: REC['src/types.ts'] }],
});

/* Only the named files cost a request. */
const repairCalls = [];
const repairEfforts = [];
const repairProvider = {
    async *streamJson({ prompt, effort }) {
        const path = /Fix one file: `([^`]+)`/.exec(prompt)?.[1];
        repairCalls.push(path);
        repairEfforts.push(effort);
        yield { text: JSON.stringify({ path, content: 'export const C = () => null;' }) };
    },
};
const record = { ...REC, 'src/Untouched.tsx': 'export const U = 1;' };
const round = await repairRound({
    models: ['stub'],
    run: async (m, attempt, onServed) => { const r = await attempt(m[0]); onServed?.(m[0]); return r; },
    getProvider: () => repairProvider,
    systemFor: () => 'sys',
    basePrompt: 'PLAN',
    manifest: [{ path: 'src/TideCard.tsx', purpose: 'card', exports: ['C'] }],
    record,
    diagnostics: DIAGS.filter(d => d.path === 'src/TideCard.tsx'),
    emit: () => {},
    schemas: { file: {} },
});

describe('8. a compiler names the broken files, and only those are re-requested', () => {
    it('diagnostics group by file', () => { expect(grouped.length, grouped.map(g => g.path).join(', ')).toBe(2); });
    it('and the most-broken file comes first', () => {
        expect(grouped[0].path, 'a file with two errors is likelier the cause than the one with one that consumes it').toBe('src/TideCard.tsx');
    });
    it('repair is capped', () => {
        expect(filesNeedingRepair(Array.from({ length: 40 }, (_, i) => ({ path: `f${i}.ts`, line: 1, col: 1, code: 'TS1', message: 'x' }))).length,
            'an unbounded repair burns quota to reach the same answer slowly').toBe(10);
    });

    it("a file's imports are resolved against what exists", () => {
        expect(importedPaths(REC['src/TideCard.tsx'], 'src/TideCard.tsx', REC).includes('src/types.ts')).toBe(true);
    });

    it("the repair carries the compiler's own words", () => { expect(fix.includes("Property 'height' does not exist")).toBe(true); });
    /* The whole reason repair beats re-prompting: a shape mismatch is unfixable from a
       description, and readable from the source. */
    it('and the real source of what it imports', () => {
        expect(fix.includes('export interface TideEntry { time: string; }'),
            'a shape disagreement cannot be fixed from a description of the file').toBe(true);
    });
    it('and holds it to its export contract', () => { expect(fix.includes('export exactly: C')).toBe(true); });

    it('only the blamed file is re-requested', () => {
        expect(repairCalls.length === 1 && repairCalls[0] === 'src/TideCard.tsx', repairCalls.join(', ')).toBe(true);
    });
    it('the fix replaces it in the record', () => { expect(record['src/TideCard.tsx'].includes('=> null')).toBe(true); });
    it('and a file nobody blamed is untouched', () => {
        expect(record['src/Untouched.tsx'], 'repair must not rewrite working code').toBe('export const U = 1;');
    });
    it('the repaired file is reported', () => { expect(round.repaired.includes('src/TideCard.tsx'), JSON.stringify(round.repaired)).toBe(true); });
});

// ── 9. The files nobody should pay a model to retype ─────────────────────────
// The generate prompt dictates tsconfig's compilerOptions verbatim, pins package.json
// versions, mandates @tailwindcss/vite and `@import "tailwindcss"`. There is no
// judgement left in any of it — and these are the files where a mistake is least
// recoverable, since a wrong tsconfig breaks every file after it.
const sc = scaffoldFor({ plan: { projectName: 'Tide Clock' }, theme: { colors: { bg: '#001122', primary: '#00aaff' } } });
const escaped = scaffoldFor({ plan: { projectName: 'A <script> & "quote"' }, theme: {} });

/* package.json is derived from the imports the code actually contains. A list a model
   writes can disagree with the code it wrote; a list read from the code cannot. */
const src = {
    'src/App.tsx': "import { Menu } from 'lucide-react';\nimport clsx from 'clsx';\nimport { x } from './local';",
    'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport path from 'node:path';",
};
const pkgs = importedPackages(src);
const pkg = JSON.parse(packageJsonFor({ plan: { projectName: 'Tide Clock' }, record: src }));

/* The point of the exercise: these paths never reach the queue. */
const scaffoldRun = await (async () => {
    const calls = [];
    const provider = {
        async generateJson() {
            return { object: { files: [
                { path: 'index.html', purpose: 'shell', exports: [] },
                { path: 'tsconfig.json', purpose: 'config', exports: [] },
                { path: 'src/main.tsx', purpose: 'mount', exports: [] },
                { path: 'src/App.tsx', purpose: 'routes', exports: ['default App'] },
            ] } };
        },
        async *streamJson({ prompt }) {
            const path = /Write exactly one file: `([^`]+)`/.exec(prompt)?.[1];
            calls.push(path);
            yield { text: JSON.stringify({ path, content: 'export default () => null;' }) };
        },
    };
    const result = await generateFromManifest({
        models: ['stub'],
        run: async (m, a, s2) => { const r = await a(m[0]); s2?.(m[0]); return r; },
        getProvider: () => provider, systemFor: () => 'sys', basePromptFor: () => 'PLAN',
        emit: () => {}, schemas: { manifest: {}, file: {} },
        prefill: scaffoldFor({ plan: { projectName: 'X' }, theme: {} }),
        provided: ['package.json'],
    });
    return { calls, result };
})();

describe('9. the scaffold is written, not requested', () => {
    it('five files are written outright', () => { expect(Object.keys(sc).length, Object.keys(sc).join(', ')).toBe(5); });
    /* The one that came from a broken build rather than from reasoning: main.tsx mounted
       <App /> with no Router while App.tsx used Routes and useLocation. tsc passed, esbuild
       passed, and the app threw on first render and drew nothing. */
    it('the entry mounts the root', () => { expect(sc['src/main.tsx'].includes("document.getElementById('root')")).toBe(true); });
    it('and wraps the app in a Router, structurally', () => {
        expect(/<BrowserRouter>[\s\S]*<App \/>[\s\S]*<\/BrowserRouter>/.test(sc['src/main.tsx']),
            'a router the model has to remember is a router that goes missing').toBe(true);
    });
    it('and imports the stylesheet', () => { expect(sc['src/main.tsx'].includes("import './index.css'")).toBe(true); });
    it('tsconfig matches what the prompt pins', () => {
        expect(JSON.parse(sc['tsconfig.json']).compilerOptions.moduleResolution === 'bundler'
            && JSON.parse(sc['tsconfig.json']).compilerOptions.jsx === 'react-jsx').toBe(true);
    });
    it('the theme reaches the stylesheet', () => { expect(sc['src/index.css'].includes('--color-primary: #00aaff')).toBe(true); });
    it('and Tailwind is imported the way v4 needs', () => { expect(sc['src/index.css'].startsWith('@import "tailwindcss";')).toBe(true); });
    it('the title is the project, escaped', () => { expect(sc['index.html'].includes('<title>Tide Clock</title>')).toBe(true); });
    it('and the entry is a module script', () => { expect(sc['index.html'].includes('type="module" src="/src/main.tsx"')).toBe(true); });

    it('a hostile project name cannot break out of the title', () => {
        expect(!escaped['index.html'].includes('<script>&'), 'model output reaches this string').toBe(true);
    });

    it('bare specifiers are found', () => { expect(pkgs.includes('lucide-react') && pkgs.includes('clsx'), pkgs.join(', ')).toBe(true); });
    it('and relative imports are not packages', () => { expect(!pkgs.some(p => p.startsWith('.'))).toBe(true); });
    it('a subpath belongs to its package', () => { expect(pkgs.includes('react-dom'), pkgs.join(', ')).toBe(true); });

    it('the derived name is safe for npm', () => { expect(pkg.name, pkg.name).toBe('tide-clock'); });
    it('imports become dependencies', () => { expect('lucide-react' in pkg.dependencies && 'clsx' in pkg.dependencies).toBe(true); });
    it('node builtins do not', () => { expect(!('node:path' in pkg.dependencies) && !('node' in pkg.dependencies)).toBe(true); });
    it('build tools stay in devDependencies', () => {
        expect(!('vite' in pkg.dependencies) && 'vite' in pkg.devDependencies).toBe(true);
    });
    it('react is present even if nothing imported it directly', () => { expect('react' in pkg.dependencies).toBe(true); });

    it('scaffolded paths are never requested', () => {
        expect(!['index.html', 'tsconfig.json', 'src/main.tsx'].some(p => scaffoldRun.calls.includes(p)),
            `requested: ${scaffoldRun.calls.join(', ')}`).toBe(true);
    });
    it('only the real work is', () => {
        expect(scaffoldRun.calls.length === 1 && scaffoldRun.calls[0] === 'src/App.tsx', scaffoldRun.calls.join(', ')).toBe(true);
    });
    it('and the scaffold is in the result anyway', () => {
        expect(typeof scaffoldRun.result.record['index.html'] === 'string'
            && typeof scaffoldRun.result.record['tsconfig.json'] === 'string').toBe(true);
    });
    it("so nothing the manifest promised is missing", () => {
        expect(scaffoldRun.result.missing.length, JSON.stringify(scaffoldRun.result.missing)).toBe(0);
    });
});

// ── 10. Whose fault is a bundle failure? ─────────────────────────────────────
// The rule that decides what the lesson ladder is allowed to learn from a build that
// would not bundle. Bundled with esbuild and run under Node — the pattern AGENTS.md
// describes for the pure TS modules — because a rule that decides what a model gets
// taught must be checkable without a browser, a network or a model.
const bundled = await esbuild.build({
    entryPoints: ['services/previewVerdict.ts'],
    bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
});
const { attributeBundleErrors } = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

/* The rule these assertions encode was inverted, and the old version is worth stating
   because it looked right: "a package the project **declared** is the environment's
   problem, because a declared dependency awaits an `npm install` that is not ours."
   There is no later install — this preview is the only place a generated app runs — so
   that reasoning forgave the one signal saying the app could not start, `tsc` forgave it
   for the same reason, `validateBuild` never looked at bare imports at all, and the build
   shipped as "Passed all N file checks" above a preview rendering the failure.
   Attribution now gates on **availability**: is this package one the preview is supposed
   to have? */
const withDep = { 'package.json': JSON.stringify({ dependencies: { 'lucide-react': '^0.4.0' } }) };
const onTheList = attributeBundleErrors(
    [{ text: 'Could not resolve "lucide-react" — the package is not installed in this preview.', file: 'src/Footer.tsx' }],
    withDep);

/* The assertion that did not exist, and whose absence let a broken build be certified. */
const offTheList = attributeBundleErrors(
    [{ text: 'Could not resolve "chart.js" — the package is not installed in this preview.', file: 'src/Chart.tsx' }],
    withDep);

/* Declaring it changes nothing — that was the whole bug. */
const declaredButUnavailable = attributeBundleErrors(
    [{ text: 'Could not resolve "chart.js" — nope', file: 'a.tsx' }],
    { 'package.json': JSON.stringify({ dependencies: { 'chart.js': '^4' } }) });

/* Scope parsing still has to work, or `@scope/pkg/sub` would be read as `@scope` and the
   list check would miss. Proven by the code being `unresolved-import` rather than the
   `bundle-error` an unparsed message produces. */
const scoped = attributeBundleErrors(
    [{ text: 'Could not resolve "@tanstack/react-query/build" — nope', file: 'a.tsx' }], {});

const other = attributeBundleErrors([{ text: 'Unexpected "}" in src/App.tsx', file: 'src/App.tsx' }], withDep);

const noPkgJson = attributeBundleErrors(
    [{ text: 'Could not resolve "chart.js" — nope', file: 'a.tsx' }], {});

/* The two-step rule: a name on the list without an install recreates the original fault
   exactly, so the list and what is installed are asserted to agree. */
const { createRequire } = await import('node:module');
const requireHere = createRequire(new URL('../package.json', import.meta.url));
const notInstalled = [...PREVIEW_PACKAGES].filter((pkg) => {
    try { requireHere.resolve(pkg); return false; } catch { return true; }
});

/* The other half of the two-step rule: a version table that has drifted from the list
   silently pins the wrong thing, or pins nothing and falls back to `latest`. */
const optionalNames = Object.keys(OPTIONAL_PACKAGES).sort();
const versioned = Object.keys(KNOWN_VERSIONS_FOR_TEST).sort();

/* And the behaviour the whole section exists for: an import outside the list is left
   undeclared, so the bundler's failure reaches attribution as the model's fault rather
   than being laundered into "the environment's problem" by a package.json entry. */
const offListPkgJson = JSON.parse(packageJsonFor({
    plan: { projectName: 'Off List' },
    record: { 'src/App.tsx': "import Chart from 'chart.js';\nimport { Home } from 'lucide-react';\n" },
}));

describe('10. a bundle failure is attributed before it teaches anything', () => {
    /* Still the environment, but for a sound reason now: lucide-react is on the allowlist,
       so the preview is meant to resolve it and a failure is a local fault, not a lesson. */
    it('a package the preview is supposed to have is the environment', () => {
        expect(onTheList.length, JSON.stringify(onTheList)).toBe(0);
    });

    it('a package outside the allowlist is the model, even when declared', () => {
        expect(offTheList[0]?.code, JSON.stringify(offTheList)).toBe('unresolved-import');
    });
    it('and the file is named', () => { expect(offTheList[0]?.file).toBe('src/Chart.tsx'); });

    it('declaring an unavailable package does not launder it', () => {
        expect(declaredButUnavailable[0]?.code, JSON.stringify(declaredButUnavailable)).toBe('unresolved-import');
    });

    it('a scoped subpath is parsed as its scoped package', () => {
        expect(scoped[0]?.code, JSON.stringify(scoped)).toBe('unresolved-import');
    });
    it('and packageOf agrees', () => { expect(packageOf('@tanstack/react-query/build')).toBe('@tanstack/react-query'); });
    it('as does a plain subpath', () => { expect(packageOf('date-fns/format')).toBe('date-fns'); });

    it('a failure that names no package is a bundle-error', () => { expect(other[0]?.code, JSON.stringify(other)).toBe('bundle-error'); });

    it('a missing package.json does not crash the attribution', () => {
        expect(noPkgJson[0]?.code, JSON.stringify(noPkgJson)).toBe('unresolved-import');
    });

    it('every allowlisted package is actually installed', () => {
        expect(notInstalled.length, `not resolvable: ${notInstalled.join(', ')}`).toBe(0);
    });

    it('the version table covers exactly the optional allowlist', () => {
        expect(JSON.stringify(optionalNames), `list: ${optionalNames.join(',')}  versions: ${versioned.join(',')}`).toBe(JSON.stringify(versioned));
    });

    it('an off-list import is not declared', () => {
        expect(!('chart.js' in offListPkgJson.dependencies), JSON.stringify(offListPkgJson.dependencies)).toBe(true);
    });
    it('and an allowlisted one is, at a pinned version', () => {
        expect(offListPkgJson.dependencies['lucide-react']?.startsWith('^'), JSON.stringify(offListPkgJson.dependencies)).toBe(true);
    });
});

// ── 11. The plan is a contract, not a suggestion ─────────────────────────────
// Two checks sat either side of a gap and both reported success: `missingFrom`
// measures files against the *manifest*, so a page the manifest never listed was
// never promised; `validateBuild` measures files against the *plan* but only as a
// warning, after the build. A build could drop every approved page, report
// "missing: none", pass, and promote. Seen in the field as five plan-*-missing
// warnings on a build that was accepted.
const PLAN = {
    pages: [{ name: 'HomePage', description: 'the home page' }, { name: 'ArticlePage', description: 'one article' }],
    components: [{ name: 'Navbar', description: 'top nav' }],
};
const skimpy = [
    { path: 'index.html', purpose: 'shell', exports: [] },
    { path: 'src/main.tsx', purpose: 'mount', exports: [] },
    { path: 'src/App.tsx', purpose: 'routes', exports: ['default App'] },
    { path: 'src/pages/HomePage.tsx', purpose: 'home', exports: ['default HomePage'] },
];

const forgot = planCoverage(skimpy, PLAN);
const covered = coverPlan(skimpy, PLAN);

/* End to end: the restored entries must actually be requested. */
const restoredCalls = [];
const restoreProvider = {
    async generateJson() { return { object: { files: skimpy } }; },
    async *streamJson({ prompt }) {
        const path = /Write exactly one file: `([^`]+)`/.exec(prompt)?.[1];
        restoredCalls.push(path);
        yield { text: JSON.stringify({ path, content: 'export default () => null;' }) };
    },
};
const restoredRun = await generateFromManifest({
    models: ['stub'],
    run: async (m, a, s2) => { const r = await a(m[0]); s2?.(m[0]); return r; },
    getProvider: () => restoreProvider, systemFor: () => 'sys', basePromptFor: () => 'PLAN',
    emit: () => {}, schemas: { manifest: {}, file: {} },
    prefill: scaffoldFor({ plan: { projectName: 'X' }, theme: {} }),
    provided: ['package.json'],
    plan: PLAN,
});

describe('11. a manifest that forgot an approved page has it put back', () => {
    it('a dropped page and component are both found', () => {
        expect(forgot.length === 2 && forgot.some(f => f.name === 'ArticlePage') && forgot.some(f => f.name === 'Navbar'),
            forgot.map(f => `${f.kind} ${f.name}`).join(', ')).toBe(true);
    });

    it('they are appended rather than the run being thrown away', () => {
        expect(covered.length, 'the plan is authoritative; a model that forgot a page needs the page, not a re-roll').toBe(6);
    });
    it('a page lands under src/pages', () => { expect(covered.some(f => f.path === 'src/pages/ArticlePage.tsx')).toBe(true); });
    it('a component lands under src/components', () => { expect(covered.some(f => f.path === 'src/components/Navbar.tsx')).toBe(true); });
    it('and each carries the export contract the rest will import by', () => {
        expect(covered.find(f => f.path === 'src/pages/ArticlePage.tsx')?.exports[0]).toBe('default ArticlePage');
    });
    it("the plan's own description becomes the purpose", () => {
        expect(covered.find(f => f.path === 'src/components/Navbar.tsx')?.purpose).toBe('top nav');
    });
    it('nothing is left uncovered afterwards', () => { expect(planCoverage(covered, PLAN).length).toBe(0); });
    it('and a complete manifest is untouched', () => {
        expect(coverPlan(covered, PLAN).length, 'restoring must be a no-op when there is nothing to restore').toBe(covered.length);
    });
    it('no plan at all is not a gap', () => { expect(planCoverage(skimpy, null).length).toBe(0); });

    it('the page the manifest forgot is actually generated', () => {
        expect(restoredCalls.includes('src/pages/ArticlePage.tsx'), restoredCalls.join(', ')).toBe(true);
    });
    it('and App is told not to nest a second Router', () => {
        expect(/must \*\*not\*\*\s*\n?create a Router|do not add another Router/i.test(
            fileInstruction({ manifest: [{ path: 'src/App.tsx', purpose: 'routes', exports: ['default App'] }], path: 'src/App.tsx', purpose: 'routes', written: [] })),
            'main.tsx provides the Router now, so App nesting one would break routing').toBe(true);
    });
    it('and so is the component', () => { expect(restoredCalls.includes('src/components/Navbar.tsx')).toBe(true); });
    it('so the finished build has every page the plan promised', () => {
        expect(['HomePage', 'ArticlePage', 'Navbar'].every(n => Object.keys(restoredRun.record).some(p => p.includes(n))),
            Object.keys(restoredRun.record).join(', ')).toBe(true);
    });
});

// ── 12. Code stored as data ──────────────────────────────────────────────────
// From a real four-page build: a mock-data file held code snippets in template
// literals, one snippet contained a backtick and ${…}, and it ended the literal
// holding it. Seven TS1005 on one line, and esbuild refused the whole project.
const dataInstruction = fileInstruction({
    manifest: [{ path: 'src/data/mockData.ts', purpose: 'snippets', exports: ['snippets'] }],
    path: 'src/data/mockData.ts', purpose: 'snippets', written: [],
});
const syntaxLesson = proposalsFor({ ok: false, codes: { 'syntax-error': 1 } })[0]?.recommendation ?? '';

describe('12. the file request warns about code stored as data', () => {
    it('a file request says not to put code in a template literal', () => {
        expect(/template literal/i.test(dataInstruction), 'the failure that broke a real build').toBe(true);
    });
    it('and names the two characters that end one', () => {
        expect(/backtick/i.test(dataInstruction) && dataInstruction.includes('${')).toBe(true);
    });

    /* The lesson used to say "escape quotes inside JSX text", which is true and was not
       the cause. A lesson aimed at the wrong failure teaches the wrong habit. */
    it('and the lesson it would teach covers the same cause', () => {
        expect(/template literal/i.test(syntaxLesson) && /backtick/i.test(syntaxLesson), syntaxLesson.slice(-90)).toBe(true);
    });
});

describe('13. the aesthetic directive reaches the prompt, in the right dialect', () => {
    it('no config changes nothing', () => { expect(buildAestheticDirective(undefined, 'google')).toBe(''); });
    it('an empty object changes nothing either', () => { expect(buildAestheticDirective({}, 'google')).toBe(''); });

    const editorial = buildAestheticDirective({ typography: 'editorial' }, 'google');
    it('a chosen option puts its directive in the prompt', () => {
        expect(editorial.includes(AESTHETIC_DIMENSIONS.typography.options.editorial.directive)).toBe(true);
    });
    it('and an option not chosen is absent', () => {
        expect(!editorial.includes(AESTHETIC_DIMENSIONS.typography.options.bold.directive)).toBe(true);
    });

    const claude = buildAestheticDirective({ typography: 'editorial' }, 'anthropic');
    it('Claude gets it wrapped in XML tags', () => {
        expect(claude.includes('<aesthetic_directive>') && claude.includes('</aesthetic_directive>')).toBe(true);
    });
    it('and Gemini does not', () => { expect(!editorial.includes('<aesthetic_directive>')).toBe(true); });

    it('OpenAI gets a markdown header instead', () => {
        expect(buildAestheticDirective({ motion: 'rich' }, 'openai').includes('### Design directive')).toBe(true);
    });
    it('and Gemini does not get markdown headers', () => {
        expect(!buildAestheticDirective({ motion: 'rich' }, 'google').includes('###')).toBe(true);
    });

    it('the open-model dialect is a numbered plain list', () => {
        const nvidia = buildAestheticDirective({ background: 'glass', motion: 'subtle' }, 'nvidia');
        expect(/^\d+\.\s/m.test(nvidia) && !nvidia.includes('<') && !nvidia.includes('#')).toBe(true);
    });

    it('an unrecognised option value is silently ignored, not thrown', () => {
        expect(buildAestheticDirective({ typography: 'baroque' }, 'google')).toBe('');
    });

    const both = buildAestheticDirective({ antiSlop: true, selfReflection: true }, 'google');
    it('anti-slop is included when asked for', () => { expect(/Bootstrap/i.test(both)).toBe(true); });
    it('and the self-reflection rubric is included alongside it', () => { expect(/score your own output/i.test(both)).toBe(true); });
    it('neither appears unasked', () => { expect(buildAestheticDirective({}, 'google')).toBe(''); });

    it('all three real dimensions can combine in one request', () => {
        const combined = buildAestheticDirective({ typography: 'bold', motion: 'rich', background: 'gradient' }, 'anthropic');
        expect(['bold', 'rich', 'gradient'].every((v, i) => {
            const dim = ['typography', 'motion', 'background'][i];
            return combined.includes(AESTHETIC_DIMENSIONS[dim].options[v].directive);
        })).toBe(true);
    });
});

describe('14. entities are frozen, not guessed', () => {
    const ENTITIES = [
        { name: 'PhotoItem', fields: [{ name: 'location', type: 'string' }, { name: 'year', type: 'number' }] },
        { name: 'ServicePackage', fields: [{ name: 'name', type: 'string' }, { name: 'features', type: 'string[]' }] },
    ];
    const types = typesFileFor(ENTITIES);

    it('entities produce a types file', () => { expect(typeof types === 'string' && types.length > 0).toBe(true); });
    it('every entity becomes an interface', () => {
        expect(types.includes('export interface PhotoItem {') && types.includes('export interface ServicePackage {')).toBe(true);
    });
    it('every field is declared with its type', () => {
        expect(types.includes('location: string;') && types.includes('features: string[];')).toBe(true);
    });
    it('and it is deterministic — same input, same output', () => { expect(typesFileFor(ENTITIES)).toBe(types); });
    it('no entities produces nothing to write', () => { expect(typesFileFor([]) === null && typesFileFor(undefined) === null).toBe(true); });
    it('an entity with no name is skipped rather than crashing', () => {
        expect(typesFileFor([{ fields: [{ name: 'x', type: 'string' }] }])).toBeNull();
    });

    const scaffoldWithEntities = scaffoldFor({ plan: { projectName: 'x', entities: ENTITIES }, theme: {} });
    it('scaffoldFor writes src/types.ts when the plan has entities', () => {
        expect(typeof scaffoldWithEntities['src/types.ts']).toBe('string');
    });
    const scaffoldWithout = scaffoldFor({ plan: { projectName: 'x' }, theme: {} });
    it('and writes nothing when it does not', () => { expect(!('src/types.ts' in scaffoldWithout)).toBe(true); });

    it('the manifest instruction mentions src/types.ts when entities exist', () => {
        expect(manifestInstruction({ hasEntities: true }).includes('src/types.ts')).toBe(true);
    });
    it('and says nothing about it when they do not', () => {
        expect(!manifestInstruction({ hasEntities: false }).includes('src/types.ts')).toBe(true);
    });
    it('and the default (no argument) behaves like no entities', () => {
        expect(!manifestInstruction().includes('src/types.ts')).toBe(true);
    });

    const sharedTypesContent = 'export interface PhotoItem {\n    location: string;\n}\n';
    const withTypes = fileInstruction({
        manifest: [{ path: 'src/App.tsx', purpose: 'root', exports: ['default App'] }],
        path: 'src/App.tsx', purpose: 'root', written: ['src/types.ts'], sharedTypes: sharedTypesContent,
    });
    it('fileInstruction includes the literal shared-types content when given one', () => {
        expect(withTypes.includes(sharedTypesContent), 'a file must see the exact shape, not just that a file called src/types.ts exists').toBe(true);
    });
    const withoutTypes = fileInstruction({
        manifest: [{ path: 'src/App.tsx', purpose: 'root', exports: ['default App'] }],
        path: 'src/App.tsx', purpose: 'root', written: [],
    });
    it('and includes nothing extra when there is none', () => { expect(!withoutTypes.includes('shared types')).toBe(true); });
});

describe('15. effort is raised where a mechanism now covers the risk it was hedging', () => {
    it('the manifest step now asks for medium effort', () => {
        expect(happy.calls.manifestEfforts.length > 0 && happy.calls.manifestEfforts.every((e) => e === 'medium'),
            JSON.stringify(happy.calls.manifestEfforts)).toBe(true);
    });
    it('every per-file request asks for high effort', () => {
        expect(happy.calls.fileEfforts.length > 0 && happy.calls.fileEfforts.every((e) => e === 'high'),
            JSON.stringify(happy.calls.fileEfforts)).toBe(true);
    });
    it('every repair request asks for high effort too', () => {
        expect(repairEfforts.length > 0 && repairEfforts.every((e) => e === 'high'), JSON.stringify(repairEfforts)).toBe(true);
    });
});

describe('16. the generate prompt puts static content before the per-build plan', () => {
    const orderedPrompt = generatePromptFor({
        plan: { projectName: 'Harbour', acceptanceCriteria: ['Works on a phone in daylight'] },
        paletteSpec: 'bg #111', typeSpec: 'font-sans',
    });
    const stackRulesAt = orderedPrompt.indexOf('**Stack rules:**');
    const allowlistAt = orderedPrompt.indexOf('you may import');
    const planAt = orderedPrompt.indexOf("**This build's plan:**");

    it('the stack rules appear before the plan', () => {
        expect(stackRulesAt !== -1 && planAt !== -1 && stackRulesAt < planAt, `stack rules @${stackRulesAt}, plan @${planAt}`).toBe(true);
    });
    it('the allowlist instruction appears before the plan too', () => {
        expect(allowlistAt !== -1 && allowlistAt < planAt, `allowlist @${allowlistAt}, plan @${planAt}`).toBe(true);
    });
    it('acceptance criteria appear after the plan, not before the stack rules', () => {
        expect(orderedPrompt.indexOf('MUST satisfy') > stackRulesAt).toBe(true);
    });
    it('palette and typography — the actual per-build content — trail everything static', () => {
        expect(orderedPrompt.indexOf('bg #111') > planAt).toBe(true);
    });
});

describe('17. the acceptance-criteria self-check is a labelled gap, not a gate', () => {
    it('a satisfied criterion produces no issue', () => {
        const allSatisfied = acceptanceIssuesFrom([
            { criterion: 'The chart updates without a reload', satisfied: true, evidence: 'useEffect polls every 30s' },
        ]);
        expect(allSatisfied.length, JSON.stringify(allSatisfied)).toBe(0);
    });

    const oneUnmet = acceptanceIssuesFrom([
        { criterion: 'The chart updates without a reload', satisfied: true, evidence: 'fine' },
        { criterion: 'Works on a phone in daylight', satisfied: false, evidence: 'No contrast check anywhere in the code' },
    ]);
    it('an unsatisfied one produces exactly one warning', () => { expect(oneUnmet.length, JSON.stringify(oneUnmet)).toBe(1); });
    it('always a warning, never an error — a self-report cannot gate promotion', () => { expect(oneUnmet[0].severity).toBe('warning'); });
    it('names the criterion', () => { expect(oneUnmet[0].message.includes('Works on a phone in daylight')).toBe(true); });
    it('and says plainly it is self-reported, not verified', () => {
        expect(/self-reported/i.test(oneUnmet[0].message) && /not independently verified/i.test(oneUnmet[0].message)).toBe(true);
    });
    it("carries the model's own evidence", () => { expect(oneUnmet[0].message.includes('No contrast check')).toBe(true); });

    it('malformed results produce nothing rather than throwing', () => {
        expect(acceptanceIssuesFrom(null).length === 0 && acceptanceIssuesFrom(undefined).length === 0
            && acceptanceIssuesFrom('not an array').length === 0).toBe(true);
    });
    it('a result missing its criterion is dropped rather than reported as "undefined"', () => {
        expect(acceptanceIssuesFrom([{ satisfied: false }]).length).toBe(0);
    });

    it('acceptance-criterion-unmet is a declared exclusion from the ladder, not an oversight', () => {
        expect('acceptance-criterion-unmet' in NOT_A_LESSON).toBe(true);
    });
    it('so unmappedCodes never flags it', () => { expect(unmappedCodes({ 'acceptance-criterion-unmet': 1 }).length).toBe(0); });

    it('and it can never add a proposal alongside a real failure — the defendant does not also grade its own homework', () => {
        const withAcceptance = proposalsFor({ ok: false, codes: { 'type-error': 1, 'acceptance-criterion-unmet': 1 } });
        const withoutAcceptance = proposalsFor({ ok: false, codes: { 'type-error': 1 } });
        expect(withAcceptance.length, `${withAcceptance.length} vs ${withoutAcceptance.length}`).toBe(withoutAcceptance.length);
    });
});

// `patchFile`'s exact-and-unique contract and the runPython queue-split logic
// (`splitAtApprovalGate`) live in colocated `utils/patchFile.test.ts` and
// `utils/toolSequence.test.ts` — both are genuinely standalone pure modules,
// unlike this file, which spans providers/, memory/ and typecheck/ together.
describe('18. project context renders live signals and origin only when present, independently', () => {
    it('a project with none of the new fields renders no file tree, diagnostics, preview or origin section', () => {
        const bareProject = { name: 'Harbour' };
        const bareContext = buildSystemPrompt({ provider: 'anthropic', persona: {}, projects: [bareProject], customStyles: [] });
        expect(!bareContext.includes('Files in this project') && !bareContext.includes('type-check diagnostics')
            && !bareContext.includes('preview verdict') && !bareContext.includes('built from a plan'),
            'bare project leaked a section it should not have').toBe(true);
    });

    it('a file tree renders on its own, with no diagnostics/preview/origin alongside it', () => {
        const fileTreeOnly = buildSystemPrompt({
            provider: 'anthropic', persona: {}, customStyles: [],
            projects: [{ name: 'Harbour', fileTree: ['src/App.tsx', 'src/main.tsx'] }],
        });
        expect(fileTreeOnly.includes('src/App.tsx') && !fileTreeOnly.includes('type-check diagnostics')
            && !fileTreeOnly.includes('preview verdict') && !fileTreeOnly.includes('built from a plan')).toBe(true);
    });

    it('a diagnostics summary renders on its own', () => {
        const diagnosticsOnly = buildSystemPrompt({
            provider: 'anthropic', persona: {}, customStyles: [],
            projects: [{ name: 'Harbour', diagnosticsSummary: 'src/App.tsx:3:1 — TS2307: Cannot find module' }],
        });
        expect(diagnosticsOnly.includes('Cannot find module') && !diagnosticsOnly.includes('Files in this project')
            && !diagnosticsOnly.includes('preview verdict')).toBe(true);
    });

    it('a preview verdict renders on its own', () => {
        const previewOnly = buildSystemPrompt({
            provider: 'anthropic', persona: {}, customStyles: [],
            projects: [{ name: 'Harbour', previewSummary: 'Builds and runs without error.' }],
        });
        expect(previewOnly.includes('Builds and runs without error.') && !previewOnly.includes('Files in this project')
            && !previewOnly.includes('type-check diagnostics')).toBe(true);
    });

    it('an origin.plan renders what the project was built to be, including its acceptance criteria', () => {
        const originOnly = buildSystemPrompt({
            provider: 'anthropic', persona: {}, customStyles: [],
            projects: [{ name: 'Harbour', origin: { plan: { projectName: 'Harbour', projectDescription: 'A tide tracker' }, acceptanceCriteria: ['Shows the next high tide'] } }],
        });
        expect(originOnly.includes('built from a plan') && originOnly.includes('A tide tracker') && originOnly.includes('Shows the next high tide')
            && !originOnly.includes('Files in this project')).toBe(true);
    });

    it('an origin with no plan renders nothing — half an origin is not rendered as if whole', () => {
        const noOriginPlan = buildSystemPrompt({
            provider: 'anthropic', persona: {}, customStyles: [],
            projects: [{ name: 'Harbour', origin: { plan: null, acceptanceCriteria: [] } }],
        });
        expect(!noOriginPlan.includes('built from a plan')).toBe(true);
    });
});
