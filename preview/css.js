/**
 * Tailwind, compiled in-process, with no network and no CDN.
 *
 * The generated project's `src/index.css` starts with `@import "tailwindcss"`, which
 * is a directive only Tailwind's own compiler understands — esbuild would either
 * inline the wrong file or fail. So the stylesheet is compiled here instead, against
 * the `tailwindcss@4` this repo already depends on, and the result is inlined into
 * the preview document as one `<style>`.
 *
 * The candidate list comes from `@tailwindcss/oxide`'s real `Scanner`, fed the
 * generated sources in memory. Using Tailwind's own extractor rather than a regex is
 * what makes the preview's CSS the same CSS `vite build` would produce.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));

/**
 * A base directory that cannot exist on this filesystem, so "is this import from the
 * generated project or from `node_modules`?" is answered by a prefix check rather
 * than by hoping the two never collide.
 */
const VIRTUAL_BASE = '/@project';

const SCANNABLE = /\.(tsx|ts|jsx|js|mts|cts|mjs|cjs|html|md|mdx|vue|svelte)$/i;

/** The stylesheet a generated Vite project imports from its entry. */
const CSS_ENTRIES = ['src/index.css', 'src/main.css', 'src/App.css', 'src/styles/index.css', 'index.css'];

const virtualPathOf = (base, id) =>
    path.posix.normalize(path.posix.join(base.slice(VIRTUAL_BASE.length) || '.', id)).replace(/^\/+/, '');

/**
 * Everything Tailwind needs to see to know which utilities to emit.
 * Extensions are handed over as-is: oxide picks its extractor from them.
 */
const scanCandidates = (files) => {
    const { Scanner } = requireFromRoot('@tailwindcss/oxide');
    const sources = [];
    for (const [file, content] of Object.entries(files)) {
        if (typeof content !== 'string' || !SCANNABLE.test(file)) continue;
        sources.push({ content, extension: path.posix.extname(file).slice(1).toLowerCase() });
    }
    if (sources.length === 0) return [];
    return new Scanner({}).scanFiles(sources);
};

/**
 * Compile the project's stylesheet.
 *
 * A project with no stylesheet is not an error — it is an app that styles itself some
 * other way — so this returns empty CSS rather than a failure, and the caller renders
 * the app unstyled instead of refusing to render it.
 *
 * @param {Record<string,string>} files
 * @param {string[]} [preferred] stylesheets the bundler saw imported, in import order
 * @returns {Promise<{css: string, from: string|null, candidates: number, durationMs: number, error: string|null}>}
 */
export const compileCss = async (files, preferred = []) => {
    const started = Date.now();
    const entry = [...preferred, ...CSS_ENTRIES].find((p) => typeof files[p] === 'string');
    if (!entry) {
        return { css: '', from: null, candidates: 0, durationMs: Date.now() - started, error: null };
    }

    let candidates = [];
    try {
        candidates = scanCandidates(files);
    } catch (err) {
        /* oxide is a native module. If it will not load on this device, the preview is
           still worth showing — it is the utilities that are missing, not the app. */
        candidates = [];
        console.warn('[preview] candidate scan unavailable:', err instanceof Error ? err.message : err);
    }

    try {
        const { compile } = await import('tailwindcss');
        const compiler = await compile(files[entry], {
            base: path.posix.join(VIRTUAL_BASE, path.posix.dirname(entry)),
            onDependency: () => {},
            /**
             * Two filesystems behind one callback. Anything rooted at the virtual base
             * is a file the model wrote; anything else is Tailwind's own package,
             * whose internal `@import "./theme.css"` chain has to keep working.
             */
            loadStylesheet: async (id, base) => {
                if (base.startsWith(VIRTUAL_BASE) && (id.startsWith('./') || id.startsWith('../'))) {
                    const target = virtualPathOf(base, id);
                    const content = files[target] ?? files[`${target}.css`];
                    if (typeof content !== 'string') throw new Error(`Cannot find stylesheet "${id}"`);
                    return { path: path.posix.join(VIRTUAL_BASE, target), base: path.posix.join(VIRTUAL_BASE, path.posix.dirname(target)), content };
                }
                if (base.startsWith(VIRTUAL_BASE)) {
                    /* A bare import from the project: `tailwindcss`, or a package that
                       ships CSS. Resolved against this repo, like the bundler does. */
                    const resolved = requireFromRoot.resolve(id.endsWith('.css') ? id : `${id}/index.css`);
                    return { path: resolved, base: path.dirname(resolved), content: await fs.readFile(resolved, 'utf8') };
                }
                const resolved = id.startsWith('.') ? path.resolve(base, id) : requireFromRoot.resolve(id);
                return { path: resolved, base: path.dirname(resolved), content: await fs.readFile(resolved, 'utf8') };
            },
            loadModule: async () => { throw new Error('@plugin and @config are not supported in the preview'); },
        });

        return {
            css: compiler.build(candidates),
            from: entry,
            candidates: candidates.length,
            durationMs: Date.now() - started,
            error: null,
        };
    } catch (err) {
        /* A stylesheet that will not compile must not cost the whole preview. The app
           renders unstyled, and the reason travels with it. */
        return {
            css: '',
            from: entry,
            candidates: candidates.length,
            durationMs: Date.now() - started,
            error: err instanceof Error ? err.message : 'stylesheet failed to compile',
        };
    }
};
