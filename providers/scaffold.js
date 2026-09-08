/**
 * The files the generate prompt already dictates, written rather than requested.
 *
 * `tsconfig.json`'s `compilerOptions` are specified verbatim in that prompt.
 * `vite.config.ts` is "react + @tailwindcss/vite, no tailwind.config.js". `index.html`
 * is the standard Vite shell. `src/index.css` is `@import "tailwindcss";` plus the six
 * colour tokens the theme already chose. There is no judgement left in any of them.
 *
 * So paying a model request each is buying nothing, five times — and worse than
 * nothing, because these are exactly the files where a mistake is unrecoverable. A
 * wrong `tsconfig` breaks every file that follows it; a missing dependency breaks the
 * bundle. `validateBuild` carries dedicated codes for these failures, which is the
 * evidence they happen.
 *
 * `package.json` is different and comes last: its dependency list is **derived from
 * the imports the generated files actually contain**, not from anything anyone
 * declared. A list derived from the code cannot disagree with the code.
 */

import { PREVIEW_PACKAGES, isNotADependency } from './allowlist.js';

/** Exactly what the generate prompt pins, so the two cannot drift apart. */
const COMPILER_OPTIONS = {
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

/** Pinned majors, matching the prompt's stack rules. */
const BASE_DEPENDENCIES = {
    react: '^19.1.1',
    'react-dom': '^19.1.1',
    'react-router-dom': '^6.30.0',
};

const BASE_DEV_DEPENDENCIES = {
    '@tailwindcss/vite': '^4.1.0',
    '@types/react': '^19.1.1',
    '@types/react-dom': '^19.1.1',
    '@vitejs/plugin-react': '^4.3.1',
    tailwindcss: '^4.1.0',
    typescript: '^5.6.0',
    vite: '^5.4.0',
};

/**
 * Versions for the packages the preview can resolve.
 *
 * Keys must match `providers/allowlist.js` exactly — `test/generate.test.mjs` (`npm test`) asserts it, because
 * a name in one and not the other is how a generated app comes to declare something that
 * cannot load.
 */
export const KNOWN_VERSIONS = {
    'lucide-react': '^0.460.0',
    clsx: '^2.1.1',
    'tailwind-merge': '^2.5.0',
    'date-fns': '^4.1.0',
    zustand: '^5.0.0',
    recharts: '^2.13.0',
    'react-hook-form': '^7.53.0',
    zod: '^3.24.1',
    'framer-motion': '^11.11.0',
};

/** A name safe for `package.json`. */
const packageName = (projectName) =>
    (String(projectName || 'generated-app')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'generated-app').slice(0, 60);

const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * The four files that depend on nothing the model writes.
 *
 * @param {{plan: object, theme: object, entry?: string}} input
 * @returns {Record<string, string>}
 */
/**
 * `src/types.ts`, written deterministically from the plan's own `entities[]` — never
 * requested, so it cannot become the next guess at a shape other files already
 * disagreed about.
 *
 * `null` rather than an empty file when there is nothing to declare: an app with no
 * shared data model has nothing to freeze, and a file with no interfaces in it is not
 * evidence of anything either way — `scaffoldFor` omits the path entirely rather than
 * write it.
 */
export const typesFileFor = (entities) => {
    const named = (Array.isArray(entities) ? entities : []).filter((e) => e?.name);
    if (named.length === 0) return null;
    return named.map((entity) => {
        const fields = (Array.isArray(entity.fields) ? entity.fields : [])
            .filter((f) => f?.name)
            .map((f) => `    ${f.name}: ${f.type || 'unknown'};`)
            .join('\n');
        return `export interface ${entity.name} {\n${fields}\n}`;
    }).join('\n\n') + '\n';
};

export const scaffoldFor = ({ plan, theme, entry = 'src/main.tsx' }) => {
    const colors = theme?.colors ?? {};
    const token = (role, fallback) => colors[role] || fallback;
    const types = typesFileFor(plan?.entities);

    /* The six roles the prompt tells the model to declare, declared here instead so
       they cannot be mistyped or quietly omitted. */
    const css = `@import "tailwindcss";

:root {
    --color-bg: ${token('bg', '#0b0b0c')};
    --color-surface: ${token('surface', '#161617')};
    --color-text: ${token('text', '#f4f4f5')};
    --color-muted: ${token('muted', '#9a9aa2')};
    --color-primary: ${token('primary', '#ea580c')};
    --color-accent: ${token('accent', '#fb923c')};
}

body {
    background-color: var(--color-bg);
    color: var(--color-text);
}
`;

    return {
        'tsconfig.json': `${JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ['src'] }, null, 2)}\n`,
        'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [react(), tailwindcss()],
});
`,
        'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(plan?.projectName ?? 'Generated app')}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${entry}"></script>
  </body>
</html>
`,
        'src/index.css': css,
        /**
         * The entry, written rather than requested.
         *
         * Observed on a real four-page build: `main.tsx` mounted `<App />` with no
         * Router at all while `App.tsx` used `Routes`, `Route` and `useLocation`.
         * `tsc` passed — `useLocation` is validly typed wherever it appears — esbuild
         * passed, and the app threw on its first render and drew nothing. Every judge
         * that reads the code was satisfied by a completely broken app.
         *
         * There is no creativity in this file and total cost to getting it wrong, so
         * the Router is now structural rather than something a model must remember.
         */
        'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root was not found');

createRoot(rootElement).render(
    <StrictMode>
        <BrowserRouter>
            <App />
        </BrowserRouter>
    </StrictMode>,
);
`,
        ...(types ? { 'src/types.ts': types } : {}),
    };
};

/** Every bare package specifier the generated source actually imports. */
export const importedPackages = (record) => {
    const found = new Set();
    for (const [path, content] of Object.entries(record ?? {})) {
        if (!/\.(tsx|ts|jsx|js)$/.test(path)) continue;
        for (const match of String(content).matchAll(/from\s+['"]([^.'"][^'"]*)['"]/g)) {
            const spec = match[1];
            /* `@scope/pkg/sub` and `pkg/sub` both belong to their package. */
            const parts = spec.split('/');
            found.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
        }
    }
    return [...found].sort();
};

/**
 * `package.json`, derived from what the code imports.
 *
 * Asking a model to list its own dependencies invites the two to disagree — and when
 * they disagree the build fails at the bundler, long after the mistake. Reading the
 * imports cannot disagree, because the imports are the source of truth.
 */
export const packageJsonFor = ({ plan, record }) => {
    const dependencies = { ...BASE_DEPENDENCIES };
    for (const pkg of importedPackages(record)) {
        if (pkg in BASE_DEV_DEPENDENCIES || pkg in dependencies) continue;
        /* Node built-ins and compiler-injected specifiers are not dependencies. */
        if (isNotADependency(pkg)) continue;
        /**
         * **Not declared unless it can run.** This read
         * `dependencies[pkg] = KNOWN_VERSIONS[pkg] ?? 'latest'`, so any import at all
         * became a declared dependency — and every judge then treated *declared* as
         * "the environment's problem" and looked away. Writing the name into
         * package.json was the act that laundered a build the preview could not load
         * into one that passed all its checks.
         *
         * An import outside the list is left undeclared on purpose, so the bundler's
         * failure reaches `attributeBundleErrors` as the model's `unresolved-import`
         * rather than being forgiven.
         */
        if (!PREVIEW_PACKAGES.has(pkg)) continue;
        dependencies[pkg] = KNOWN_VERSIONS[pkg] ?? 'latest';
    }

    return `${JSON.stringify({
        name: packageName(plan?.projectName),
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
            dev: 'vite',
            build: 'vite build',
            typecheck: 'tsc --noEmit',
            preview: 'vite preview',
        },
        dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
        devDependencies: BASE_DEV_DEPENDENCIES,
    }, null, 2)}\n`;
};

/** Paths the scaffold owns. The model is never asked for these. */
export const SCAFFOLD_PATHS = ['tsconfig.json', 'vite.config.ts', 'index.html', 'src/index.css', 'src/main.tsx', 'package.json'];
