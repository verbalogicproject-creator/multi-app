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
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'dist/assets';
const files = readdirSync(DIR).filter(f => f.endsWith('.css'));
if (files.length === 0) {
    console.error('No built CSS in dist/assets — run `npm run build` first.');
    process.exit(1);
}

/** A declaration whose value starts with `--` and is not wrapped in var(). */
const BARE_CUSTOM_PROPERTY = /([a-z-]+)\s*:\s*(--[A-Za-z0-9_-]+)(?=[;}])/g;

let findings = 0;
for (const file of files) {
    const css = readFileSync(join(DIR, file), 'utf8');
    for (const [, prop, value] of css.matchAll(BARE_CUSTOM_PROPERTY)) {
        // Declaring a custom property is fine: `--a: --b` is a valid token stream.
        if (prop.startsWith('--')) continue;
        console.error(`${file}: ${prop}: ${value}  — needs var(${value}); browsers drop this`);
        findings++;
    }
}

if (findings > 0) {
    console.error(`\n${findings} dropped declaration(s). Use a theme utility (accent-metal-300) or var().`);
    process.exit(2);
}
console.log(`css ok — ${files.length} file(s), no dropped declarations`);
