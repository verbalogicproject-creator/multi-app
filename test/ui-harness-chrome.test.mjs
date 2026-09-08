/**
 * Which Chromium the CDP gates actually run against is a load-bearing fact, not a detail.
 *
 * `scripts/ui-harness.mjs` resolved it from two hardcoded `/root/.cache/ms-playwright`
 * paths — this device's PRoot layout. Correct here, and non-existent on any CI runner, so
 * `audit:ui` / `check:editor` / `check:preview` / `check:pipeline` could only ever run on
 * one machine. Four of the repo's strongest gates were structurally un-runnable in CI, and
 * nothing said so: `findChrome()` exits 1 with a clear message, which reads like a missing
 * dependency rather than an architectural limit.
 *
 * `CHROME_PATH` lifts that, and introduces a sharper hazard in its place. If an override
 * that does not resolve quietly fell through to the hardcoded candidates, a run could pass
 * against a browser nobody named — green, on the wrong instrument. This whole harness
 * exists to stop "every judge that reads the code passed a build that does not run"; a
 * silently-substituted browser is the same failure wearing a different hat. So a declared
 * `CHROME_PATH` that is missing is an error, never a fall-through, and that is asserted
 * here by name.
 *
 * Pure: no browser, no filesystem, no process exit. `resolveChrome` takes its `env` and
 * its `exists` probe as arguments precisely so the decision can be checked without the
 * instrument whose misconfiguration it exists to catch.
 */
import { describe, it, expect } from 'vitest';
import { resolveChrome } from '../scripts/ui-harness.mjs';

const CANDIDATE = '/root/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const never = () => false;
const only = (...paths) => (p) => paths.includes(p);

describe('resolveChrome', () => {
    it('CHROME_PATH wins over the hardcoded candidates', () => {
        const { path, error } = resolveChrome({
            env: { CHROME_PATH: '/opt/chrome' },
            exists: only('/opt/chrome', CANDIDATE),
        });
        expect(error).toBeUndefined();
        expect(path).toBe('/opt/chrome');
    });

    it('a CHROME_PATH that does not resolve is an error, never a fall-through', () => {
        const { path, error } = resolveChrome({
            env: { CHROME_PATH: '/opt/missing' },
            exists: only(CANDIDATE),   // a candidate IS present; it must not be used
        });
        expect(path).toBeUndefined();
        expect(error).toMatch(/CHROME_PATH/);
        expect(error).toMatch(/\/opt\/missing/);
    });

    it('falls back to the hardcoded candidates when CHROME_PATH is unset', () => {
        const { path, error } = resolveChrome({ env: {}, exists: only(CANDIDATE) });
        expect(error).toBeUndefined();
        expect(path).toBe(CANDIDATE);
    });

    it('names CHROME_PATH as the remedy when nothing is found at all', () => {
        const { path, error } = resolveChrome({ env: {}, exists: never });
        expect(path).toBeUndefined();
        expect(error).toMatch(/No Chromium found/);
        expect(error).toMatch(/CHROME_PATH/);
    });
});
