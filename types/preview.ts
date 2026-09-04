/**
 * What the preview route answers, and what the running document says back.
 *
 * Three layers, because a preview fails in three ways that look identical from the
 * outside — a blank white rectangle — and are three different bugs:
 *
 *   1. `PreviewBuildError`      the bundle failed; no document was ever produced
 *   2. `PreviewRuntimeError`    the app threw once it was running
 *   3. `PreviewRendered.empty`  it ran, it threw nothing, and it drew nothing
 */

/** One esbuild diagnostic, flattened. `file` is project-relative when it is known. */
export interface PreviewBuildError {
    text: string;
    file: string | null;
    line: number | null;
    column: number | null;
    detail: string | null;
}

export interface PreviewBuildOk {
    ok: true;
    /** One self-contained document: inlined styles, inlined classic script, no fetches. */
    html: string;
    entry: string;
    bytes: number;
    /** The stylesheet compiled, but not cleanly. The app still renders — unstyled. */
    styleError: string | null;
    stylesheet: string | null;
    candidates: number;
    durationMs: number;
}

export interface PreviewBuildFailed {
    ok: false;
    errors: PreviewBuildError[];
    durationMs: number;
}

export type PreviewBuildResult = PreviewBuildOk | PreviewBuildFailed;

/** The tag the document's harness stamps on every message. Anything else is not ours. */
export const PREVIEW_MARK = 'multi-app-preview';

export interface PreviewRuntimeError {
    __preview: typeof PREVIEW_MARK;
    type: 'runtime-error';
    message: string;
    rejection?: boolean;
    file?: string | null;
    line?: number | null;
    column?: number | null;
    stack?: string | null;
}

export interface PreviewRendered {
    __preview: typeof PREVIEW_MARK;
    type: 'rendered';
    /**
     * Nothing mounted. Evidence of a dead app, but its inverse is *not* evidence of a
     * live one: a layout shell can render while the content area stays empty.
     */
    empty: boolean;
    hasRoot: boolean;
}

export type PreviewMessage = PreviewRuntimeError | PreviewRendered;
