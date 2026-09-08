import { describe, it, expect } from 'vitest';
import { applyPatch } from './patchFile';

/**
 * `patchFile` refuses an ambiguous or absent match, by name — the same contract `Edit`
 * (the tool that wrote this file) already enforces. See A3 item 4 in the plan: content-
 * anchored rather than line-anchored on purpose, since a line-range edit drifts the moment
 * an earlier tool call in the same multi-call sequence changes the file's line count.
 */
describe('patchFile refuses an ambiguous or absent match, by name', () => {
    it('a unique match patches cleanly', () => {
        const result = applyPatch('const x = 1;\nconst y = 2;', 'const x = 1;', 'const x = 100;');
        expect(result, JSON.stringify(result)).toEqual({ ok: true, content: 'const x = 100;\nconst y = 2;' });
    });

    it('an absent match fails by name, not silently', () => {
        const result = applyPatch('const x = 1;', 'const z = 9;', 'const z = 10;');
        expect(result.ok, JSON.stringify(result)).toBe(false);
        expect(!result.ok && /does not appear/i.test(result.error)).toBe(true);
    });

    it('a match appearing twice is refused rather than guessed at', () => {
        const result = applyPatch('foo();\nfoo();', 'foo();', 'bar();');
        expect(result.ok, JSON.stringify(result)).toBe(false);
        expect(!result.ok && /more than once/i.test(result.error)).toBe(true);
    });

    it('an empty find is refused rather than matching everywhere', () => {
        const result = applyPatch('anything', '', 'x');
        expect(result.ok, JSON.stringify(result)).toBe(false);
        expect(!result.ok && /must not be empty/i.test(result.error)).toBe(true);
    });
});
