import { defineConfig } from 'vitest/config';

/**
 * Separate from `vite.config.ts` on purpose: these tests are Node-environment pure logic
 * (provider prompts/schemas, the memory bridge, auth config), not browser components — the
 * React plugin and Tailwind's PostCSS pipeline that file configures have nothing to verify
 * here. The CDP/browser-driven and live-model checks stay outside Vitest entirely (see
 * `AGENTS.md`'s Testing Guidelines) — they spawn a real Chrome via `scripts/ui-harness.mjs`
 * or hit a live provider, which is a different kind of check with a different cost, not
 * something to fold into a `test` run that should stay fast and free.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.mjs', '**/*.test.ts', '**/*.test.js'],
        exclude: ['node_modules/**', 'dist/**', '.preview-work/**'],
    },
});
