/**
 * Parsing `tsc --noEmit --pretty false` output.
 *
 * Pure and dependency-free, for the same reason `utils/validateBuild.ts` is: it is
 * the piece worth asserting against, and a `spawn` anywhere near it would end that.
 * The runner is next door in `runner.js`.
 */

/** `src/App.tsx(3,94): error TS2322: Type 'x' is not assignable to type 'y'.` */
const LINE_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.*)$/;

/**
 * @typedef {Object} TscDiagnostic
 * @property {string} path   project-relative, as tsc reports it
 * @property {number} line   1-indexed
 * @property {number} col    1-indexed
 * @property {'error'|'warning'} severity
 * @property {string} code   e.g. 'TS2322'
 * @property {string} message
 */

/**
 * @param {string} output raw stdout from tsc
 * @returns {TscDiagnostic[]}
 */
export const parseTsc = (output) => {
    /** @type {TscDiagnostic[]} */
    const out = [];
    for (const raw of String(output ?? '').split(/\r?\n/)) {
        /* An elaborated diagnostic continues onto following indented lines. Measured
           on 5.9.3: a cross-file TS2322 really does produce one, so this branch is
           not defensive programming — it is the difference between "Type X is not
           assignable to type Y" and knowing which property disagreed. */
        if (/^\s/.test(raw) && out.length) {
            const trimmed = raw.trim();
            if (trimmed) out[out.length - 1].message += '\n' + trimmed;
            continue;
        }
        const m = LINE_RE.exec(raw);
        if (!m) continue;
        const [, path, line, col, severity, code, message] = m;
        out.push({
            path,
            line: Number(line),
            col: Number(col),
            severity: /** @type {'error'|'warning'} */ (severity),
            code: 'TS' + code,
            message,
        });
    }
    return out;
};

/** `Cannot find module 'react-router-dom' or its corresponding type declarations.` */
const MODULE_RE = /Cannot find module '([^']+)'/;

/**
 * The package a bare specifier belongs to: `@scope/pkg/sub` → `@scope/pkg`,
 * `react-dom/client` → `react-dom`. Returns null for a relative or absolute path.
 * @param {string} specifier
 * @returns {string | null}
 */
export const packageOf = (specifier) => {
    if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return null;
    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/**
 * Drop the `TS2307`s that are not the model's fault.
 *
 * With the scratch tree inside the repo, `react` and friends resolve against our own
 * `node_modules`, so a surviving "cannot find module" means one of two things. Either
 * the model imported a package it never declared — worth saying — or it declared one
 * we simply have not installed, which is the user's `npm install` and not a defect in
 * the generated code. Only the first kind is kept.
 *
 * This is a choice, not a law: the alternative is reporting both and letting the
 * reader sort it out. It is made this way because these diagnostics also become
 * `type-error` verdicts, and a verdict the model cannot act on teaches it nothing.
 *
 * @param {TscDiagnostic[]} diagnostics
 * @param {Set<string>} declared package names from the generated package.json
 * @returns {TscDiagnostic[]}
 */
export const dropDeclaredMissingModules = (diagnostics, declared) =>
    diagnostics.filter((d) => {
        if (d.code !== 'TS2307') return true;
        const m = MODULE_RE.exec(d.message);
        if (!m) return true;
        const pkg = packageOf(m[1]);
        return pkg === null || !declared.has(pkg);
    });

/**
 * Every dependency the generated package.json names, in one set.
 * @param {string | undefined} packageJson raw file content
 * @returns {Set<string>}
 */
export const declaredPackages = (packageJson) => {
    const names = new Set();
    if (!packageJson) return names;
    let parsed;
    try {
        parsed = JSON.parse(packageJson);
    } catch {
        return names;   // invalid-json is already its own validator code
    }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        const block = parsed?.[field];
        if (block && typeof block === 'object') for (const name of Object.keys(block)) names.add(name);
    }
    return names;
};

/**
 * tsc diagnostics → the shape `utils/validateBuild.ts` already speaks.
 *
 * One `BuildIssue` per diagnostic, all carrying the same stable code. The TS number
 * lives in the message, not in the code: `memory/proposals.js` keys on the code, and
 * one row per TS error number would be a table nobody could maintain.
 *
 * @param {TscDiagnostic[]} diagnostics
 * @returns {{severity: 'error'|'warning', code: 'type-error', file: string, message: string}[]}
 */
export const toBuildIssues = (diagnostics) =>
    diagnostics.map((d) => ({
        severity: 'error',
        code: 'type-error',
        file: d.path,
        message: `${d.code}: ${d.message.split('\n')[0]} (${d.line}:${d.col})`,
    }));
