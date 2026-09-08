import type { ProjectFile } from '../types/project';
import type { TscDiagnostic, TypecheckResult } from '../types/diagnostics';
import type { BuildIssue } from './validateBuild';

/**
 * What `useChat`'s `sendMessage` attaches to the open project for a coding-mode
 * turn — see A3 item 2. Pure and model-free on purpose: these are exactly the
 * strings that reach the prompt, and a summary that silently changed shape
 * should fail a test, not be noticed first in a live conversation.
 */

/** Every file path in the project, sorted — content stays behind `readFile`,
 *  paid for only when a turn actually needs it. */
export const fileTreeFrom = (files: ProjectFile[]): string[] =>
    files.map((f) => f.path).sort();

const MAX_DIAGNOSTICS_LISTED = 20;

/** `null` (never ran / not completed) and "ran, found nothing" are different
 *  facts — this returns `''` for the first, so `buildSystemPrompt` renders
 *  nothing rather than a false "no type errors". */
export const diagnosticsSummaryFrom = (result: TypecheckResult | null): string => {
    if (!result || !result.completed) return '';
    if (result.diagnostics.length === 0) return 'No type errors.';
    const listed = result.diagnostics.slice(0, MAX_DIAGNOSTICS_LISTED)
        .map((d: TscDiagnostic) => `${d.path}:${d.line}:${d.col} — ${d.code}: ${d.message}`)
        .join('\n');
    const remaining = result.diagnostics.length - MAX_DIAGNOSTICS_LISTED;
    return remaining > 0 ? `${listed}\n...and ${remaining} more.` : listed;
};

/** Same `null`-means-no-opinion contract as `previewVerdict` itself. */
export const previewSummaryFrom = (issues: BuildIssue[] | null): string => {
    if (issues === null) return '';
    if (issues.length === 0) return 'Builds and runs without error.';
    return issues.map((i) => `[${i.severity}] ${i.code}${i.file ? ` (${i.file})` : ''}: ${i.message}`).join('\n');
};

/**
 * The same TS1xxx/TS17xxx=syntax, TS2xxx+=type-error split `typecheck/parse.js`
 * already uses server-side (`memory/proposals.js`'s `PROPOSAL_TABLE`/
 * `PATTERN_TABLE` vocabulary) — ported here, not imported, since that module
 * lives in a server-only directory and this runs in the browser. Same regex,
 * same two buckets; a change to one has to be made to the other by hand, which
 * is an acceptable seam for two lines that have not moved in a long time.
 */
const SYNTAX_CODE = /^TS(1\d{3}|17\d{3})$/;

/** Which of the ladder's stable codes are present, not how many diagnostics —
 *  matching `PATTERN_TABLE`/`PROPOSAL_TABLE`'s own granularity (one entry per
 *  code, not per occurrence). `null`/incomplete reads as "unknown", not "clean"
 *  — the caller must not treat an unfinished typecheck as a resolved one. */
export const typeErrorCodesFrom = (result: TypecheckResult | null): Set<string> | null => {
    if (!result || !result.completed) return null;
    const codes = new Set<string>();
    for (const d of result.diagnostics) codes.add(SYNTAX_CODE.test(d.code) ? 'syntax-error' : 'type-error');
    return codes;
};

/**
 * Which codes disappeared (resolved) and which appeared (introduced) between
 * two reads of the same project. `null` on either side means "nothing to
 * compare" — a first-ever read has no "before", and an incomplete/cancelled
 * typecheck must not be read as either a fix or a regression.
 */
export const diagnosticCodeDelta = (
    before: Set<string> | null,
    after: Set<string> | null,
): { resolved: string[]; introduced: string[] } => {
    if (!before || !after) return { resolved: [], introduced: [] };
    const resolved = [...before].filter((c) => !after.has(c));
    const introduced = [...after].filter((c) => !before.has(c));
    return { resolved, introduced };
};
