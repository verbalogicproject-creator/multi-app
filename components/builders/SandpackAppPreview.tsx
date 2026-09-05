import React, { useMemo } from 'react';
import { SandpackProvider, SandpackPreview as SandpackPreviewPane } from '@codesandbox/sandpack-react';
import { PREVIEW_PACKAGES } from '../../providers/allowlist.js';

/**
 * The generated app, running through Sandpack instead of multi-app's own esbuild
 * bundler — CDN dependency resolution, so every package on `providers/allowlist.js`
 * renders exactly as authored, with no local install step and no size limit tied to
 * what multi-app itself has in `node_modules`.
 *
 * **This is a second pair of eyes, not a second verdict.** `validation` — `tsc` plus
 * `previewVerdict`'s esbuild-and-run check — is computed once, independently, before
 * this component ever mounts (`AppContext.tsx`'s `generateWebAppCode`). Nothing here
 * feeds that state, and nothing here is allowed to: a project with a type error still
 * fails `validation.ok` even though Sandpack, which never runs `tsc`, may render it
 * without complaint. Two different questions, asked by two different tools, on
 * purpose — see `A0` in the plan for why collapsing them back into one was the
 * original hole this project spent A1 closing.
 *
 * **Tailwind is approximated, not run.** The project's real `vite.config.ts` imports
 * `@tailwindcss/vite`, a devDependency with native binaries that do not resolve
 * inside Sandpack's sandbox. Rather than fail the whole preview over styling, the
 * sandboxed copy drops the project's own build files (Sandpack's `react-ts` template
 * supplies equivalents) and imports `@tailwindcss/browser` instead, which JIT-compiles
 * the same utility classes at runtime from the DOM. Close enough for a person to look
 * at and iterate against; never mistaken for the build.
 *
 * That import, not a `<script src="https://cdn.tailwindcss.com">` tag, and it is not
 * a style preference: measured against this exact sandbox, the tag rendered with no
 * styling applied at all and no console error to explain why — Sandpack's preview
 * frame does not execute a remote `<script src>` it did not bundle itself. A plain
 * module import goes through the same dependency pipeline that already resolves
 * `lucide-react`, and it works.
 */

interface SandpackAppPreviewProps {
    files: Record<string, string>;
    title?: string;
    className?: string;
}

/**
 * Deterministic scaffold files (`providers/scaffold.js`) that name a devDependency
 * Sandpack cannot install, or an HTML shell the `react-ts` template's own
 * `/public/index.html` replaces. Passing them through would not break real builds —
 * only this preview — but excluding them here has to be done by name so a future
 * scaffold file is not silently sent into a sandbox it can break.
 */
const SANDBOX_OWNED_PATHS = new Set([
    'package.json', 'vite.config.ts', 'vite.config.js', 'tsconfig.json', 'tsconfig.node.json', 'index.html',
]);

const TAILWIND_IMPORT_RE = /^[ \t]*@import\s+["']tailwindcss["'];?[ \t]*\r?\n?/gm;
const TAILWIND_AT_RULE_RE = /^[ \t]*@tailwind\s+\w+;?[ \t]*\r?\n?/gm;

/** `@import "tailwindcss"` is a build-time directive `@tailwindcss/vite` intercepts —
 *  without that plugin present it is an unresolved CSS import and breaks the bundle.
 *  Stripped, not translated: the Play CDN script covers the utility classes instead. */
const stripTailwindDirectives = (css: string): string =>
    css.replace(TAILWIND_IMPORT_RE, '').replace(TAILWIND_AT_RULE_RE, '');

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** The `react-ts` template's own shell, with a real title — its default is `Document`. */
const sandboxShell = (title: string): string => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

/** The npm package version of Tailwind's Play CDN. Imported, not scripted — see the
 *  module doc comment for why the `<script src>` form does not run here. */
const TAILWIND_BROWSER_IMPORT = "import '@tailwindcss/browser';\n";

/** Turns the project's own file map into what Sandpack's `react-ts` template runs. */
const toSandpackFiles = (projectFiles: Record<string, string>, title: string, entry: string): Record<string, string> => {
    const files: Record<string, string> = { '/public/index.html': sandboxShell(title) };
    const entryPath = entry.replace(/^\/+/, '');
    for (const [rawPath, content] of Object.entries(projectFiles)) {
        const path = rawPath.replace(/^\/+/, '');
        if (SANDBOX_OWNED_PATHS.has(path)) continue;
        const key = `/${path}`;
        if (path === entryPath) files[key] = TAILWIND_BROWSER_IMPORT + content;
        else if (path.endsWith('.css')) files[key] = stripTailwindDirectives(content);
        else files[key] = content;
    }
    return files;
};

/**
 * The real dependency versions the scaffold already pinned (`providers/scaffold.js`'s
 * `KNOWN_VERSIONS`), read back from the generated `package.json` rather than retyped —
 * a second copy of those versions here is exactly the drift this project's allowlist
 * work exists to prevent. Filtered to `PREVIEW_PACKAGES`: an import outside the
 * allowlist is the model's problem everywhere else `providers/allowlist.js` is
 * consulted, and Sandpack must not quietly make it work when nothing else would.
 */
const dependenciesFrom = (projectFiles: Record<string, string>): Record<string, string> => {
    /* Not on `providers/allowlist.js` because it never reaches a real build — this
       sandbox is the only place it is ever imported. */
    const deps: Record<string, string> = { '@tailwindcss/browser': '^4.1.0' };
    try {
        const pkg = JSON.parse(projectFiles['package.json'] ?? '{}') as { dependencies?: Record<string, unknown> };
        for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
            if (PREVIEW_PACKAGES.has(name) && typeof version === 'string') deps[name] = version;
        }
    } catch { /* malformed package.json: still render with Tailwind + whatever the template provides */ }
    return deps;
};

/** Where execution actually starts. `providers/scaffold.js` always writes
 *  `src/main.tsx`; the search only exists so a hand-authored or future project shape
 *  fails into "best guess" rather than a hardcoded path that is quietly wrong. */
const ENTRY_CANDIDATES = ['src/main.tsx', 'src/main.ts', 'src/index.tsx', 'main.tsx', 'index.tsx'];
const resolveEntry = (projectFiles: Record<string, string>): string => {
    for (const candidate of ENTRY_CANDIDATES) if (candidate in projectFiles) return `/${candidate}`;
    const first = Object.keys(projectFiles).find(p => /\.tsx?$/.test(p));
    return first ? `/${first}` : '/src/main.tsx';
};

const SandpackAppPreview: React.FC<SandpackAppPreviewProps> = ({ files, title, className }) => {
    const entry = useMemo(() => resolveEntry(files), [files]);
    const sandpackFiles = useMemo(() => toSandpackFiles(files, title ?? 'Preview', entry), [files, title, entry]);
    const dependencies = useMemo(() => dependenciesFrom(files), [files]);

    return (
        <SandpackProvider
            template="react-ts"
            files={sandpackFiles}
            customSetup={{ entry, dependencies }}
            options={{ recompileMode: 'delayed', recompileDelay: 500 }}
            theme="dark"
        >
            <SandpackPreviewPane
                showNavigator={false}
                showOpenInCodeSandbox={false}
                /* Sandpack's own refresh control renders at 28×28 — below
                   DESIGN.md's 44px tap-target rule, and not ours to restyle.
                   Regenerating the build is the existing way to iterate; this
                   preview does not need a second, undersized one. */
                showRefreshButton={false}
                className={className}
            />
        </SandpackProvider>
    );
};

export default SandpackAppPreview;
