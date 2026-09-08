import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectFile } from '../types/index';
import type { TscDiagnostic } from '../types/diagnostics';
import { runTypecheck } from '../services/typecheckService';

/**
 * Type diagnostics for a project, kept honest about staleness.
 *
 * The compiler answers about the text it was sent. By the time it answers, the buffer
 * may have moved, and offsets computed from old line numbers will underline the wrong
 * tokens with total confidence — the failure that passes review while being wrong.
 * Two mechanisms guard it, and both are load-bearing:
 *
 * 1. **A revision counter.** Every mutation bumps it, every request carries it, and a
 *    response whose revision is no longer current is dropped on arrival.
 * 2. **Clearing on change.** The moment the project changes, the previous answer stops
 *    being displayed. This is what makes a stale squiggle *disappear* rather than
 *    slide onto whatever text now occupies those coordinates.
 *
 * The second is the one worth protecting: without it the revision guard still prevents
 * a *wrong* update from landing, but the *previous* update stays on screen, decorating
 * text it was never about.
 */

/** Trailing debounce. Saves arrive in bursts; the compiler costs seconds, not milliseconds. */
const DEBOUNCE_MS = 500;

export interface DiagnosticsState {
    /** Keyed by `ProjectFile.path`. Empty while a run is in flight, by design. */
    byFile: Map<string, TscDiagnostic[]>;
    all: TscDiagnostic[];
    status: 'idle' | 'checking' | 'ready' | 'unavailable';
    truncated: boolean;
    /** How long the last completed run took, for the panel to be honest about. */
    durationMs: number | null;
}

const EMPTY: DiagnosticsState = {
    byFile: new Map(),
    all: [],
    status: 'idle',
    truncated: false,
    durationMs: null,
};

export const useDiagnostics = (projectId: string, files: ProjectFile[]): DiagnosticsState => {
    const [state, setState] = useState<DiagnosticsState>(EMPTY);

    /* The payload, and the thing whose change means "check again". Built from content,
       not from object identity: every save mints new `ProjectFile` objects, and
       re-running on identity would mean re-running when nothing textual moved. */
    const record = useMemo(() => {
        const out: Record<string, string> = {};
        for (const file of files) out[file.path] = file.content;
        return out;
    }, [files]);
    const signature = useMemo(() => JSON.stringify(record), [record]);

    const revisionRef = useRef(0);

    useEffect(() => {
        revisionRef.current += 1;
        const revision = revisionRef.current;

        if (!projectId || Object.keys(record).length === 0) {
            setState(EMPTY);
            return;
        }

        /* Whatever is on screen described the previous text. Retract it now, before
           the new answer exists — an empty panel is honest, a stale squiggle is not. */
        setState(previous => ({ ...previous, byFile: new Map(), all: [], status: 'checking' }));

        const controller = new AbortController();
        const timer = setTimeout(async () => {
            const result = await runTypecheck(projectId, record, revision, controller.signal);
            /* Arrived late: the project has moved on and this answer is about text
               that no longer exists. */
            if (revision !== revisionRef.current) return;
            /* No response, or a compile that never finished. Both are "no answer",
               and neither is "no errors" — an unfinished run returns zero diagnostics,
               which would otherwise render as a clean project. */
            if (!result || !result.completed) {
                setState({ ...EMPTY, status: 'unavailable' });
                return;
            }
            const byFile = new Map<string, TscDiagnostic[]>();
            for (const diagnostic of result.diagnostics) {
                const list = byFile.get(diagnostic.path);
                if (list) list.push(diagnostic);
                else byFile.set(diagnostic.path, [diagnostic]);
            }
            setState({
                byFile,
                all: result.diagnostics,
                status: 'ready',
                truncated: result.truncated,
                durationMs: result.durationMs,
            });
        }, DEBOUNCE_MS);

        return () => {
            clearTimeout(timer);
            /* Aborting reaches the server, which kills the compiler it started. */
            controller.abort();
        };
        // `record` is rebuilt whenever `files` changes identity; `signature` is what
        // says whether that change was textual. Keying on it is what stops a save
        // that changed nothing from costing a compile.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, signature]);

    return state;
};

/** Diagnostics for one file, stable enough to hand to an effect dependency. */
export const useFileDiagnostics = (state: DiagnosticsState, path: string | undefined): TscDiagnostic[] => {
    const forFile = path ? state.byFile.get(path) : undefined;
    return useMemo(() => forFile ?? [], [forFile]);
};

/** A per-file error count for the file tree, without exposing the whole map. */
export const useErrorCounts = (state: DiagnosticsState): Map<string, number> => {
    const { byFile } = state;
    return useMemo(() => {
        const counts = new Map<string, number>();
        for (const [path, list] of byFile) counts.set(path, list.length);
        return counts;
    }, [byFile]);
};

export const noDiagnostics = EMPTY;
