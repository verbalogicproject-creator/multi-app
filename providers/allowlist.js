/**
 * The packages a generated app may import, and the reason there is a list at all.
 *
 * `preview/bundle.js` resolves bare specifiers against **multi-app's own** `node_modules`,
 * so the set of packages a generated app can actually run is the set multi-app has
 * installed. That was never written down, and the consequences compounded:
 *
 *  - nothing told the model which packages were permitted, so it reached for whatever a
 *    designed product normally uses — an icon library, above all;
 *  - `packageJsonFor` declared whatever it imported, at `latest`;
 *  - and all three judges then agreed to ignore the failure, each for a good reason,
 *    because each of them treated **declared** as meaning "the environment's problem".
 *
 * The result was a build that passed every check and could not be rendered, printing
 * "Passed all N file checks" directly above a preview showing the bundle error.
 *
 * So the rule is inverted here: a package is the environment's problem only if it is on
 * this list — meaning the preview is supposed to have it and something has gone wrong
 * locally. A package that is *not* on this list is the model's problem, because the
 * generate prompt names the list and asks it to stay inside.
 *
 * **Adding to this list is two steps, and both are required**: add the name here, and
 * `npm install` it into multi-app. `check:generate` asserts the two agree, because a name
 * here without an install recreates exactly the fault this file exists to prevent.
 */

/** Always present: the scaffold writes these into every project. */
export const BASE_PACKAGES = ['react', 'react-dom', 'react-router-dom'];

/**
 * The optional set, and what each is for.
 *
 * Chosen to cover what a product at the Lovable/Bolt bar actually needs rather than to be
 * generous: icons, charts, client state, dates, class composition, forms, validation and
 * motion. Anything outside this is not a judgement about the package — it is a statement
 * that the preview cannot run it today.
 */
export const OPTIONAL_PACKAGES = {
    'lucide-react': 'icons',
    recharts: 'charts',
    zustand: 'client state beyond hooks',
    'date-fns': 'date formatting and arithmetic',
    clsx: 'conditional class names',
    'tailwind-merge': 'resolving conflicting Tailwind classes',
    'react-hook-form': 'forms',
    zod: 'schema validation',
    'framer-motion': 'animation',
};

/** Every package the preview is expected to resolve. */
export const PREVIEW_PACKAGES = new Set([...BASE_PACKAGES, ...Object.keys(OPTIONAL_PACKAGES)]);

/**
 * Node built-ins and compiler-injected specifiers are not dependencies.
 *
 * `react/jsx-runtime` is emitted by `jsx: react-jsx` rather than written by anyone, and a
 * `node:` specifier in browser code is its own error — reported as an unresolved import,
 * not laundered through this list.
 */
export const isNotADependency = (spec) => spec === 'react/jsx-runtime' || spec.startsWith('node:');

/** The package a specifier belongs to: `@scope/pkg/sub` and `pkg/sub` both resolve to their package. */
export const packageOf = (spec) => {
    if (!spec || spec.startsWith('.') || spec.startsWith('/')) return null;
    const parts = spec.split('/');
    return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/** Whether the preview is supposed to be able to resolve this specifier. */
export const isAvailable = (spec) => {
    const pkg = packageOf(spec);
    return pkg !== null && PREVIEW_PACKAGES.has(pkg);
};

/** The line the generate prompt uses, so the prompt and the list cannot drift apart. */
export const allowlistInstruction = () => {
    const optional = Object.entries(OPTIONAL_PACKAGES)
        .map(([name, why]) => `  - ${name} — ${why}`)
        .join('\n');
    return `Dependencies: you may import React, react-dom and react-router-dom, and these and nothing else:
${optional}
Any other package will fail to load and the build will be rejected. If you need something not on this list, write it yourself — an inline SVG instead of an icon package, a hand-rolled hook instead of a utility library.`;
};
