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
import { salvageFiles, isTruncation } from '../providers/salvage.js';
import { toBuildIssues } from '../typecheck/parse.js';
import { proposalsFor, unmappedCodes, PROPOSAL_TABLE, NOT_A_LESSON } from '../memory/proposals.js';

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

console.log(failures === 0 ? '\ngenerate ok' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
