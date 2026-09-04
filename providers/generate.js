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

/** Files a Vite + React + TS project cannot run without, whatever the model lists. */
export const MANIFEST_FLOOR = ['index.html', 'package.json', 'src/main.tsx', 'src/App.tsx'];

/**
 * Ask for the shape of the project before any of its content.
 *
 * Deliberately forbids code: the moment a manifest starts carrying implementations it
 * is the single-shot response again, with the same ceiling.
 */
export const manifestInstruction = () => `

**This request is the file manifest only — no code.**

List every file the project needs, each with a one-line purpose and **the exact names it
exports**. The export list is a contract every other file will be held to, so name each
export precisely and mark a default export as \`default Name\`. Config, CSS and HTML files
export nothing. Include the config and entry files (index.html,
package.json, tsconfig.json, vite.config.ts, src/main.tsx, src/index.css), every page and
component from the plan, and any context, hook, type or data module the app requires.

Still list \`index.html\`, \`package.json\`, \`tsconfig.json\`, \`vite.config.ts\` and
\`src/index.css\` so the other files can rely on them — but they are written for you from
the plan and the theme, so give them a one-line purpose and no exports and spend no
thought on their contents.

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
export const fileInstruction = ({ manifest, path, purpose, written }) => {
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
    return `

**Write exactly one file: \`${path}\`.**

Its purpose: ${purpose}

The complete project manifest, so your imports match the files that will exist:
${listing}${done}

Return only that one file's full contents. It must be complete and syntactically valid on
its own — every brace, bracket and JSX tag closed, every string terminated.

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
    models, run, getProvider, systemFor, basePrompt, recalled = '', trialled = '',
    emit, schemas, concurrency = 3, onServed, prefill = {}, provided = [],
}) => {
    let manifest = null;
    try {
        const { object } = await run(models, async (model) => {
            emit({ phase: 'planning', model });
            return getProvider(model).generateJson({
                model,
                system: systemFor(model),
                prompt: basePrompt + manifestInstruction() + recalled + trialled,
                schema: schemas.manifest,
                effort: 'low',
                maxOutputTokens: 8192,
            });
        }, onServed);
        const candidate = normaliseManifest(object?.files);
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
                prompt: basePrompt + fileInstruction({ manifest, path: entry.path, purpose: entry.purpose, written }) + recalled + trialled,
                schema: schemas.file,
                effort: 'medium',
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
                effort: 'medium',
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
