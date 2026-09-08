/**
 * The forms a dropped declaration takes.
 *
 * `check:css` guards against a bare custom property sitting where a value belongs —
 * `accent-color: --color-accent`, which every engine discards, falling the property
 * back to the UA default. The detector that caught the original incident matched
 * exactly the shape that incident had, and a check that only recognizes one form of
 * a pattern reads as done while being blind: it matches nothing, reports `css ok`,
 * and exits 0 — byte-identical to a clean stylesheet.
 *
 * Two of the misses below were live in this repo's own `dist/assets` when they were
 * found: `!important` (9 occurrences) and a space before the semicolon (4). The
 * uppercase case is theoretical for minified output and covered anyway, because the
 * cost of an extra case here is one line and the cost of a missing one is a silent
 * pass.
 *
 * So this file is the enumeration, not a sample. Every form the pattern can take is
 * listed by name, and the negatives are listed too — a detector widened until it
 * flags `var(--x)` is not an improvement over one that flags nothing.
 */
import { describe, it, expect } from 'vitest';
import { findDroppedDeclarations, isDroppedDeclaration } from '../scripts/check-css.mjs';

const found = (css) => findDroppedDeclarations(css).map(({ prop, value }) => `${prop}:${value}`);

describe('findDroppedDeclarations — the forms it must catch', () => {
    it('catches the original incident: a bare custom property as the whole value', () => {
        expect(found('a{accent-color:--color-accent;}')).toEqual(['accent-color:--color-accent']);
    });

    it('catches a bare custom property carrying !important', () => {
        expect(found('a{accent-color:--color-accent!important;}')).toEqual(['accent-color:--color-accent']);
    });

    it('catches the last declaration in a rule, which has no trailing semicolon', () => {
        expect(found('a{accent-color:--color-accent}')).toEqual(['accent-color:--color-accent']);
    });

    it('catches a value padded with whitespace', () => {
        expect(found('a{accent-color: --color-accent ;}')).toEqual(['accent-color:--color-accent']);
    });

    it('catches an uppercase property name', () => {
        expect(found('a{ACCENT-COLOR:--color-accent;}')).toEqual(['ACCENT-COLOR:--color-accent']);
    });

    it('catches a bare custom property as the first value of a shorthand', () => {
        expect(found('a{border:--w solid red;}')).toEqual(['border:--w']);
    });

    it('catches several in one stylesheet, not just the first', () => {
        expect(found('a{color:--x;}b{fill:--y!important;}')).toEqual(['color:--x', 'fill:--y']);
    });
});

describe('findDroppedDeclarations — what it must leave alone', () => {
    it('leaves a custom-property declaration alone: `--a: --b` is a valid token stream', () => {
        expect(found('a{--brand:--color-accent;}')).toEqual([]);
    });

    it('leaves a properly wrapped var() alone', () => {
        expect(found('a{accent-color:var(--color-accent);}')).toEqual([]);
    });

    it('does not mistake a pseudo-selector for a declaration', () => {
        expect(found('a:hover{color:red;}')).toEqual([]);
    });

    it('does not mistake a media-query feature for a declaration', () => {
        expect(found('@media (min-width:640px){a{color:red;}}')).toEqual([]);
    });

    it('leaves an ordinary stylesheet alone', () => {
        expect(found('.btn{color:#fff;background:var(--bg);padding:0 .5rem}')).toEqual([]);
    });
});

describe('isDroppedDeclaration', () => {
    it('is the whole decision, so it can be checked without a build', () => {
        expect(isDroppedDeclaration('accent-color', '--x')).toBe(true);
        expect(isDroppedDeclaration('--accent-color', '--x')).toBe(false);
        expect(isDroppedDeclaration('accent-color', 'var(--x)')).toBe(false);
    });
});
