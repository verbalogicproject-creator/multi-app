/**
 * Running `tsc --noEmit` over a project that only exists in memory.
 *
 * The scratch tree lives **inside the repo**, at `.preview-work/`, and that is the
 * load-bearing decision in this file. TypeScript resolves `react` by walking up
 * looking for `node_modules`; from here it finds our own, so a generated project
 * typechecks against the real `@types/react` and the diagnostics are the ones the
 * user's own `npm run typecheck` would print. Measured: from `/tmp`, every single
 * `react` import is `TS2307` instead, which is why the original plan called for
 * filtering them wholesale. Moving the directory removes the problem the filter
 * was for.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { declaredPackages, dropDeclaredMissingModules, parseTsc, toBuildIssues } from './parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORK_DIR = path.join(ROOT, '.preview-work');
const TSC = path.join(ROOT, 'node_modules', '.bin', 'tsc');

/** 6× the 3.0 s a full run over multi-app itself takes on this device. */
const TIMEOUT_MS = 20_000;
/** ~2,000 diagnostics. Past this the output is not something anyone reads. */
const MAX_OUTPUT = 256 * 1024;
/** The panel is for reading, not for archiving. */
const MAX_DIAGNOSTICS = 200;

const CHECKABLE = /\.(tsx|ts|jsx|js|mts|cts|mjs|cjs)$/i;
/** Type-only files tsc must load but which are not themselves the project. */
const DECLARATION = /\.d\.(ts|mts|cts)$/i;

/**
 * Vite resolves these; tsc does not, and without them every `import logo from
 * './logo.svg'` is a type error the model did nothing to deserve. A false positive
 * here is worse than noise: these verdicts feed the lesson ladder, so an unshimmed
 * asset import would teach the next generation to stop importing assets.
 *
 * A side-effect `import './index.css'` needs no shim — TypeScript ignores those. It
 * is the *default* imports that fail. Both forms are covered anyway; a generated
 * `src/vite-env.d.ts` declaring the same modules is not a conflict.
 */
const ENV_SHIM = `declare module '*.css';
declare module '*.scss';
declare module '*.sass';
declare module '*.less';
declare module '*.module.css' { const classes: Record<string, string>; export default classes; }
declare module '*.module.scss' { const classes: Record<string, string>; export default classes; }
declare module '*.svg' { const src: string; export default src; }
declare module '*.svg?react' { import type { FunctionComponent, SVGProps } from 'react'; const C: FunctionComponent<SVGProps<SVGSVGElement>>; export default C; }
declare module '*.png' { const src: string; export default src; }
declare module '*.jpg' { const src: string; export default src; }
declare module '*.jpeg' { const src: string; export default src; }
declare module '*.gif' { const src: string; export default src; }
declare module '*.webp' { const src: string; export default src; }
declare module '*.avif' { const src: string; export default src; }
declare module '*.ico' { const src: string; export default src; }
declare module '*.json' { const value: unknown; export default value; }
`;

/** What the generate prompt pins, used when the project's own tsconfig is unusable. */
const FALLBACK_OPTIONS = {
    target: 'ES2020',
    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
};

/**
 * A directory name that cannot traverse, whatever the project id is.
 *
 * Project ids come from `generateUniqueId()` and contain a dot, so they are not
 * usable as path segments under any validation this repo already has. Hashing
 * sidesteps the question rather than answering it: there is no input that produces
 * a `..`, and the same project always lands in the same place.
 */
const dirFor = (projectId) => path.join(WORK_DIR, createHash('sha1').update(String(projectId)).digest('hex').slice(0, 16));

/** In-flight runs, one per project. A newer revision supersedes an older answer. */
const running = new Map();

/**
 * Write the virtual project to disk.
 * @returns {Promise<string[]>} the paths tsc should be pointed at
 */
const materialize = async (dir, files) => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });

    const checkable = [];
    for (const [rel, content] of Object.entries(files)) {
        if (typeof content !== 'string') continue;
        const target = path.resolve(dir, rel);
        /* `rel` is model output. This check is mandatory, not illustrative. */
        if (!target.startsWith(dir + path.sep)) throw new Error(`path escape refused: ${rel}`);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, 'utf8');
        if (CHECKABLE.test(rel) || DECLARATION.test(rel)) checkable.push(rel);
    }

    await fs.writeFile(path.join(dir, 'preview-env.d.ts'), ENV_SHIM, 'utf8');
    checkable.push('preview-env.d.ts');
    return checkable;
};

/**
 * The config tsc actually runs with.
 *
 * The project's own `compilerOptions` are reused verbatim, so what we report is what
 * the user's build would report. What is *not* reused is `include: ["src"]` — it
 * silently skips every file outside `src/`, and a file that was never checked is
 * indistinguishable from a file with no errors. An explicit `files` list cannot
 * quietly miss anything.
 */
const writeConfig = async (dir, files, checkable) => {
    let options = FALLBACK_OPTIONS;
    if (typeof files['tsconfig.json'] === 'string') {
        try {
            const parsed = JSON.parse(files['tsconfig.json']);
            if (parsed?.compilerOptions && typeof parsed.compilerOptions === 'object') {
                options = { ...parsed.compilerOptions };
            }
        } catch {
            /* invalid-json is already its own validator code; fall back rather than fail. */
        }
    }
    const config = {
        compilerOptions: { ...options, noEmit: true, skipLibCheck: true },
        files: checkable,
    };
    await fs.writeFile(path.join(dir, 'tsconfig.check.json'), JSON.stringify(config, null, 2), 'utf8');
};

/** Kill whatever is running for this project; its answer is stale by definition. */
export const cancel = (projectId) => {
    const child = running.get(dirFor(projectId));
    if (child) {
        child.kill('SIGTERM');
        running.delete(dirFor(projectId));
    }
};

/** Every live child, for the shutdown handler. */
export const killAll = () => {
    for (const child of running.values()) child.kill('SIGTERM');
    running.clear();
};

/** Remove the whole scratch tree. Called at boot: a crash must not accumulate projects. */
export const clean = () => fs.rm(WORK_DIR, { recursive: true, force: true }).catch(() => {});

/**
 * Typecheck a virtual project.
 *
 * @param {{projectId: string, files: Record<string,string>}} input
 * @returns {Promise<{ok: boolean, issues: object[], diagnostics: object[], truncated: boolean, checked: number, durationMs: number}>}
 */
export const typecheck = async ({ projectId, files }) => {
    const dir = dirFor(projectId);
    cancel(projectId);

    const started = Date.now();
    let checkable;
    try {
        checkable = await materialize(dir, files);
        await writeConfig(dir, files, checkable);
    } catch (err) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        throw err;
    }

    /* Nothing to check is not a failure — an empty project is `no-files`, which is
       the lexical validator's verdict to give, not ours. */
    if (checkable.length <= 1) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        return { ok: true, issues: [], diagnostics: [], truncated: false, checked: 0, durationMs: Date.now() - started };
    }

    const raw = await new Promise((resolve) => {
        const child = execFile(
            TSC,
            ['-p', 'tsconfig.check.json', '--noEmit', '--pretty', 'false'],
            { cwd: dir, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, killSignal: 'SIGTERM' },
            /* A non-zero exit is the normal path: tsc exits 2 when it finds errors.
               Only stdout matters, and it is present either way. */
            (err, stdout) => resolve({ stdout: stdout ?? '', killed: Boolean(err && (err.killed || err.code === 'ABORT_ERR')) }),
        );
        running.set(dir, child);
    });
    running.delete(dir);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

    const declared = declaredPackages(files['package.json']);
    const parsed = dropDeclaredMissingModules(parseTsc(raw.stdout), declared);
    const truncated = parsed.length > MAX_DIAGNOSTICS || raw.killed;
    const diagnostics = parsed.slice(0, MAX_DIAGNOSTICS);

    return {
        ok: diagnostics.length === 0,
        issues: toBuildIssues(diagnostics),
        diagnostics,
        truncated,
        checked: checkable.length - 1,
        durationMs: Date.now() - started,
    };
};
