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
 *   npm run check:generate
 */
import * as esbuild from 'esbuild';
import { PREVIEW_PACKAGES, packageOf, OPTIONAL_PACKAGES } from '../providers/allowlist.js';
import { Buffer } from 'node:buffer';
import { salvageFiles, isTruncation } from '../providers/salvage.js';
import { toBuildIssues } from '../typecheck/parse.js';
import { proposalsFor, unmappedCodes, PROPOSAL_TABLE, NOT_A_LESSON } from '../memory/proposals.js';
import { normaliseManifest, manifestGaps, missingFrom, manifestInstruction, fileInstruction, generateFromManifest, filesNeedingRepair, importedPaths, repairInstruction, repairRound, planCoverage, coverPlan } from '../providers/generate.js';
import { scaffoldFor, packageJsonFor, importedPackages, SCAFFOLD_PATHS, KNOWN_VERSIONS as KNOWN_VERSIONS_FOR_TEST } from '../providers/scaffold.js';
import { AESTHETIC_DIMENSIONS, buildAestheticDirective } from '../providers/aesthetic.js';

let failures = 0;
const ok = (label, cond, detail = '') => {
    console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failures++;
};

const file = (path, content) => JSON.stringify({ path, content });

// ── 1. What survived the cut ──────────────────────────────────────────────────
console.log('\n1. a truncated response still contains finished files');

const TRUNCATED =
    '{"files":[' +
    file('package.json', '{"name":"harbour"}') + ',' +
    file('src/App.tsx', 'export default function App() {\n  return <main>harbour</main>;\n}') + ',' +
    '{"path":"src/Broken.tsx","content":"export const B = () => {\\n  const s = \\"unterm';

const cut = salvageFiles(TRUNCATED);
ok('the complete files are recovered', cut.files.length === 2, cut.files.map(f => f.path).join(', '));
ok('and their content is intact, not clipped',
    cut.files[1]?.content.endsWith('}'), JSON.stringify(cut.files[1]?.content?.slice(-24)));
ok('and the half-written one is dropped',
    !cut.files.some(f => f.path === 'src/Broken.tsx'));
ok('and it reports that it rescued something', cut.salvaged === true);

/* The walk has to be string-aware. Source code is mostly braces, so a naive depth
   counter ends at the first `}` inside a file's content — which is immediately. */
const BRACEY = '{"files":[' + file('x.ts', 'function f() { return { a: [1, 2] }; }') + ',{"path":"cut';
const bracey = salvageFiles(BRACEY);
ok('braces inside file content do not end the walk early',
    bracey.files.length === 1 && bracey.files[0].content.endsWith('}'), bracey.files[0]?.content);

const WHOLE = JSON.stringify({ files: [{ path: 'a.ts', content: 'export const a = 1;' }] });
const whole = salvageFiles(WHOLE);
ok('a complete response parses without salvage', whole.files.length === 1 && whole.salvaged === false,
    `salvaged=${whole.salvaged}`);
ok('genuine garbage salvages nothing', salvageFiles('not json at all').files.length === 0);
ok('and neither does an empty response', salvageFiles('').files.length === 0);

console.log('\n2. every provider says "I ran out of room" in its own word');
for (const [reason, expected] of [['MAX_TOKENS', true], ['max_tokens', true], ['length', true],
                                  ['max_output_tokens', true], ['STOP', false], ['tool_calls', false],
                                  [undefined, false], [null, false]]) {
    ok(`${String(reason)} → ${expected}`, isTruncation(reason) === expected);
}

// ── 3. The right lesson for the right failure ─────────────────────────────────
console.log('\n3. a syntax error is not a type error');

const SYNTAX_DIAGS = [
    { path: 'src/data/storage.ts', line: 91, col: 138, severity: 'error', code: 'TS1002', message: 'Unterminated string literal.' },
    { path: 'src/components/NewsletterForm.tsx', line: 19, col: 6, severity: 'error', code: 'TS17008', message: "JSX element 'div' has no corresponding closing tag." },
];
const SEMANTIC_DIAGS = [
    { path: 'src/App.tsx', line: 4, col: 24, severity: 'error', code: 'TS2322', message: "Type 'string' is not assignable to type 'number'." },
];

const syntaxCodes = toBuildIssues(SYNTAX_DIAGS).map(i => i.code);
const semanticCodes = toBuildIssues(SEMANTIC_DIAGS).map(i => i.code);
/* This is the exact mis-lesson observed: a wall of TS1002 proposed "annotate props
   and state", which has nothing to do with a file that was cut in half. */
ok('TS1002 and TS17008 are syntax-error', syntaxCodes.every(c => c === 'syntax-error'), syntaxCodes.join(', '));
ok('TS2322 is still type-error', semanticCodes.every(c => c === 'type-error'), semanticCodes.join(', '));

const syntaxProposals = proposalsFor({ ok: false, codes: { 'syntax-error': 2 } });
ok('and a syntax failure proposes syntax guidance', syntaxProposals[0]?.code === 'syntax-error');
ok('which is advice about closing and escaping, not about typing',
    /escape|close|terminate/i.test(syntaxProposals[0]?.recommendation ?? ''),
    syntaxProposals[0]?.recommendation?.slice(0, 70));

// ── 4. The guard, proved against its own absence ──────────────────────────────
console.log('\n4. an instrument failure proposes nothing');

/* The codes a truncated build actually produced, from the real run. */
const WRECKAGE = { 'syntax-error': 6, 'unbalanced-braces': 1, 'missing-index-html': 1, 'type-error': 2 };

/* Never assert that something was absent without first proving it would otherwise
   have been present — or "the guard works" and "the table is empty" look identical. */
const conclusive = proposalsFor({ ok: false, checked: 4, codes: WRECKAGE });
ok('the same verdict DOES propose when the run completed', conclusive.length > 0,
    conclusive.map(p => p.code).join(', '));

const inconclusive = proposalsFor({ ok: false, checked: 4, codes: WRECKAGE, inconclusive: true });
ok('and proposes nothing at all once marked inconclusive', inconclusive.length === 0,
    inconclusive.map(p => p.code).join(', '));
ok('so the false lesson from the real run cannot recur',
    !inconclusive.some(p => /index\.html/.test(p.recommendation ?? '')),
    'a model that was cut off before writing index.html did not forget index.html');

// ── 5. The table still answers for every code ─────────────────────────────────
console.log('\n5. the table has an answer for every code it can be asked about');
const allCodes = Object.fromEntries(
    [...Object.keys(PROPOSAL_TABLE), ...Object.keys(NOT_A_LESSON)].map(c => [c, 1]),
);
ok('no code is unmapped', unmappedCodes(allCodes).length === 0, JSON.stringify(unmappedCodes(allCodes)));
ok('a passing verdict still teaches nothing', proposalsFor({ ok: true, codes: {} }).length === 0);

// ── 6. The manifest is what puts the ceiling out of reach ─────────────────────
console.log('\n6. the manifest makes the build bounded and resumable');

const raw = [
    { path: './index.html', purpose: 'entry' },
    { path: 'index.html', purpose: 'duplicate' },
    { path: 'src/main.tsx', purpose: 'mount' },
    { path: '', purpose: 'nameless' },
    { path: 'src/App.tsx', purpose: 'routes' },
    { path: 'package.json', purpose: 'deps' },
];
const clean = normaliseManifest(raw);
ok('a leading ./ is not a different file', clean.filter(f => f.path === 'index.html').length === 1,
    clean.map(f => f.path).join(', '));
ok('entries with no path are dropped', !clean.some(f => f.path === ''));
ok('order is preserved', clean[0].path === 'index.html' && clean[1].path === 'src/main.tsx');
ok('a runaway manifest is capped', normaliseManifest(
    Array.from({ length: 500 }, (_, i) => ({ path: `src/f${i}.ts`, purpose: 'x' })),
).length === 60, 'spending 500 requests to discover a runaway is the wrong time to find out');

/* Checked before any file is generated: N requests against a manifest that was never
   going to produce a runnable app is the expensive way to learn it cannot. */
ok('a manifest that cannot run is rejected up front',
    manifestGaps([{ path: 'src/App.tsx' }, { path: 'src/index.css' }]).includes('index.html'),
    JSON.stringify(manifestGaps([{ path: 'src/App.tsx' }])));
ok('and a complete one passes', manifestGaps(clean).length === 0, JSON.stringify(manifestGaps(clean)));
ok('src/main.jsx satisfies the entry requirement too',
    manifestGaps([{ path: 'index.html' }, { path: 'package.json' }, { path: 'src/main.jsx' }, { path: 'src/App.tsx' }]).length === 0);

/* The set difference is the resume list. Under the single-shot shape a stopped build
   was simply lost; here what is absent is computable. */
const promised = [{ path: 'index.html' }, { path: 'src/App.tsx' }, { path: 'src/pages/Home.tsx' }];
const got = { 'index.html': '<!doctype html>', 'src/App.tsx': 'export default () => null;', 'src/pages/Home.tsx': '   ' };
ok('a manifest entry with no file is missing', missingFrom(promised, got).includes('src/pages/Home.tsx'),
    JSON.stringify(missingFrom(promised, got)));
ok('and a whitespace-only file counts as missing too', missingFrom(promised, got).length === 1);
ok('a complete project is missing nothing',
    missingFrom(promised, { ...got, 'src/pages/Home.tsx': 'export default () => null;' }).length === 0);

ok('the manifest request forbids code', /no code/i.test(manifestInstruction()));
ok('and asks for the export contract, not just paths', /exports/i.test(manifestInstruction()),
    'paths agreeing was never the failure — names were');

/* Measured on a real 16-file build: every path resolved and tsc still found 28 errors,
   because `types/tide.ts` exported `CoastalStation` while `Header.tsx` imported
   `Station`, and `App.tsx` default-imported a named export. The manifest carries the
   contract now for exactly that reason. */
const contract = normaliseManifest([
    { path: 'src/types/tide.ts', purpose: 'types', exports: ['CoastalStation', 'TideEvent'] },
    { path: 'src/components/Header.tsx', purpose: 'nav', exports: ['default Header'] },
    { path: 'src/index.css', purpose: 'styles', exports: [] },
]);
ok('normalisation keeps the exports', contract[0].exports.length === 2, JSON.stringify(contract[0]));
ok('and tolerates an entry that exports nothing', Array.isArray(contract[2].exports) && contract[2].exports.length === 0);

const withContract = fileInstruction({ manifest: contract, path: 'src/components/Header.tsx', purpose: 'nav', written: [] });
ok('every manifest line names what it exports', withContract.includes('exports: CoastalStation, TideEvent'),
    'a file cannot import a name it was never told about');
ok('a file that exports nothing says so', withContract.includes('exports nothing'));
ok('and the request is held to the contract', /Honour the manifest's export contract/.test(withContract));

const instruction = fileInstruction({
    manifest: [{ path: 'src/types.ts', purpose: 'shared types' }, { path: 'src/App.tsx', purpose: 'routes' }],
    path: 'src/App.tsx', purpose: 'routes', written: ['src/types.ts'],
});
/* Files are written by separate requests that never see each other's output, so the
   manifest travelling with each one is the only thing keeping imports agreeing. */
ok('each file request carries the whole manifest', instruction.includes('src/types.ts') && instruction.includes('shared types'));
ok('and names exactly the file it wants', instruction.includes('Write exactly one file: `src/App.tsx`'));
ok('and says what already exists to import from', /Already written[^]*src\/types\.ts/.test(instruction));

// ── 7. The whole run, driven by a stub ───────────────────────────────────────
// The branches that matter most here are the ones that occur least: a manifest that
// cannot produce a runnable app, and a single file cut short. Neither can be reached
// on demand with a real model, which is why the orchestration takes its dependencies
// as arguments — so this can reach both without one.
console.log('\n7. the orchestration, without a model');

const PATH_RE = /Write exactly one file: `([^`]+)`/;

const stub = ({ manifest, content = () => 'export const x = 1;', truncate = [] }) => {
    const calls = { manifest: 0, files: [] };
    const provider = {
        async generateJson() { calls.manifest++; return { object: { files: manifest } }; },
        async *streamJson({ prompt }) {
            const path = PATH_RE.exec(prompt)?.[1];
            calls.files.push(path);
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

const drive = async ({ manifest, truncate = [], content }) => {
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
ok('every manifest entry is requested once',
    happy.calls.files.length === 4 && new Set(happy.calls.files).size === 4, happy.calls.files.join(', '));
ok('and every one lands in the result', Object.keys(happy.result.record).length === 4,
    Object.keys(happy.result.record).join(', '));
ok('so nothing is missing', happy.result.missing.length === 0, JSON.stringify(happy.result.missing));
ok('the manifest is announced before any file is written',
    happy.emitted.findIndex(e => e.manifest) < happy.emitted.findIndex(e => e.file),
    JSON.stringify(happy.emitted.slice(0, 3)));

const cutRun = await drive({ manifest: GOOD_MANIFEST, truncate: ['src/App.tsx'] });
ok('one truncated file does not take the others with it',
    Object.keys(cutRun.result.record).length === 3, Object.keys(cutRun.result.record).join(', '));
ok('the cut file is named as truncated', cutRun.result.truncatedFiles.includes('src/App.tsx'),
    JSON.stringify(cutRun.result.truncatedFiles));
ok('and it is missing rather than half-written',
    cutRun.result.missing.includes('src/App.tsx') && cutRun.result.record['src/App.tsx'] === undefined,
    'a file cut mid-string must never be stored as content');

/* The expensive mistake this guards: N file requests against a manifest that could
   never produce a runnable app. Assert the requests were not made. */
const doomed = await drive({ manifest: [{ path: 'src/App.tsx', purpose: 'routes' }, { path: 'src/index.css', purpose: 'style' }, { path: 'README.md', purpose: 'docs' }] });
ok('a manifest with no entry point is refused', Boolean(doomed.result.unusable), JSON.stringify(doomed.result).slice(0, 90));
ok('and not one file request is spent on it', doomed.calls.files.length === 0,
    `${doomed.calls.files.length} request(s) were made against a manifest that cannot run`);

// ── 8. The repair pass ───────────────────────────────────────────────────────
// The export contract killed the import-name failures and revealed the next layer:
// files agreeing on names and disagreeing on shapes. No manifest fixes that without
// carrying the code, so the compiler's own diagnostics drive a correction instead.
console.log('\n8. a compiler names the broken files, and only those are re-requested');

const DIAGS = [
    { path: 'src/TideCard.tsx', line: 22, col: 9, code: 'TS2339', message: "Property 'height' does not exist on type 'TideEntry'." },
    { path: 'src/TideCard.tsx', line: 30, col: 4, code: 'TS2339', message: "Property 'height' does not exist on type 'TideEntry'." },
    { path: 'src/App.tsx', line: 20, col: 6, code: 'TS2322', message: "Type '{ x: string; }' is not assignable." },
];
const grouped = filesNeedingRepair(DIAGS);
ok('diagnostics group by file', grouped.length === 2, grouped.map(g => g.path).join(', '));
ok('and the most-broken file comes first', grouped[0].path === 'src/TideCard.tsx',
    'a file with two errors is likelier the cause than the one with one that consumes it');
ok('repair is capped', filesNeedingRepair(
    Array.from({ length: 40 }, (_, i) => ({ path: `f${i}.ts`, line: 1, col: 1, code: 'TS1', message: 'x' })),
).length === 10, 'an unbounded repair burns quota to reach the same answer slowly');

const REC = {
    'src/types.ts': 'export interface TideEntry { time: string; }',
    'src/TideCard.tsx': "import { TideEntry } from './types';\nexport const C = (e: TideEntry) => e.height;",
};
ok('a file\'s imports are resolved against what exists',
    importedPaths(REC['src/TideCard.tsx'], 'src/TideCard.tsx', REC).includes('src/types.ts'));

const fix = repairInstruction({
    manifest: [{ path: 'src/TideCard.tsx', purpose: 'one tide', exports: ['C'] }],
    path: 'src/TideCard.tsx', purpose: 'one tide',
    content: REC['src/TideCard.tsx'], diagnostics: grouped[0].diagnostics,
    sources: [{ path: 'src/types.ts', content: REC['src/types.ts'] }],
});
ok('the repair carries the compiler\'s own words', fix.includes("Property 'height' does not exist"));
/* The whole reason repair beats re-prompting: a shape mismatch is unfixable from a
   description, and readable from the source. */
ok('and the real source of what it imports', fix.includes('export interface TideEntry { time: string; }'),
    'a shape disagreement cannot be fixed from a description of the file');
ok('and holds it to its export contract', fix.includes('export exactly: C'));

/* Only the named files cost a request. */
const repairCalls = [];
const repairProvider = {
    async *streamJson({ prompt }) {
        const path = /Fix one file: `([^`]+)`/.exec(prompt)?.[1];
        repairCalls.push(path);
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
ok('only the blamed file is re-requested', repairCalls.length === 1 && repairCalls[0] === 'src/TideCard.tsx',
    repairCalls.join(', '));
ok('the fix replaces it in the record', record['src/TideCard.tsx'].includes('=> null'));
ok('and a file nobody blamed is untouched', record['src/Untouched.tsx'] === 'export const U = 1;',
    'repair must not rewrite working code');
ok('the repaired file is reported', round.repaired.includes('src/TideCard.tsx'), JSON.stringify(round.repaired));

// ── 9. The files nobody should pay a model to retype ─────────────────────────
// The generate prompt dictates tsconfig's compilerOptions verbatim, pins package.json
// versions, mandates @tailwindcss/vite and `@import "tailwindcss"`. There is no
// judgement left in any of it — and these are the files where a mistake is least
// recoverable, since a wrong tsconfig breaks every file after it.
console.log('\n9. the scaffold is written, not requested');

const sc = scaffoldFor({ plan: { projectName: 'Tide Clock' }, theme: { colors: { bg: '#001122', primary: '#00aaff' } } });
ok('five files are written outright', Object.keys(sc).length === 5, Object.keys(sc).join(', '));
/* The one that came from a broken build rather than from reasoning: main.tsx mounted
   <App /> with no Router while App.tsx used Routes and useLocation. tsc passed, esbuild
   passed, and the app threw on first render and drew nothing. */
ok('the entry mounts the root', sc['src/main.tsx'].includes("document.getElementById('root')"));
ok('and wraps the app in a Router, structurally',
    /<BrowserRouter>[\s\S]*<App \/>[\s\S]*<\/BrowserRouter>/.test(sc['src/main.tsx']),
    'a router the model has to remember is a router that goes missing');
ok('and imports the stylesheet', sc['src/main.tsx'].includes("import './index.css'"));
ok('tsconfig matches what the prompt pins',
    JSON.parse(sc['tsconfig.json']).compilerOptions.moduleResolution === 'bundler'
    && JSON.parse(sc['tsconfig.json']).compilerOptions.jsx === 'react-jsx');
ok('the theme reaches the stylesheet', sc['src/index.css'].includes('--color-primary: #00aaff'));
ok('and Tailwind is imported the way v4 needs', sc['src/index.css'].startsWith('@import "tailwindcss";'));
ok('the title is the project, escaped', sc['index.html'].includes('<title>Tide Clock</title>'));
ok('and the entry is a module script', sc['index.html'].includes('type="module" src="/src/main.tsx"'));

const escaped = scaffoldFor({ plan: { projectName: 'A <script> & "quote"' }, theme: {} });
ok('a hostile project name cannot break out of the title',
    !escaped['index.html'].includes('<script>&'), 'model output reaches this string');

/* package.json is derived from the imports the code actually contains. A list a model
   writes can disagree with the code it wrote; a list read from the code cannot. */
const src = {
    'src/App.tsx': "import { Menu } from 'lucide-react';\nimport clsx from 'clsx';\nimport { x } from './local';",
    'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport path from 'node:path';",
};
const pkgs = importedPackages(src);
ok('bare specifiers are found', pkgs.includes('lucide-react') && pkgs.includes('clsx'), pkgs.join(', '));
ok('and relative imports are not packages', !pkgs.some(p => p.startsWith('.')));
ok('a subpath belongs to its package', pkgs.includes('react-dom'), pkgs.join(', '));

const pkg = JSON.parse(packageJsonFor({ plan: { projectName: 'Tide Clock' }, record: src }));
ok('the derived name is safe for npm', pkg.name === 'tide-clock', pkg.name);
ok('imports become dependencies', 'lucide-react' in pkg.dependencies && 'clsx' in pkg.dependencies);
ok('node builtins do not', !('node:path' in pkg.dependencies) && !('node' in pkg.dependencies));
ok('build tools stay in devDependencies',
    !('vite' in pkg.dependencies) && 'vite' in pkg.devDependencies);
ok('react is present even if nothing imported it directly', 'react' in pkg.dependencies);

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
ok('scaffolded paths are never requested',
    !['index.html', 'tsconfig.json', 'src/main.tsx'].some(p => scaffoldRun.calls.includes(p)),
    `requested: ${scaffoldRun.calls.join(', ')}`);
ok('only the real work is', scaffoldRun.calls.length === 1 && scaffoldRun.calls[0] === 'src/App.tsx',
    scaffoldRun.calls.join(', '));
ok('and the scaffold is in the result anyway',
    typeof scaffoldRun.result.record['index.html'] === 'string'
    && typeof scaffoldRun.result.record['tsconfig.json'] === 'string');
ok('so nothing the manifest promised is missing', scaffoldRun.result.missing.length === 0,
    JSON.stringify(scaffoldRun.result.missing));

// ── 10. Whose fault is a bundle failure? ─────────────────────────────────────
// The rule that decides what the lesson ladder is allowed to learn from a build that
// would not bundle. Bundled with esbuild and run under Node — the pattern AGENTS.md
// describes for the pure TS modules — because a rule that decides what a model gets
// taught must be checkable without a browser, a network or a model.
console.log('\n10. a bundle failure is attributed before it teaches anything');

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
/* Still the environment, but for a sound reason now: lucide-react is on the allowlist,
   so the preview is meant to resolve it and a failure is a local fault, not a lesson. */
ok('a package the preview is supposed to have is the environment', onTheList.length === 0,
    JSON.stringify(onTheList));

/* The assertion that did not exist, and whose absence let a broken build be certified. */
const offTheList = attributeBundleErrors(
    [{ text: 'Could not resolve "chart.js" — the package is not installed in this preview.', file: 'src/Chart.tsx' }],
    withDep);
ok('a package outside the allowlist is the model, even when declared',
    offTheList[0]?.code === 'unresolved-import', JSON.stringify(offTheList));
ok('and the file is named', offTheList[0]?.file === 'src/Chart.tsx');

/* Declaring it changes nothing — that was the whole bug. */
const declaredButUnavailable = attributeBundleErrors(
    [{ text: 'Could not resolve "chart.js" — nope', file: 'a.tsx' }],
    { 'package.json': JSON.stringify({ dependencies: { 'chart.js': '^4' } }) });
ok('declaring an unavailable package does not launder it',
    declaredButUnavailable[0]?.code === 'unresolved-import', JSON.stringify(declaredButUnavailable));

/* Scope parsing still has to work, or `@scope/pkg/sub` would be read as `@scope` and the
   list check would miss. Proven by the code being `unresolved-import` rather than the
   `bundle-error` an unparsed message produces. */
const scoped = attributeBundleErrors(
    [{ text: 'Could not resolve "@tanstack/react-query/build" — nope', file: 'a.tsx' }], {});
ok('a scoped subpath is parsed as its scoped package', scoped[0]?.code === 'unresolved-import',
    JSON.stringify(scoped));
ok('and packageOf agrees', packageOf('@tanstack/react-query/build') === '@tanstack/react-query');
ok('as does a plain subpath', packageOf('date-fns/format') === 'date-fns');

const other = attributeBundleErrors([{ text: 'Unexpected "}" in src/App.tsx', file: 'src/App.tsx' }], withDep);
ok('a failure that names no package is a bundle-error', other[0]?.code === 'bundle-error', JSON.stringify(other));

const noPkgJson = attributeBundleErrors(
    [{ text: 'Could not resolve "chart.js" — nope', file: 'a.tsx' }], {});
ok('a missing package.json does not crash the attribution',
    noPkgJson[0]?.code === 'unresolved-import', JSON.stringify(noPkgJson));

/* The two-step rule: a name on the list without an install recreates the original fault
   exactly, so the list and what is installed are asserted to agree. */
const { createRequire } = await import('node:module');
const requireHere = createRequire(new URL('../package.json', import.meta.url));
const notInstalled = [...PREVIEW_PACKAGES].filter((pkg) => {
    try { requireHere.resolve(pkg); return false; } catch { return true; }
});
ok('every allowlisted package is actually installed', notInstalled.length === 0,
    `not resolvable: ${notInstalled.join(', ')}`);

/* The other half of the two-step rule: a version table that has drifted from the list
   silently pins the wrong thing, or pins nothing and falls back to `latest`. */
const optionalNames = Object.keys(OPTIONAL_PACKAGES).sort();
const versioned = Object.keys(KNOWN_VERSIONS_FOR_TEST).sort();
ok('the version table covers exactly the optional allowlist',
    JSON.stringify(optionalNames) === JSON.stringify(versioned),
    `list: ${optionalNames.join(',')}  versions: ${versioned.join(',')}`);

/* And the behaviour the whole section exists for: an import outside the list is left
   undeclared, so the bundler's failure reaches attribution as the model's fault rather
   than being laundered into "the environment's problem" by a package.json entry. */
const offListPkgJson = JSON.parse(packageJsonFor({
    plan: { projectName: 'Off List' },
    record: { 'src/App.tsx': "import Chart from 'chart.js';\nimport { Home } from 'lucide-react';\n" },
}));
ok('an off-list import is not declared', !('chart.js' in offListPkgJson.dependencies),
    JSON.stringify(offListPkgJson.dependencies));
ok('and an allowlisted one is, at a pinned version',
    offListPkgJson.dependencies['lucide-react']?.startsWith('^'),
    JSON.stringify(offListPkgJson.dependencies));

// ── 11. The plan is a contract, not a suggestion ─────────────────────────────
// Two checks sat either side of a gap and both reported success: `missingFrom`
// measures files against the *manifest*, so a page the manifest never listed was
// never promised; `validateBuild` measures files against the *plan* but only as a
// warning, after the build. A build could drop every approved page, report
// "missing: none", pass, and promote. Seen in the field as five plan-*-missing
// warnings on a build that was accepted.
console.log('\n11. a manifest that forgot an approved page has it put back');

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
ok('a dropped page and component are both found',
    forgot.length === 2 && forgot.some(f => f.name === 'ArticlePage') && forgot.some(f => f.name === 'Navbar'),
    forgot.map(f => `${f.kind} ${f.name}`).join(', '));

const covered = coverPlan(skimpy, PLAN);
ok('they are appended rather than the run being thrown away', covered.length === 6,
    'the plan is authoritative; a model that forgot a page needs the page, not a re-roll');
ok('a page lands under src/pages', covered.some(f => f.path === 'src/pages/ArticlePage.tsx'));
ok('a component lands under src/components', covered.some(f => f.path === 'src/components/Navbar.tsx'));
ok('and each carries the export contract the rest will import by',
    covered.find(f => f.path === 'src/pages/ArticlePage.tsx')?.exports[0] === 'default ArticlePage');
ok('the plan\'s own description becomes the purpose',
    covered.find(f => f.path === 'src/components/Navbar.tsx')?.purpose === 'top nav');
ok('nothing is left uncovered afterwards', planCoverage(covered, PLAN).length === 0);
ok('and a complete manifest is untouched', coverPlan(covered, PLAN).length === covered.length,
    'restoring must be a no-op when there is nothing to restore');
ok('no plan at all is not a gap', planCoverage(skimpy, null).length === 0);

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
ok('the page the manifest forgot is actually generated',
    restoredCalls.includes('src/pages/ArticlePage.tsx'), restoredCalls.join(', '));
ok('and App is told not to nest a second Router',
    /must \*\*not\*\*\s*\n?create a Router|do not add another Router/i.test(
        fileInstruction({ manifest: [{ path: 'src/App.tsx', purpose: 'routes', exports: ['default App'] }], path: 'src/App.tsx', purpose: 'routes', written: [] })),
    'main.tsx provides the Router now, so App nesting one would break routing');
ok('and so is the component', restoredCalls.includes('src/components/Navbar.tsx'));
ok('so the finished build has every page the plan promised',
    ['HomePage', 'ArticlePage', 'Navbar'].every(n => Object.keys(restoredRun.record).some(p => p.includes(n))),
    Object.keys(restoredRun.record).join(', '));

// ── 12. Code stored as data ──────────────────────────────────────────────────
// From a real four-page build: a mock-data file held code snippets in template
// literals, one snippet contained a backtick and ${…}, and it ended the literal
// holding it. Seven TS1005 on one line, and esbuild refused the whole project.
console.log('\n12. the file request warns about code stored as data');

const dataInstruction = fileInstruction({
    manifest: [{ path: 'src/data/mockData.ts', purpose: 'snippets', exports: ['snippets'] }],
    path: 'src/data/mockData.ts', purpose: 'snippets', written: [],
});
ok('a file request says not to put code in a template literal',
    /template literal/i.test(dataInstruction), 'the failure that broke a real build');
ok('and names the two characters that end one', /backtick/i.test(dataInstruction) && dataInstruction.includes('${'));

const syntaxLesson = proposalsFor({ ok: false, codes: { 'syntax-error': 1 } })[0]?.recommendation ?? '';
/* The lesson used to say "escape quotes inside JSX text", which is true and was not
   the cause. A lesson aimed at the wrong failure teaches the wrong habit. */
ok('and the lesson it would teach covers the same cause',
    /template literal/i.test(syntaxLesson) && /backtick/i.test(syntaxLesson),
    syntaxLesson.slice(-90));

// ---------------------------------------------------------------------------
console.log('\n13. the aesthetic directive reaches the prompt, in the right dialect');

ok('no config changes nothing', buildAestheticDirective(undefined, 'google') === '');
ok('an empty object changes nothing either', buildAestheticDirective({}, 'google') === '');

const editorial = buildAestheticDirective({ typography: 'editorial' }, 'google');
ok('a chosen option puts its directive in the prompt',
    editorial.includes(AESTHETIC_DIMENSIONS.typography.options.editorial.directive));
ok('and an option not chosen is absent',
    !editorial.includes(AESTHETIC_DIMENSIONS.typography.options.bold.directive));

const claude = buildAestheticDirective({ typography: 'editorial' }, 'anthropic');
ok('Claude gets it wrapped in XML tags', claude.includes('<aesthetic_directive>') && claude.includes('</aesthetic_directive>'));
ok('and Gemini does not', !editorial.includes('<aesthetic_directive>'));

const openai = buildAestheticDirective({ motion: 'rich' }, 'openai');
ok('OpenAI gets a markdown header instead', openai.includes('### Design directive'));
ok('and Gemini does not get markdown headers',
    !buildAestheticDirective({ motion: 'rich' }, 'google').includes('###'));

const nvidia = buildAestheticDirective({ background: 'glass', motion: 'subtle' }, 'nvidia');
ok('the open-model dialect is a numbered plain list', /^\d+\.\s/m.test(nvidia) && !nvidia.includes('<') && !nvidia.includes('#'));

ok('an unrecognised option value is silently ignored, not thrown',
    buildAestheticDirective({ typography: 'baroque' }, 'google') === '');

const both = buildAestheticDirective({ antiSlop: true, selfReflection: true }, 'google');
ok('anti-slop is included when asked for', /Bootstrap/i.test(both));
ok('and the self-reflection rubric is included alongside it', /score your own output/i.test(both));
ok('neither appears unasked', buildAestheticDirective({}, 'google') === '');

const combined = buildAestheticDirective({ typography: 'bold', motion: 'rich', background: 'gradient' }, 'anthropic');
ok('all three real dimensions can combine in one request',
    ['bold', 'rich', 'gradient'].every((v, i) => {
        const dim = ['typography', 'motion', 'background'][i];
        return combined.includes(AESTHETIC_DIMENSIONS[dim].options[v].directive);
    }));

console.log(failures === 0 ? '\ngenerate ok' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
