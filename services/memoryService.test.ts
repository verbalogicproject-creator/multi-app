import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { closeEpisode, record, openEpisode, newBuildId } from './memoryService';

/**
 * Guards the actual fix for a measured defect: a real architecture audit found
 * 23 real generation calls logged by the server's own quota counter on one day,
 * against only 2 episodes ever recorded in memory that day. `closeEpisode` and
 * `record` are fire-and-forget by design — the caller never awaits them — so a
 * `fetch` without `keepalive: true` is free to be aborted by the browser the
 * moment the page/component that started it goes away (a reset, a navigation,
 * an unmount). This test proves every write-shaped call opts into `keepalive`,
 * not just that it currently does — reverting the fix must make this fail.
 */
describe('memoryService write calls survive their own caller moving on', () => {
    const buildId = newBuildId();
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn(async () => new Response(JSON.stringify({ episodeId: 'ep-1' }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('closeEpisode sends keepalive:true', () => {
        closeEpisode(buildId, 'ep-1', 'verified');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, options] = fetchMock.mock.calls[0];
        expect(options.keepalive).toBe(true);
    });

    it('record sends keepalive:true', () => {
        record(buildId, 'ep-1', [{ kind: 'verification.completed', payload: { ok: true } }]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, options] = fetchMock.mock.calls[0];
        expect(options.keepalive).toBe(true);
    });

    it('openEpisode (awaited, not fire-and-forget) also sends keepalive:true for consistency', async () => {
        await openEpisode(buildId, 'plan a web application: test');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, options] = fetchMock.mock.calls[0];
        expect(options.keepalive).toBe(true);
    });
});
