import { describe, it, expect } from 'vitest';
import { splitAtApprovalGate } from './toolSequence';

/**
 * A `runPython` call pauses the queue wherever it sits, not only when it is first — see
 * A3 item 3 in the plan. `hooks/useChat.ts`'s `runToolSequence` is the only caller; this
 * is the pure half of it, checkable without React, a model, or a server.
 *
 * The revert-proof case (see `test/generate.test.mjs`'s history — this exact scenario was
 * used to prove the old `[0]`-only behavior fails these assertions by name): reverting
 * `splitAtApprovalGate` to always pause on `calls[0]` fails every assertion here except
 * "a runPython call as the very first call still pauses before anything runs."
 */
describe('a runPython call pauses the queue wherever it sits, not only when first', () => {
    const first = { name: 'runPython', args: { code: 'print(1)' } };
    const middle = { name: 'updateFile', args: { path: 'a.ts' } };
    const last = { name: 'createFile', args: { path: 'b.ts' } };

    it('calls before the gate are queued to run immediately, in order', () => {
        const { before } = splitAtApprovalGate([middle, first, last], 'runPython');
        expect(before, JSON.stringify(before)).toEqual([middle]);
    });

    it('the runPython call itself is the pause point, wherever it sits', () => {
        const { paused } = splitAtApprovalGate([middle, first, last], 'runPython');
        expect(paused).toBe(first);
    });

    it('everything queued behind it survives as remaining — nothing is dropped', () => {
        const { remaining } = splitAtApprovalGate([middle, first, last], 'runPython');
        expect(remaining, JSON.stringify(remaining)).toEqual([last]);
    });

    it('a runPython call as the very first call still pauses before anything runs', () => {
        const result = splitAtApprovalGate([first, middle, last], 'runPython');
        expect(result, JSON.stringify(result)).toEqual({ before: [], paused: first, remaining: [middle, last] });
    });

    it('a sequence with no runPython call behaves exactly as a single-call sequence always did — nothing pauses', () => {
        const result = splitAtApprovalGate([middle, last], 'runPython');
        expect(result.paused).toBeUndefined();
        expect(result.before, JSON.stringify(result.before)).toEqual([middle, last]);
        expect(result.remaining).toEqual([]);
    });

    it('a queue of exactly one non-runPython call is unaffected — the revert-proof case', () => {
        const result = splitAtApprovalGate([middle], 'runPython');
        expect(result.paused).toBeUndefined();
        expect(result.before, JSON.stringify(result.before)).toEqual([middle]);
    });
});
