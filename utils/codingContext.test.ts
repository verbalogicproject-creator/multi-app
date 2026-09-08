import { describe, it, expect } from 'vitest';
import { typeErrorCodesFrom, diagnosticCodeDelta } from './codingContext';
import type { TypecheckResult } from '../types/diagnostics';

/**
 * The write side of "the ladder improves with use" (see the plan: "closing
 * the loop") lives client-side in `useChat.ts`, driven by these two pure
 * functions. `useChat.ts` itself needs a browser to exercise meaningfully;
 * this is the part of that logic a real test actually can cover, and the
 * part most load-bearing to get right — a wrong delta silently mis-teaches
 * the ladder, not just this one turn.
 */

const result = (diagnostics: TypecheckResult['diagnostics'], completed = true): TypecheckResult => ({
    revision: 1,
    completed,
    ok: diagnostics.length === 0,
    issues: [],
    diagnostics,
    truncated: false,
    checked: diagnostics.length,
    durationMs: 10,
});

const diag = (code: string) => ({ path: 'src/App.tsx', line: 1, col: 1, severity: 'error' as const, code, message: 'x' });

describe('typeErrorCodesFrom', () => {
    it('classifies TS1xxx and TS17xxx as syntax-error, everything else as type-error — same split typecheck/parse.js uses server-side', () => {
        const codes = typeErrorCodesFrom(result([diag('TS1005'), diag('TS17000'), diag('TS2322'), diag('TS2345')]));
        expect(codes).toEqual(new Set(['syntax-error', 'type-error']));
    });

    it('an empty, completed result is a real, comparable "clean" state, not null', () => {
        expect(typeErrorCodesFrom(result([]))).toEqual(new Set());
    });

    it('an incomplete run is unknown, not clean — must never be read as a fix', () => {
        expect(typeErrorCodesFrom(result([diag('TS2322')], false))).toBeNull();
        expect(typeErrorCodesFrom(null)).toBeNull();
    });
});

describe('diagnosticCodeDelta', () => {
    it('a code present before and absent after is resolved', () => {
        const { resolved, introduced } = diagnosticCodeDelta(new Set(['type-error']), new Set());
        expect(resolved).toEqual(['type-error']);
        expect(introduced).toEqual([]);
    });

    it('a code absent before and present after is introduced', () => {
        const { resolved, introduced } = diagnosticCodeDelta(new Set(), new Set(['syntax-error']));
        expect(resolved).toEqual([]);
        expect(introduced).toEqual(['syntax-error']);
    });

    it('a turn can fix one thing and break another in the same comparison', () => {
        const { resolved, introduced } = diagnosticCodeDelta(new Set(['type-error']), new Set(['syntax-error']));
        expect(resolved).toEqual(['type-error']);
        expect(introduced).toEqual(['syntax-error']);
    });

    it('no change is no signal', () => {
        const { resolved, introduced } = diagnosticCodeDelta(new Set(['type-error']), new Set(['type-error']));
        expect(resolved).toEqual([]);
        expect(introduced).toEqual([]);
    });

    it('either side missing means nothing to compare — never a false fix or false regression', () => {
        expect(diagnosticCodeDelta(null, new Set())).toEqual({ resolved: [], introduced: [] });
        expect(diagnosticCodeDelta(new Set(), null)).toEqual({ resolved: [], introduced: [] });
        expect(diagnosticCodeDelta(null, null)).toEqual({ resolved: [], introduced: [] });
    });
});
