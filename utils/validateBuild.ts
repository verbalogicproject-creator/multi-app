// Deterministic checks over a generated project. The model's claim that a build
// succeeded is never evidence: these run without any model call and decide
// whether a candidate may be promoted.

export interface BuildIssue {
    severity: 'error' | 'warning';
    file?: string;
    message: string;
}

export interface BuildValidation {
    ok: boolean;            // no errors (warnings are allowed)
    issues: BuildIssue[];
    checked: number;
}

const CODE_EXT = /\.(tsx|ts|jsx|js)$/i;
const RESOLVE_SUFFIXES = ['', '.tsx', '.ts', '.jsx', '.js', '.css', '.json', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

/** Lazy-output markers. Deliberately narrow: each must be unambiguous in real code. */
const PLACEHOLDER_PATTERNS: { re: RegExp; label: string }[] = [
    { re: /\/\/\s*\.\.\.\s*(rest|remaining|other|more)\b/i, label: 'an elided section ("// ... rest")' },
    { re: /\{\s*\/\*\s*\.\.\.\s*\*\/\s*\}/, label: 'an empty JSX placeholder ({/* ... */})' },
    { re: /\b(rest of the (code|implementation|file)|implementation (goes )?here|your code here|same as (above|before))\b/i, label: 'a "rest of the code" placeholder' },
    { re: /\/\/\s*TODO\b/i, label: 'a TODO comment' },
    { re: /\bLorem ipsum\b/i, label: 'lorem ipsum filler' },
];

/** Normalizes a path containing ./ and ../ segments. */
export const normalizePath = (input: string): string => {
    const parts = input.split('/');
    const out: string[] = [];
    for (const part of parts) {
        if (part === '' || part === '.') continue;
        if (part === '..') out.pop();
        else out.push(part);
    }
    return out.join('/');
};

const dirOf = (filePath: string): string => {
    const i = filePath.lastIndexOf('/');
    return i === -1 ? '' : filePath.slice(0, i);
};

/**
 * Characters after which a quote genuinely opens a string literal. In JSX text a
 * quote is just punctuation ("you're", "the books' covers"), and treating it as a
 * string opener makes the scanner swallow the rest of the file — which showed up
 * as a phantom "truncated" verdict on a complete, working component.
 */
const EXPRESSION_CONTEXT = new Set(['=', '(', ',', '[', '{', ':', ';', '?', '&', '|', '+', '!', '<', '>', '*', '/', '%', '^', '~', 'return']);

const opensString = (source: string, index: number): boolean => {
    for (let k = index - 1; k >= 0; k--) {
        const ch = source[k];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
        return EXPRESSION_CONTEXT.has(ch);
    }
    return true;   // start of file
};

/** Counts braces outside strings, comments and template literals. */
export const braceBalance = (source: string): number => {
    let depth = 0, i = 0;
    const n = source.length;
    while (i < n) {
        const c = source[i], next = source[i + 1];
        if (c === '/' && next === '/') { while (i < n && source[i] !== '\n') i++; continue; }
        if (c === '/' && next === '*') { i += 2; while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++; i += 2; continue; }
        if ((c === '"' || c === "'" || c === '`') && opensString(source, i)) {
            const quote = c; i++;
            while (i < n) {
                if (source[i] === '\\') { i += 2; continue; }
                if (source[i] === quote) { i++; break; }
                i++;
            }
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
    }
    return depth;
};

const extractRelativeImports = (source: string): string[] => {
    const specs: string[] = [];
    const patterns = [
        /\bfrom\s+['"]([^'"]+)['"]/g,
        /\bimport\s+['"]([^'"]+)['"]/g,
        /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(source)) !== null) {
            if (m[1].startsWith('./') || m[1].startsWith('../')) specs.push(m[1]);
        }
    }
    return specs;
};

const resolves = (files: Record<string, string>, fromFile: string, spec: string): boolean => {
    const base = normalizePath(`${dirOf(fromFile)}/${spec}`);
    return RESOLVE_SUFFIXES.some(suffix => Object.prototype.hasOwnProperty.call(files, base + suffix));
};

/** Local (non-URL, non-absolute-CDN) asset references from index.html. */
const extractHtmlRefs = (html: string): string[] => {
    const refs: string[] = [];
    let m: RegExpExecArray | null;
    const re = /\b(?:src|href)\s*=\s*["']([^"']+)["']/g;
    while ((m = re.exec(html)) !== null) {
        const ref = m[1];
        if (/^(https?:)?\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('#') || ref.startsWith('mailto:')) continue;
        refs.push(ref);
    }
    return refs;
};

export const validateBuild = (files: Record<string, string>, plan?: any): BuildValidation => {
    const issues: BuildIssue[] = [];
    const paths = Object.keys(files);
    const add = (severity: BuildIssue['severity'], message: string, file?: string) => issues.push({ severity, file, message });

    if (paths.length === 0) {
        return { ok: false, issues: [{ severity: 'error', message: 'The generator returned no files.' }], checked: 0 };
    }

    // Entry points
    if (!paths.some(p => p === 'index.html')) add('error', 'index.html is missing, so the app has no entry point.');
    if (!paths.some(p => /^src\/main\.(tsx|ts|jsx|js)$/.test(p))) add('warning', 'No src/main entry file was generated.');
    if (!files['preview.html']) add('warning', 'preview.html is missing, so the visual preview will be unavailable.');

    for (const [path, content] of Object.entries(files)) {
        const trimmed = (content ?? '').trim();

        if (trimmed.length === 0) { add('error', 'File is empty.', path); continue; }
        if (trimmed.length < 20 && CODE_EXT.test(path)) add('warning', 'File looks too short to be complete.', path);

        // JSON must parse
        if (path.endsWith('.json')) {
            try { JSON.parse(content); }
            catch (e: any) { add('error', `Invalid JSON: ${e.message}`, path); }
        }

        // Lazy output
        for (const { re, label } of PLACEHOLDER_PATTERNS) {
            if (re.test(content)) { add('error', `Contains ${label} instead of real code.`, path); break; }
        }

        if (CODE_EXT.test(path)) {
            const depth = braceBalance(content);
            if (depth !== 0) {
                add('error', `Unbalanced braces (${depth > 0 ? `${depth} unclosed` : `${-depth} extra closing`}) — the file looks truncated.`, path);
            }
            for (const spec of extractRelativeImports(content)) {
                if (!resolves(files, path, spec)) add('error', `Imports "${spec}", which was not generated.`, path);
            }
        }
    }

    if (files['index.html']) {
        for (const ref of extractHtmlRefs(files['index.html'])) {
            const clean = normalizePath(ref.replace(/^\//, ''));
            const exists = RESOLVE_SUFFIXES.some(s => Object.prototype.hasOwnProperty.call(files, clean + s));
            if (!exists && !/\.(ico|png|svg|jpg|webp)$/i.test(clean)) {
                add('error', `index.html references "${ref}", which was not generated.`, 'index.html');
            }
        }
    }

    // Did the build deliver what the approved plan promised?
    const allPaths = paths.join('\n');
    for (const page of Array.isArray(plan?.pages) ? plan.pages : []) {
        if (page?.name && !allPaths.includes(page.name)) add('warning', `The plan included a "${page.name}" page, but no matching file was generated.`);
    }
    for (const component of Array.isArray(plan?.components) ? plan.components : []) {
        if (component?.name && !allPaths.includes(component.name)) add('warning', `The plan included a "${component.name}" component, but no matching file was generated.`);
    }

    return { ok: !issues.some(i => i.severity === 'error'), issues, checked: paths.length };
};
