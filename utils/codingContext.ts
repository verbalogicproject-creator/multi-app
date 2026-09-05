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
