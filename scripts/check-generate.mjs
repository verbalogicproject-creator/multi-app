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
import { Buffer } from 'node:buffer';
import { salvageFiles, isTruncation } from '../providers/salvage.js';
import { toBuildIssues } from '../typecheck/parse.js';
import { proposalsFor, unmappedCodes, PROPOSAL_TABLE, NOT_A_LESSON } from '../memory/proposals.js';
import { normaliseManifest, manifestGaps, missingFrom, manifestInstruction, fileInstruction, generateFromManifest, filesNeedingRepair, importedPaths, repairInstruction, repairRound } from '../providers/generate.js';
import { scaffoldFor, packageJsonFor, importedPackages, SCAFFOLD_PATHS } from '../providers/scaffold.js';

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
        basePrompt: 'PLAN',
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
ok('four files are written outright', Object.keys(sc).length === 4, Object.keys(sc).join(', '));
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
        getProvider: () => provider, systemFor: () => 'sys', basePrompt: 'PLAN',
        emit: () => {}, schemas: { manifest: {}, file: {} },
        prefill: scaffoldFor({ plan: { projectName: 'X' }, theme: {} }),
        provided: ['package.json'],
    });
    return { calls, result };
})();
ok('scaffolded paths are never requested',
    !scaffoldRun.calls.includes('index.html') && !scaffoldRun.calls.includes('tsconfig.json'),
    `requested: ${scaffoldRun.calls.join(', ')}`);
ok('only the real work is', scaffoldRun.calls.length === 2, scaffoldRun.calls.join(', '));
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

const withDep = { 'package.json': JSON.stringify({ dependencies: { 'lucide-react': '^0.4.0' } }) };
const declaredMissing = attributeBundleErrors(
    [{ text: 'Could not resolve "lucide-react" — the package is not installed in this preview.', file: 'src/Footer.tsx' }],
    withDep);
/* Observed on a real build: the model declared lucide-react correctly and our preview
   simply does not have it. Teaching from that would tell the model to stop using
   dependencies it declared properly. */
ok('a package the project declared is the environment, not the model', declaredMissing.length === 0,
    JSON.stringify(declaredMissing));

const undeclared = attributeBundleErrors(
    [{ text: 'Could not resolve "chart.js" — the package is not installed in this preview.', file: 'src/Chart.tsx' }],
    withDep);
ok('a package it never declared is the model', undeclared[0]?.code === 'unresolved-import',
    JSON.stringify(undeclared));
ok('and the file is named', undeclared[0]?.file === 'src/Chart.tsx');

const scoped = attributeBundleErrors(
    [{ text: 'Could not resolve "@tanstack/react-query/build" — nope', file: 'a.tsx' }],
    { 'package.json': JSON.stringify({ dependencies: { '@tanstack/react-query': '^5' } }) });
ok('a scoped subpath belongs to its scoped package', scoped.length === 0, JSON.stringify(scoped));

const other = attributeBundleErrors([{ text: 'Unexpected "}" in src/App.tsx', file: 'src/App.tsx' }], withDep);
ok('a failure that names no package is a bundle-error', other[0]?.code === 'bundle-error', JSON.stringify(other));

const noPkgJson = attributeBundleErrors(
    [{ text: 'Could not resolve "react" — nope', file: 'a.tsx' }], {});
ok('an unparseable package.json blames the model rather than crashing',
    noPkgJson[0]?.code === 'unresolved-import', JSON.stringify(noPkgJson));

console.log(failures === 0 ? '\ngenerate ok' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
