#!/usr/bin/env node
/**
 * Catches CSS that a build emits happily and a browser silently drops.
 *
 * Written because `accent-[--color-accent]` compiled to
 * `accent-color: --color-accent` — a bare custom property where a value
 * belongs, which is invalid, dropped by every engine, and therefore falls back
 * to the UA default. It shipped as a blue slider in an app with no blue in it.
 *
 * Nothing caught it: typecheck passes (it is a string), the build passes (it is
 * valid Tailwind syntax), the design detector passes (it is not a known hue),
 * and the legacy-hue grep passes (the old class really was gone). Verifying an
 * absence is not the same as verifying a presence.
 *
 * The detector then repeated that mistake one level up. It was a single regex
 * requiring the value to be followed immediately by `;` or `}`, which covered
 * the one form the original bug happened to take and nothing else — `!important`,
 * trailing whitespace, an uppercase property, and a shorthand's first value all
 * walked straight through it. Two of those four are present in this repo's own
 * built CSS. A detector that matches nothing and a stylesheet with nothing to
 * find produce the same output: `css ok`, exit 0. So the check read as done
 * while being blind, which is the failure it exists to catch.
 *
 * The fix is the split below: capture declarations broadly, judge them with a
 * pure predicate, and enumerate the forms in `test/check-css.test.mjs` rather
 * than trusting one regex to have thought of all of them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Any `prop: value` pair terminated by `;` or `}`. Deliberately loose — it also
 * matches things that are not declarations (a `min-width:640px` inside a media
 * query, say). Filtering that here would mean parsing CSS; instead the predicate
 * below is narrow enough that a non-declaration can never satisfy it, and the
 * tests pin that. A pseudo-selector (`a:hover{`) cannot match at all: the value
 * would have to be followed by `{`.
 */
const DECLARATION = /([\w-]+)\s*:\s*([^;{}]+)(?=[;}])/g;

/** The first token of a value — what the browser reads before anything modifies it. */
const firstToken = (value) => value.trim().split(/[\s,)!]/)[0];

/**
 * True when a declaration's value *begins* with a bare custom property.
 *
 * "Begins with" rather than "is", because `border: --w solid red` is dropped for
 * exactly the same reason as `accent-color: --w` — the browser fails to parse the
 * value and discards the whole declaration.
 */
export const isDroppedDeclaration = (prop, value) => {
    // Declaring a custom property is fine: `--a: --b` is a valid token stream.
    if (prop.startsWith('--')) return false;
    return /^--[\w-]+$/.test(firstToken(value));
};

/** Every dropped declaration in a stylesheet, as `{prop, value}`. */
export const findDroppedDeclarations = (css) =>
    [...css.matchAll(DECLARATION)]
        .map(([, prop, value]) => ({ prop, value: firstToken(value) }))
        .filter(({ prop, value }) => isDroppedDeclaration(prop, value));

const main = () => {
    const DIR = 'dist/assets';
    const files = readdirSync(DIR).filter(f => f.endsWith('.css'));
    if (files.length === 0) {
        console.error('No built CSS in dist/assets — run `npm run build` first.');
        process.exit(1);
    }

    let findings = 0;
    for (const file of files) {
        for (const { prop, value } of findDroppedDeclarations(readFileSync(join(DIR, file), 'utf8'))) {
            console.error(`${file}: ${prop}: ${value}  — needs var(${value}); browsers drop this`);
            findings++;
        }
    }

    if (findings > 0) {
        console.error(`\n${findings} dropped declaration(s). Use a theme utility (accent-metal-300) or var().`);
        process.exit(2);
    }
    console.log(`css ok — ${files.length} file(s), no dropped declarations`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
