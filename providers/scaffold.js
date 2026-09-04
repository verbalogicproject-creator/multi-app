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

/** Packages we can name a version for. Anything else is pinned to `latest`. */
const KNOWN_VERSIONS = {
    'lucide-react': '^0.460.0',
    clsx: '^2.1.1',
    'tailwind-merge': '^2.5.0',
    'date-fns': '^4.1.0',
    zustand: '^5.0.0',
    recharts: '^2.13.0',
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
export const scaffoldFor = ({ plan, theme, entry = 'src/main.tsx' }) => {
    const colors = theme?.colors ?? {};
    const token = (role, fallback) => colors[role] || fallback;

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
        /* Node built-ins and type-only imports are not dependencies. */
        if (pkg.startsWith('node:') || pkg === 'react/jsx-runtime') continue;
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
export const SCAFFOLD_PATHS = ['tsconfig.json', 'vite.config.ts', 'index.html', 'src/index.css', 'package.json'];
