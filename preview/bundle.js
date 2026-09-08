/**
 * Bundling a project that only exists in memory.
 *
 * The generated app is a `Record<path, content>` that has never touched a disk, so
 * esbuild reads it through a plugin rather than from the filesystem. Two things about
 * that are worth knowing before changing anything here:
 *
 * 1. **A virtual namespace cannot resolve bare specifiers.** esbuild finds `react` by
 *    walking up from the importer looking for `node_modules`, and there is nothing to
 *    walk up from when the importer is `src/main.tsx` in a namespace we invented.
 *    Every bare specifier is therefore resolved explicitly, against this repo's own
 *    `node_modules`, and handed back in the real `file` namespace so esbuild takes
 *    over from there.
 * 2. **The output is an IIFE, not an ES module.** The preview document is sandboxed
 *    without `allow-same-origin`, which gives it an opaque origin; a classic script
 *    sidesteps every module-in-an-opaque-origin question at no cost.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** Resolves against multi-app's own dependencies — the ones the wizard pins. */
const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));

const NS = 'project';
/** CSS never reaches esbuild; Tailwind compiles it. See `stubbed` below. */
const CSS_NS = 'project-css';
/** Modules this file substitutes for real ones. See `ROUTER_SHIM`. */
const SHIM_NS = 'project-shim';

/**
 * The router, routed around.
 *
 * The generate prompt *mandates* `react-router-dom` v6 with a `BrowserRouter`, and a
 * `BrowserRouter` navigates by calling `history.pushState` — which throws
 * `SecurityError` in a sandboxed frame at an opaque origin. Measured, not assumed:
 * so does `replaceState`, which rules out `HashRouter` too, because v6's hash history
 * is also built on `pushState`.
 *
 * `MemoryRouter` keeps its history in a variable and touches no browser API, so it
 * works. The trade is that the preview always starts at `/` and the URL never
 * reflects the route — invisible in a frame with no address bar, and the alternative
 * is a nav bar where every link throws.
 *
 * Explicit re-exports shadow the star, so this swaps two names and passes the rest of
 * the package through untouched.
 */
const ROUTER_SHIM = `export * from 'react-router-dom';
export { MemoryRouter as BrowserRouter, MemoryRouter as HashRouter } from 'react-router-dom';`;

const TIMEOUT_MS = 20_000;
/** The bundle is inlined into a `srcDoc` string. Past this it is not a preview. */
const MAX_BYTES = 6 * 1024 * 1024;

const LOADERS = {
    '.tsx': 'tsx', '.ts': 'ts', '.jsx': 'jsx',
    /* `.js` is deliberately `jsx`: generated projects put JSX in `.js` often enough
       that parsing it as plain JS turns their code into a syntax error we caused. */
    '.js': 'jsx', '.mjs': 'jsx', '.cjs': 'jsx',
    '.json': 'json', '.txt': 'text',
    '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl',
    '.gif': 'dataurl', '.webp': 'dataurl', '.avif': 'dataurl', '.ico': 'dataurl',
};

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'];

/** `./src/App` and `/src/App` and `src/App` are one file. */
export const normalize = (p) => {
    const posix = path.posix.normalize(String(p).replace(/\\/g, '/').replace(/^\/+/, ''));
    return posix.replace(/^\.\//, '');
};

const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/');

/**
 * Every path a relative import could mean, in the order Vite would try them.
 */
const candidates = (base) => [
    base,
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => `${base}/index${ext}`),
];

/**
 * The module script the project's own `index.html` points at.
 *
 * Reading the entry out of the HTML rather than assuming `src/main.tsx` means a
 * project that named it something else still previews, and a project missing an
 * entry altogether fails with a sentence instead of an empty frame.
 */
export const entryPointOf = (files) => {
    const html = files['index.html'];
    if (typeof html === 'string') {
        const match = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i.exec(html);
        if (match) {
            const candidate = normalize(match[1]);
            if (files[candidate]) return candidate;
        }
    }
    for (const fallback of ['src/main.tsx', 'src/main.ts', 'src/index.tsx', 'src/main.jsx', 'src/index.jsx']) {
        if (files[fallback]) return fallback;
    }
    return null;
};

/**
 * esbuild's own message shape, flattened to something the client can render.
 * `location` is kept because "which file, which line" is the whole value of a build
 * error over a blank pane.
 */
const toBuildError = (message) => ({
    text: message.text,
    file: message.location?.file && message.location.file !== '<stdin>'
        ? message.location.file.replace(new RegExp(`^${NS}:`), '')
        : null,
    line: message.location?.lineText ? message.location.line : null,
    column: message.location?.lineText ? message.location.column + 1 : null,
    detail: message.notes?.map((n) => n.text).filter(Boolean).join(' ') || null,
});

/**
 * Bundle a virtual project into one classic script.
 *
 * @param {Record<string, string>} files
 * @returns {Promise<{ok: true, code: string, entry: string, bytes: number, durationMs: number}
 *                 | {ok: false, errors: object[], durationMs: number}>}
 */
export const bundle = async (files) => {
    const started = Date.now();
    const entry = entryPointOf(files);
    if (!entry) {
        return {
            ok: false,
            durationMs: Date.now() - started,
            errors: [{
                text: 'No entry point: index.html has no module script, and there is no src/main.tsx.',
                file: 'index.html', line: null, column: null, detail: null,
            }],
        };
    }

    /** Which specifiers were stubbed rather than bundled — the CSS Tailwind gets. */
    const stylesheets = new Set();

    const virtualFs = {
        name: 'virtual-fs',
        setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
                if (args.kind === 'entry-point') return { path: normalize(args.path), namespace: NS };
                /* A real file importing a real file: esbuild already knows how. */
                if (args.namespace !== NS) return null;

                if (isRelative(args.path)) {
                    const base = normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
                    if (base.startsWith('..')) {
                        return { errors: [{ text: `Import escapes the project: ${args.path}` }] };
                    }
                    const hit = candidates(base).find((c) => typeof files[c] === 'string');
                    if (!hit) {
                        return {
                            errors: [{
                                text: `Could not resolve "${args.path}" — no such file in the generated project.`,
                                location: { file: args.importer },
                            }],
                        };
                    }
                    if (hit.endsWith('.css')) {
                        stylesheets.add(hit);
                        return { path: hit, namespace: CSS_NS };
                    }
                    return { path: hit, namespace: NS };
                }

                /* Bare. esbuild cannot walk up from a namespace, so resolve by hand. */
                if (args.path.endsWith('.css')) return { path: args.path, namespace: CSS_NS };
                if (args.path === 'react-router-dom') return { path: 'react-router-dom', namespace: SHIM_NS };
                try {
                    return { path: requireFromRoot.resolve(args.path), namespace: 'file' };
                } catch {
                    /* Risk 4 from the plan, made visible: a package the model declared
                       but nobody installed bundles to nothing. Name it, so the reader
                       is told what is missing instead of shown a white rectangle. */
                    return {
                        errors: [{
                            text: `Could not resolve "${args.path}" — the package is not installed in this preview.`,
                            location: { file: args.importer },
                            notes: [{ text: 'The preview bundles against multi-app\'s own dependencies.' }],
                        }],
                    };
                }
            });

            build.onLoad({ filter: /.*/, namespace: NS }, (args) => {
                const contents = files[args.path];
                if (typeof contents !== 'string') {
                    return { errors: [{ text: `Missing file: ${args.path}` }] };
                }
                const loader = LOADERS[path.posix.extname(args.path).toLowerCase()] ?? 'text';
                return { contents, loader, resolveDir: ROOT };
            });

            /**
             * Stylesheets are collected, not bundled. Tailwind's compiler is the only
             * thing that can turn `@import "tailwindcss"` into rules, and running the
             * CSS through esbuild first would either inline the wrong file or emit a
             * second output the single-document preview has nowhere to put.
             *
             * The stub keeps `import styles from './x.module.css'` from throwing; the
             * class names come back empty, which is visible as unstyled markup rather
             * than as a crash.
             */
            build.onLoad({ filter: /.*/, namespace: CSS_NS }, () => ({
                contents: 'export default {};',
                loader: 'js',
            }));

            /* `resolveDir` is what lets the shim's own `from 'react-router-dom'` find
               the real package: it resolves in the `file` namespace, which the
               resolver above deliberately declines to touch. */
            build.onLoad({ filter: /.*/, namespace: SHIM_NS }, () => ({
                contents: ROUTER_SHIM,
                loader: 'js',
                resolveDir: ROOT,
            }));
        },
    };

    let result;
    try {
        result = await Promise.race([
            esbuild.build({
                entryPoints: [entry],
                bundle: true,
                write: false,
                format: 'iife',
                platform: 'browser',
                target: ['es2020'],
                jsx: 'automatic',
                /* Measured on this project: 842 KB unminified, 322 KB minified. The
                   whole bundle is inlined into a `srcDoc` string that a phone has to
                   parse, so the 62% is worth having. `keepNames` buys back the one
                   thing minifying costs a preview — a stack trace naming real
                   components — and error *messages* were never at risk either way. */
                minify: true,
                keepNames: true,
                sourcemap: false,
                logLevel: 'silent',
                /* React reads this at module scope; without it the bundle throws
                   `process is not defined` before rendering a single element. */
                define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
                plugins: [virtualFs],
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`bundling timed out after ${TIMEOUT_MS} ms`)), TIMEOUT_MS)),
        ]);
    } catch (err) {
        const errors = Array.isArray(err?.errors) && err.errors.length
            ? err.errors.map(toBuildError)
            : [{ text: err instanceof Error ? err.message : 'bundling failed', file: null, line: null, column: null, detail: null }];
        return { ok: false, errors, durationMs: Date.now() - started };
    }

    const code = result.outputFiles?.[0]?.text ?? '';
    if (code.length > MAX_BYTES) {
        return {
            ok: false,
            durationMs: Date.now() - started,
            errors: [{
                text: `The bundle is ${Math.round(code.length / 1024)} KB, past the ${MAX_BYTES / 1024 / 1024} MB a preview document can carry.`,
                file: null, line: null, column: null, detail: null,
            }],
        };
    }

    return { ok: true, code, entry, stylesheets: [...stylesheets], bytes: code.length, durationMs: Date.now() - started };
};
