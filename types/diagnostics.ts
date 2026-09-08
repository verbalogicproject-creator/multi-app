import type { BuildIssue } from '../utils/validateBuild';

/** One diagnostic as `tsc` reports it. Line and column are 1-indexed, as tsc prints them. */
export interface TscDiagnostic {
    /** Project-relative, matching `ProjectFile.path`. */
    path: string;
    line: number;
    col: number;
    severity: 'error' | 'warning';
    /** e.g. `TS2322`. The stable *validator* code is always `type-error`; this is finer. */
    code: string;
    message: string;
}

/** What `POST /api/typecheck` answers. */
export interface TypecheckResult {
    /** Echoed back untouched. The client decides whether its buffer has moved on. */
    revision: number | null;
    /**
     * Whether the compiler actually finished. A run cancelled by a newer revision, or
     * cut off by the timeout, reports `completed: false` — and `ok` means nothing at
     * all in that case. Read this first: an unfinished compile produces zero
     * diagnostics, which is byte-identical to a clean project.
     */
    completed: boolean;
    ok: boolean;
    issues: BuildIssue[];
    diagnostics: TscDiagnostic[];
    /** The compiler was cut short, or there were more diagnostics than are worth listing. */
    truncated: boolean;
    checked: number;
    durationMs: number;
}
