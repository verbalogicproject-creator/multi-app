/**
 * `repairIfNeeded` (server.js) mutates a single file record across repair rounds and
 * only ever asks, per file, "did this one get better?" — never "is the whole project
 * better than where it started?" A real build proved the gap: 47 aggregate errors,
 * one round down to some intermediate count, a second round back up to 61 — and 61
 * was what shipped as the candidate.
 *
 * This fixture reconstructs exactly that shape with `createBestTracker` standing in
 * for the outer loop, and asserts the tracker always recovers the best snapshot ever
 * seen rather than whatever the loop happened to end on.
 */
import { describe, it, expect } from 'vitest';
import { createBestTracker } from './repairGate.js';

describe('createBestTracker', () => {
    it('recovers the best-ever aggregate state when the final round is worse (47 -> 12 -> 61)', () => {
        const record = { 'src/App.tsx': 'v0-app', 'src/data.ts': 'v0-data' };
        const tracker = createBestTracker({ errors: 47, files: record, keptFiles: [] });

        // Round 1: repair improves the aggregate, 47 -> 12. Mutate `record` the way
        // the real loop does (in place) before telling the tracker about it.
        record['src/App.tsx'] = 'v1-app-fixed';
        tracker.consider(12, record, ['src/App.tsx']);

        // Round 2: repair makes the aggregate worse, 12 -> 61 — the scenario the real
        // build hit. The loop still mutates `record` to this worse state before it
        // notices and stops.
        record['src/data.ts'] = 'v2-data-broken';
        tracker.consider(61, record, ['src/App.tsx', 'src/data.ts']);

        // The loop exits holding the round-2 (61-error) state as `current`/`finalErrors`.
        const finalErrors = 61;
        const outcome = tracker.resolve(record, finalErrors);

        expect(outcome.postRepairErrors, 'must report the best-ever count (12), not the worse final count (61)').toBe(12);
        expect(outcome.reverted, 'must flag that it fell back from the final state').toBe(true);
        expect(record['src/App.tsx'], 'the round-1 fix must survive the restore').toBe('v1-app-fixed');
        expect(record['src/data.ts'], 'the round-2 regression must be rolled back').toBe('v0-data');
        expect(outcome.postRepairErrors, 'postRepairErrors must never exceed preRepairErrors').toBeLessThanOrEqual(47);
    });

    it('falls all the way back to the pre-repair state when every round makes things worse', () => {
        const record = { 'src/App.tsx': 'v0-app' };
        const tracker = createBestTracker({ errors: 47, files: record, keptFiles: [] });

        record['src/App.tsx'] = 'v1-app-worse';
        tracker.consider(61, record, ['src/App.tsx']);

        const outcome = tracker.resolve(record, 61);

        expect(outcome.postRepairErrors).toBe(47);
        expect(outcome.reverted).toBe(true);
        expect(record['src/App.tsx']).toBe('v0-app');
    });

    it('keeps the final state untouched when the loop ends on its best point', () => {
        const record = { 'src/App.tsx': 'v0-app' };
        const tracker = createBestTracker({ errors: 47, files: record, keptFiles: [] });

        record['src/App.tsx'] = 'v1-app-fixed';
        tracker.consider(3, record, ['src/App.tsx']);

        const outcome = tracker.resolve(record, 3);

        expect(outcome.postRepairErrors).toBe(3);
        expect(outcome.reverted).toBe(false);
        expect(record['src/App.tsx']).toBe('v1-app-fixed');
    });
});
