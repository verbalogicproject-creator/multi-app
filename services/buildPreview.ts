import type { PreviewBuildResult } from '../types/preview';

/**
 * The client's only route to the preview bundler.
 *
 * Answers `null` rather than throwing, matching `typecheckService` and
 * `memoryService`: a bundler that is unreachable should cost you the preview, never
 * the screen you were looking at. `null` means "no opinion" — distinct from an
 * `ok: false` answer, which is the bundler having a very specific opinion.
 */

/** Past the server's own 20 s bundling bound, so the server's answer wins the race. */
const TIMEOUT_MS = 25_000;

export const buildPreview = async (
    projectId: string,
    files: Record<string, string>,
    signal?: AbortSignal,
): Promise<PreviewBuildResult | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    try {
        const response = await fetch('/api/preview/build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, files }),
            signal: controller.signal,
        });
        if (!response.ok) return null;
        return (await response.json()) as PreviewBuildResult;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
};
