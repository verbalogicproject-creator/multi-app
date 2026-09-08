#!/usr/bin/env node
/**
 * Guards what the browser fetches before it can show anything.
 *
 * Two facts about the built output are load-bearing and neither is visible in source:
 *
 *   1. jszip is not in the eager path. It is ~95K of archive machinery needed by one
 *      click at the end of the wizard, and it sat in the bundle every visitor fetched
 *      because `utils/export.ts` imported it at module scope and `context/AppContext.tsx`
 *      imports that. Restoring a static import would be a one-word change, would look
 *      harmless in review, and would silently put it back.
 *
 *   2. React is in its own chunk. Not to save bytes — the totals are identical — but so
 *      that shipping application code does not invalidate ~560K of framework in every
 *      returning visitor's cache. Dropping `manualChunks` merges them again, and nothing
 *      about the app would appear to break.
 *
 * Both regressions are invisible: the app works, every other gate passes, and the only
 * symptom is a slower first paint for people who are not you. So they are asserted here,
 * against the real build output, by name.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIR = 'dist/assets';
let failures = 0;
const ok = (label, condition, detail = '') => {
    const line = detail ? `${label} — ${detail}` : label;
    if (condition) { console.log(`  ok    ${line}`); }
    else { console.error(`  FAIL  ${line}`); failures++; }
};

const html = readFileSync('dist/index.html', 'utf8');
const assets = readdirSync(DIR).filter(f => f.endsWith('.js'));

/** Chunks index.html pulls before the app can render — src= and modulepreload href=. */
const eager = assets.filter(f => html.includes(f));
ok('index.html references at least one chunk', eager.length > 0, `${eager.length} eager`);

// Structural, not textual. Searching the eager chunk for "jszip" matches the dynamic
// import's own chunk filename sitting there as a specifier — which is what correct
// laziness looks like, so that test fails on success. What actually distinguishes the
// two states is whether a separate chunk exists at all: a static import inlines jszip
// into the eager bundle and no jszip-*.js is emitted.
const lazyJszip = assets.filter(f => /^jszip/i.test(f));
ok('jszip is a separate lazy chunk', lazyJszip.length === 1,
   lazyJszip[0] ?? 'no jszip chunk emitted — a static import in utils/export.ts inlines it');

const vendor = assets.filter(f => f.startsWith('react-vendor'));
ok('react has its own chunk', vendor.length === 1, vendor[0] ?? 'no react-vendor-*.js emitted');

const gz = eager.reduce((n, f) => n + gzipSync(readFileSync(join(DIR, f)), { level: 9 }).length, 0);
const BUDGET = 130 * 1024;
ok('eager payload stays under budget', gz <= BUDGET,
   `${(gz / 1024).toFixed(0)}K gzip vs ${BUDGET / 1024}K budget`);

if (failures > 0) { console.error(`\n${failures} bundle check(s) failed.`); process.exit(2); }
console.log(`bundle ok — ${eager.length} eager chunk(s), ${(gz / 1024).toFixed(0)}K gzip`);
