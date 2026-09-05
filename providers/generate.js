/**
 * Generating a project one file at a time, against a manifest it declared first.
 *
 * The whole-app-in-one-response shape had a ceiling that was routinely reached:
 * `maxOutputTokens: 65536` shared with thinking, measured at ~54k output tokens per
 * call on real builds. Past it the response stops mid-string and everything after the
 * cut never existed.
 *
 * Splitting the work moves the bound. A manifest — paths and one-line purposes — is a
 * couple of thousand tokens whatever the app's size. Each file afterwards is bounded by
 * that one file. Neither request can approach the ceiling, so it stops being a failure
 * mode rather than one we recover from.
 *
 * It buys two other things that the single-shot shape could not have:
 *
 *   - **Resumability.** The manifest says what should exist, so what is missing is a set
 *     difference rather than a guess. A run stopped by quota resumes from the gap.
 *   - **Per-file attribution.** A file that fails to parse is one file, named. Under the
 *     old shape a single bad file discarded every good one.
 *
 * Pure and dependency-free: prompts in, strings out. The orchestration lives in
 * `server.js` where the provider fallback and the memory journal already are.
 */

import { allowlistInstruction } from './allowlist.js';

/** Files a Vite + React + TS project cannot run without, whatever the model lists. */
export const MANIFEST_FLOOR = ['index.html', 'package.json', 'src/main.tsx', 'src/App.tsx'];

/**
 * The `/api/builder/generate` prompt — static content first, the per-build plan last.
 *
 * This is the prefix of every manifest, per-file and repair request in one generation
 * run (`basePromptFor` in `server.js`), so it is sent whole and unchanged ten to twenty
 * times over a single build. Gemini's implicit prefix caching (2.5+) matches the
 * longest shared prefix across requests; the longer the byte-identical block at the
 * front, the more of that repetition is free instead of paid. The stack rules, the
 * allowlist instruction and the design contract's fixed sub-rules never vary between
 * builds at all, so they lead. The plan, acceptance criteria, palette and typography
 * are the one thing that changes per build, so they trail, immediately before the
 * manifest/file-specific instruction `server.js` appends after this string.
 *
 * Extracted from `server.js` as its own pure function for exactly one reason: the
 * prompt is server-internal, sent to Gemini and never back to a client, so nothing
 * short of importing this function directly can check that the ordering actually
 * holds. `check:generate` asserts the stack rules appear before the plan JSON by
 * string index — a revert of the reorder fails by name instead of silently costing
 * whatever the reorder was for.
 */
export const generatePromptFor = ({ plan, paletteSpec, typeSpec }) => `You are a senior product engineer and designer. Generate the complete, production-quality code for a web application from the plan and theme given at the end of this prompt. The result must look like a designed product, not a template.

**Design contract (mandatory):**
- Type scale: one hero-size heading per page (text-4xl/5xl), section headings text-2xl, body text-base, captions text-sm. Never more than three sizes on one screen.
- Spacing rhythm: sections py-16 to py-24, cards p-6, consistent gap-4/gap-6 grids. Align everything to one max-w-6xl mx-auto px-4 container.
- Components must have hover and focus-visible states, and disabled states where relevant.
- Realistic, domain-specific content everywhere: real-sounding names, numbers, dates and copy that fit the project's purpose. NEVER use "Lorem ipsum", "TODO", "placeholder", or empty stub components.
- No external images. Where an image would go, use a styled div with a gradient or an inline SVG.

**Stack rules:**
1. Vite + React 19 + TypeScript, standard layout: index.html, src/main.tsx, src/App.tsx, src/index.css, src/pages/*, src/components/*.
2. Routing with react-router-dom v6 (Routes in src/App.tsx, shared layout with nav + footer).
3. Styling with Tailwind CSS v4: src/index.css starts with '@import "tailwindcss";' and vite.config.ts uses the @tailwindcss/vite plugin. Do NOT emit tailwind.config.js or postcss.config.js.
4. package.json with correct dependencies and pinned major versions (react ^19, react-dom ^19, react-router-dom ^6, tailwindcss ^4, @tailwindcss/vite ^4, vite ^5, @vitejs/plugin-react ^4, typescript ^5) and scripts: "dev": "vite", "build": "vite build", "typecheck": "tsc --noEmit", "preview": "vite preview".
5. tsconfig.json compilerOptions must be exactly: { "target": "ES2020", "lib": ["ES2020", "DOM", "DOM.Iterable"], "module": "ESNext", "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true, "esModuleInterop": true, "skipLibCheck": true, "noEmit": true } with "include": ["src"].
6. Code must compile under strict TypeScript: every function parameter, callback parameter and prop is explicitly typed — no implicit any. With jsx react-jsx, do not import React just for JSX; import only the hooks you use.
7. Every file must be complete and syntactically valid. Interactive features (forms, filters, toggles) must actually work.
8. ${allowlistInstruction()}

**Before you finish**, verify every relative import you wrote resolves to a file you also emitted, and that every package you imported is on the list in rule 8. Escape quotes inside JSX text (setQuote("I can't do this"), never setQuote('I can't do this')) — unescaped quotes are a build failure.

**Response format:** a single JSON object of the form {"files":[{"path":"...","content":"..."}, ...]} listing every file. No markdown, no commentary.

**This build's plan:**
${JSON.stringify(plan, null, 2)}
${Array.isArray(plan?.acceptanceCriteria) && plan.acceptanceCriteria.length > 0
    ? `\n**Acceptance criteria — the generated app MUST satisfy every one of these:**\n${plan.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`
    : ''}
**This build's palette and typography (the rest of the design contract above still applies):**
- Palette: ${paletteSpec}
- Typography: ${typeSpec}`;

/**
 * Turns the acceptance-criteria self-check's raw results into `BuildIssue`s.
 *
 * Only unsatisfied criteria become an issue — a satisfied one is not news, the same
 * convention every other validator in this pipeline follows (`plan-page-missing`
 * fires on a missing page, never a confirmation of a present one). Pure, so the rule
 * that decides what a person sees is checkable without a model, even though the
 * judgment feeding it never can be. See `server.js`'s `/api/builder/check-acceptance`
 * and `HARNESS.md` for why the result is always `severity: 'warning'`.
 */
export const acceptanceIssuesFrom = (results) =>
    (Array.isArray(results) ? results : [])
        .filter((r) => r?.satisfied === false && typeof r.criterion === 'string')
        .map((r) => ({
            severity: 'warning',
            code: 'acceptance-criterion-unmet',
            message: `"${r.criterion}" — ${typeof r.evidence === 'string' && r.evidence ? r.evidence : 'not satisfied'} (self-reported by the model that wrote the code, not independently verified).`,
        }));

/**
 * Ask for the shape of the project before any of its content.
 *
 * Deliberately forbids code: the moment a manifest starts carrying implementations it
 * is the single-shot response again, with the same ceiling.
 */
export const manifestInstruction = ({ hasEntities = false } = {}) => `

**This request is the file manifest only — no code.**

List every file the project needs, each with a one-line purpose and **the exact names it
exports**. The export list is a contract every other file will be held to, so name each
export precisely and mark a default export as \`default Name\`. Config, CSS and HTML files
export nothing. Include the config and entry files (index.html,
package.json, tsconfig.json, vite.config.ts, src/main.tsx, src/index.css), every page and
component from the plan, and any context, hook, type or data module the app requires.

Still list \`index.html\`, \`package.json\`, \`tsconfig.json\`, \`vite.config.ts\`,
\`src/index.css\` and \`src/main.tsx\`${hasEntities ? ', and `src/types.ts`,' : ''} so the
other files can rely on them — but they are written for you from the plan${hasEntities ? "'s entities" : ''} and the
theme, so give them a one-line purpose and no exports and spend no thought on their
contents.${hasEntities ? '\n\n**`src/types.ts` already declares every shared data shape the plan named.** Do not redeclare `interface`s for them anywhere else — import from `./types` (or the correct relative path) instead.' : ''}

**\`src/main.tsx\` already mounts the app and already wraps it in a \`<BrowserRouter>\`.**
\`src/App.tsx\` must therefore contain \`<Routes>\` and \`<Route>\` directly and must **not**
create a Router of its own — a second one nested inside the first breaks routing.

Order the list so that a file appears after anything it imports — types and data first,
then components, then pages, then App and main. Do not write any file contents here; the
files are requested individually afterwards.`;

/**
 * Ask for exactly one file, with enough of the plan to keep it consistent with the rest.
 *
 * The manifest goes in whole. It is what keeps import paths agreeing across files that
 * were written by separate requests which never saw each other's output — the one real
 * risk this shape introduces, and the cheapest possible guard against it.
 */
export const fileInstruction = ({ manifest, path, purpose, written, sharedTypes }) => {
    /* Each entry carries its exports, because the manifest's job is the contract, not
       the file tree. Paths agreeing was never the failure; names were. */
    const listing = manifest.map(f => {
        const exports = Array.isArray(f.exports) && f.exports.length > 0
            ? ` — exports: ${f.exports.join(', ')}`
            : ' — exports nothing';
        return `- ${f.path} — ${f.purpose}${exports}`;
    }).join('\n');
    const done = written.length > 0
        ? `\n\nAlready written, and safe to import from: ${written.join(', ')}.`
        : '';
    /* The manifest names `src/types.ts` and its exports, same as any other file — but
       exports are names, not shapes, which is exactly the gap that let six files
       invent six different versions of the same interface. Its literal content is
       included here, not merely its existence, because "safe to import from" told a
       file a shape was available without ever telling it what the shape *was*. */
    const types = sharedTypes
        ? `\n\n**The shared types this project already declared — use these exact shapes, do not invent your own:**\n\n\`\`\`typescript\n${sharedTypes}\`\`\``
        : '';
    return `

**Write exactly one file: \`${path}\`.**

Its purpose: ${purpose}

The complete project manifest, so your imports match the files that will exist:
${listing}${done}${types}

Return only that one file's full contents. It must be complete and syntactically valid on
its own — every brace, bracket and JSX tag closed, every string terminated.

**If this file is \`src/App.tsx\`**, it is rendered inside a \`<BrowserRouter>\` that
\`src/main.tsx\` already provides. Use \`<Routes>\`/\`<Route>\` and router hooks directly;
do not add another Router.

**If this file stores code as data** — snippets, examples, documentation — do not put it in
a template literal. A snippet containing a backtick or \`\${\` terminates the literal that
holds it and breaks the file. Use a normal double-quoted string with \`\\n\` for newlines,
or escape every backtick and \`\${\` in the content.

**Honour the manifest's export contract exactly.** Export precisely the names the manifest
lists for this file — \`default X\` means \`export default\`, anything else is a named export.
Import only names another file's manifest entry actually lists, from paths in the manifest
above or from packages in package.json. Do not invent, rename or re-spell an export.`;
};

/**
 * What the manifest promised and the result does not have.
 *
 * The set difference is the resume list, and it is also the honest answer to "did this
 * build finish": a manifest entry with no file is a gap, whatever the reason.
 */
export const missingFrom = (manifest, record) =>
    manifest
        .map(entry => entry.path)
        .filter(path => typeof record?.[path] !== 'string' || record[path].trim() === '');

/**
 * A manifest is usable if it names the files an app cannot run without.
 *
 * Checked before any file is generated, because spending N requests against a manifest
 * that was never going to produce a runnable app is the expensive way to find out.
 */
export const manifestGaps = (manifest, alreadyHave = []) => {
    const paths = new Set([...(manifest ?? []).map(entry => entry?.path), ...alreadyHave]);
    const hasMain = [...paths].some(p => /^src\/main\.(tsx|ts|jsx|js)$/.test(p));
    return MANIFEST_FLOOR.filter(required =>
        required === 'src/main.tsx' ? !hasMain : !paths.has(required));
};

/**
 * Which of the plan's pages and components the manifest forgot.
 *
 * The plan is what the user approved. The manifest is what the model proposed. Until
 * this existed nothing compared them, and the two checks either side of the gap both
 * reported success: `missingFrom` measures files against the *manifest*, so a page the
 * manifest never listed was never promised and never missing, and `validateBuild`
 * measures files against the *plan* but only as a warning, after the whole build.
 *
 * A build could therefore omit every page the user approved, report "missing: none",
 * pass validation, and be promoted. Observed in the field as five
 * `plan-page-missing` warnings on a build that was accepted.
 *
 * Matched on the component name appearing in a path, which is how `validateBuild`
 * decides the same question — the two must agree or one of them is lying.
 */
export const planCoverage = (manifest, plan) => {
    const paths = (manifest ?? []).map(entry => entry?.path ?? '').join('\n');
    const wanted = [
        ...(Array.isArray(plan?.pages) ? plan.pages : []).map(p => ({ kind: 'page', name: p?.name })),
        ...(Array.isArray(plan?.components) ? plan.components : []).map(c => ({ kind: 'component', name: c?.name })),
    ];
    return wanted.filter(w => typeof w.name === 'string' && w.name && !paths.includes(w.name));
};

/**
 * Put back what the manifest dropped.
 *
 * Appending rather than rejecting, because the plan is authoritative and the manifest
 * is a proposal: a model that forgot a page does not need the whole run thrown away,
 * it needs the page. The entry carries the same shape the model would have written, so
 * everything downstream — the file request, the export contract, the coverage check —
 * treats it identically.
 */
export const coverPlan = (manifest, plan) => {
    const missing = planCoverage(manifest, plan);
    if (missing.length === 0) return manifest;
    const describe = (kind, name) => (Array.isArray(plan?.[kind === 'page' ? 'pages' : 'components'])
        ? plan[kind === 'page' ? 'pages' : 'components'].find(x => x?.name === name)?.description
        : '') || `The ${name} ${kind} from the approved plan.`;
    return [
        ...manifest,
        ...missing.map(({ kind, name }) => ({
            path: kind === 'page' ? `src/pages/${name}.tsx` : `src/components/${name}.tsx`,
            purpose: describe(kind, name),
            exports: [`default ${name}`],
        })),
    ];
};

/**
 * Normalise what the model called a manifest into what the orchestrator can use.
 *
 * Drops entries with no usable path, de-duplicates by path keeping the first, and caps
 * the count — a manifest of two hundred files is a runaway, not a project, and finding
 * that out after two hundred requests is the wrong time.
 */
export const normaliseManifest = (files, max = 60) => {
    const seen = new Set();
    const out = [];
    for (const entry of Array.isArray(files) ? files : []) {
        const path = typeof entry?.path === 'string' ? entry.path.replace(/^\.?\//, '').trim() : '';
        if (!path || seen.has(path)) continue;
        seen.add(path);
        out.push({
            path,
            purpose: typeof entry?.purpose === 'string' ? entry.purpose : '',
            exports: Array.isArray(entry?.exports) ? entry.exports.filter(e => typeof e === 'string') : [],
        });
        if (out.length >= max) break;
    }
    return out;
};

/**
 * The manifest run, orchestrated.
 *
 * Every dependency is injected — the model chain, the fallback runner, the provider
 * lookup, the emit sink — for one reason: the route this replaces could only be
 * exercised by calling a real model, so the code path that decides whether a build
 * succeeded was itself unverifiable. A stub provider can now drive the whole thing,
 * including the failure branches that matter most and occur least.
 *
 * Returns `null` when the manifest is unusable, which is the caller's signal to fall
 * back to the whole-app path rather than spend N requests on a project that was never
 * going to run.
 */
export const generateFromManifest = async ({
    models, run, getProvider, systemFor, basePromptFor, recalled = '', trialled = '',
    emit, schemas, concurrency = 3, onServed, prefill = {}, provided = [], plan = null,
}) => {
    const sharedTypes = prefill['src/types.ts'];
    let manifest = null;
    try {
        const { object } = await run(models, async (model) => {
            emit({ phase: 'planning', model });
            return getProvider(model).generateJson({
                model,
                system: systemFor(model),
                prompt: basePromptFor(model) + manifestInstruction({ hasEntities: Boolean(sharedTypes) }) + recalled + trialled,
                schema: schemas.manifest,
                /* Raised from 'low': the manifest now also has to cross-reference
                   entities correctly, and every model here supports 'medium' at no
                   extra cost against the daily request quota — effort spends latency,
                   not requests. See HARNESS.md. */
                effort: 'medium',
                maxOutputTokens: 8192,
            });
        }, onServed);
        /* The plan is a contract, not a suggestion. A manifest that forgot a page the
           user approved gets the page put back, before a single request is spent. */
        const proposed = normaliseManifest(object?.files);
        const uncovered = planCoverage(proposed, plan);
        if (uncovered.length > 0) {
            emit({ planRestored: uncovered.map(u => u.name) });
        }
        const candidate = coverPlan(proposed, plan);
        /* `prefill` is written before generation; `provided` is guaranteed by the
           caller afterwards — `package.json` is derived from the finished imports, so
           it cannot be prefilled and must not count as a gap either. */
        const gaps = manifestGaps(candidate, [...Object.keys(prefill), ...provided]);
        if (candidate.length >= 3 && gaps.length === 0) manifest = candidate;
        else return { unusable: `${candidate.length} files, missing ${gaps.join(', ') || 'nothing'}` };
    } catch (error) {
        return { unusable: error.message };
    }

    emit({ manifest: manifest.map(f => f.path) });

    /* The scaffold goes in before anything is requested, and its paths leave the
       queue. These files are dictated by the prompt itself — generating them buys
       nothing and can go wrong in ways nothing downstream recovers from. */
    const record = { ...prefill };
    const scaffolded = Object.keys(prefill);
    for (const path of scaffolded) emit({ file: path, scaffolded: true });

    const truncatedFiles = [];
    let bytes = 0;
    const queue = manifest.filter(entry => !(entry.path in record));

    const writeOne = async (entry) => {
        const written = Object.keys(record);
        const result = await run(models, async (model) => {
            const provider = getProvider(model);
            let acc = '';
            let usage = null;
            let finishReason = null;
            for await (const event of provider.streamJson({
                model,
                system: systemFor(model),
                prompt: basePromptFor(model) + fileInstruction({ manifest, path: entry.path, purpose: entry.purpose, written, sharedTypes }) + recalled + trialled,
                schema: schemas.file,
                /* Raised from 'medium'. Bounded at 16,384 tokens per file — nowhere
                   near the 65,536-token ceiling the whole-app fallback shares with
                   thinking, so there is no truncation risk this trades against, and
                   correctly applying a frozen shape is exactly the kind of task more
                   thinking helps with. See HARNESS.md. */
                effort: 'high',
                maxOutputTokens: 16384,
            })) {
                if (event.usage) usage = event.usage;
                if (event.finishReason) finishReason = event.finishReason;
                if (event.text) acc += event.text;
            }
            let content = null;
            try {
                const parsed = JSON.parse(acc);
                if (typeof parsed?.content === 'string') content = parsed.content;
            } catch { /* truncated or malformed; reported, never guessed at */ }
            return { content, truncated: isTruncationReason(finishReason), bytes: acc.length, usage };
        }, onServed);

        bytes += result.bytes;
        if (typeof result.content === 'string' && result.content.trim() !== '') {
            record[entry.path] = result.content;
            emit({ file: entry.path });
        } else if (result.truncated) {
            truncatedFiles.push(entry.path);
        }
        emit({ progress: bytes });
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length > 0) {
            const entry = queue.shift();
            try { await writeOne(entry); }
            catch (error) { emit({ failed: entry.path, reason: String(error?.message ?? error).slice(0, 120) }); }
        }
    }));

    return {
        manifest, record, missing: missingFrom(manifest, record), truncatedFiles, bytes,
        scaffolded, requested: manifest.length - scaffolded.filter(p => manifest.some(f => f.path === p)).length,
    };
};

/* Imported lazily to keep this module dependency-free for the pure tests above. */
let truncationCheck = null;
const isTruncationReason = (reason) => {
    if (!truncationCheck) {
        const REASONS = new Set(['MAX_TOKENS', 'max_tokens', 'length', 'max_output_tokens']);
        truncationCheck = (r) => typeof r === 'string' && REASONS.has(r);
    }
    return truncationCheck(reason);
};

/**
 * Which files a compiler blamed, and for what.
 *
 * Grouping by file is what makes repair bounded: only the files named cost a
 * request, and a project with two bad files does not pay for sixteen.
 */
export const filesNeedingRepair = (diagnostics, { max = 10 } = {}) => {
    const byFile = new Map();
    for (const d of Array.isArray(diagnostics) ? diagnostics : []) {
        if (typeof d?.path !== 'string') continue;
        if (!byFile.has(d.path)) byFile.set(d.path, []);
        byFile.get(d.path).push(d);
    }
    /* Most-broken first: a file with fourteen errors is more likely to be the cause
       than the file with one that merely consumes it. */
    return [...byFile.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, max)
        .map(([path, diags]) => ({ path, diagnostics: diags }));
};

/** The project files this one imports, resolved against what actually exists. */
export const importedPaths = (content, fromPath, record) => {
    const base = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
    const out = new Set();
    for (const spec of String(content ?? '').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const stack = [];
        for (const part of `${base}/${spec[1]}`.split('/')) {
            if (part === '..') stack.pop();
            else if (part !== '.' && part !== '') stack.push(part);
        }
        const target = stack.join('/');
        const hit = Object.keys(record).find(f =>
            f === target || f.startsWith(`${target}.`) || f.startsWith(`${target}/index.`));
        if (hit) out.add(hit);
    }
    return [...out];
};

/**
 * Ask for one file again, with the compiler's own complaint attached.
 *
 * The sources of what it imports go in verbatim, and that is the point rather than
 * generosity. The errors that survive the export contract are *shape* disagreements —
 * `TideCard.tsx` expecting `TideEntry.height` from a `types.ts` that never declared
 * it — and no amount of describing a file fixes that. Only reading it does.
 *
 * Bounded by construction: only files a compiler named are repaired, only the files
 * they import are included, and the whole thing runs a fixed number of rounds.
 */
export const repairInstruction = ({ manifest, path, purpose, content, diagnostics, sources }) => {
    const complaints = diagnostics
        .map(d => `- line ${d.line}, column ${d.col}: ${d.code} ${d.message.split('\n')[0]}`)
        .join('\n');
    const context = sources.length > 0
        ? `\n\nThe files it imports, exactly as they are — match them, do not assume:\n\n${
            sources.map(s => `--- ${s.path} ---\n${s.content}`).join('\n\n')}`
        : '';
    const entry = manifest.find(f => f.path === path);
    const contract = entry?.exports?.length
        ? `\n\nIt must still export exactly: ${entry.exports.join(', ')}.`
        : '';

    return `

**Fix one file: \`${path}\`.**

Its purpose: ${purpose}

TypeScript rejected it:
${complaints}

Here is the file as written:

${content}${context}${contract}

Return the corrected file in full. Change only what the errors require — do not
rewrite working code, do not rename exports other files depend on, and do not add
dependencies. If an error means a type is missing a property, the fix belongs in
whichever of these files is wrong, and you are being asked for this one.`;
};

/**
 * One repair round: re-request every file a compiler blamed, and only those.
 *
 * `record` is updated in place with whatever comes back — a file that fails to
 * regenerate keeps the version it had, because a broken file is still better than a
 * missing one and the caller's next typecheck will say so either way.
 *
 * Deliberately not a loop. A model that cannot fix a file will not fix it on the
 * fourth attempt either, and an unbounded repair burns quota to arrive at the same
 * answer more slowly. The caller decides how many rounds; the honest number is small.
 */
export const repairRound = async ({
    models, run, getProvider, systemFor, basePrompt, manifest, record, diagnostics,
    emit, schemas, concurrency = 3, onServed, maxFiles = 10,
}) => {
    const targets = filesNeedingRepair(diagnostics, { max: maxFiles });
    if (targets.length === 0) return { repaired: [], attempted: [] };

    emit({ phase: 'repairing', files: targets.map(t => t.path) });

    const repaired = [];
    const queue = [...targets];
    const fixOne = async (target) => {
        const entry = manifest.find(f => f.path === target.path);
        const sources = importedPaths(record[target.path], target.path, record)
            .map(path => ({ path, content: record[path] }));

        const result = await run(models, async (model) => {
            const provider = getProvider(model);
            let acc = '';
            let usage = null;
            for await (const event of provider.streamJson({
                model,
                system: systemFor(model),
                prompt: basePrompt + repairInstruction({
                    manifest,
                    path: target.path,
                    purpose: entry?.purpose ?? '',
                    content: record[target.path],
                    diagnostics: target.diagnostics,
                    sources,
                }),
                schema: schemas.file,
                /* Raised from 'medium', same reasoning as per-file generation: bounded
                   at 16,384 tokens, and a fix argued from the compiler's own
                   diagnostics is exactly where more careful reasoning pays off. See
                   HARNESS.md. */
                effort: 'high',
                maxOutputTokens: 16384,
            })) {
                if (event.usage) usage = event.usage;
                if (event.text) acc += event.text;
            }
            let content = null;
            try {
                const parsed = JSON.parse(acc);
                if (typeof parsed?.content === 'string') content = parsed.content;
            } catch { /* a repair that will not parse is simply not a repair */ }
            return { content, usage };
        }, onServed);

        if (typeof result.content === 'string' && result.content.trim() !== '') {
            record[target.path] = result.content;
            repaired.push(target.path);
            emit({ repaired: target.path });
        }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length > 0) {
            const target = queue.shift();
            try { await fixOne(target); }
            catch (error) { emit({ failed: target.path, reason: String(error?.message ?? error).slice(0, 120) }); }
        }
    }));

    return { repaired, attempted: targets.map(t => t.path) };
};
