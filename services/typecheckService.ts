import type { TypecheckResult } from '../types/diagnostics';

/**
 * The client's only route to the typechecker.
 *
 * Answers `null` rather than throwing, in the same spirit as `memoryService`: a
 * compiler that is unreachable should cost you squiggles, never the editor you were
 * typing in. Callers treat `null` as "no opinion", not as "no errors".
 */

/** Comfortably past the server's own 20 s bound, so the server's answer wins the race. */
const TIMEOUT_MS = 25_000;

export const runTypecheck = async (
    projectId: string,
    files: Record<string, string>,
    revision: number,
    signal?: AbortSignal,
): Promise<TypecheckResult | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    /* A caller-supplied signal (a newer revision, or an unmounting view) aborts this
       one too, which is what lets the server see the disconnect and kill its child. */
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    try {
        const response = await fetch('/api/typecheck', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, revision, files }),
            signal: controller.signal,
        });
        if (!response.ok) return null;
        return (await response.json()) as TypecheckResult;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
};
