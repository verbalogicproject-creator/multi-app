/**
 * `/api/preview/build` — the route that turns a generated project into a running app.
 *
 * Mounted alongside `/api/typecheck`, ahead of the SPA fallback, for the same reason:
 * whether the preview is available should be a fact the UI can read, not something a
 * request discovers by being answered with `index.html`.
 *
 * A build that fails is a **200 with `ok: false`**, not an HTTP error. The client has
 * something to render either way — a list of build errors is the useful answer to
 * "why is the pane empty", and an error status would push it down a path that only
 * knows how to say "the request failed".
 */

import express from 'express';

import { bundle } from './bundle.js';
import { compileCss } from './css.js';
import { buildDocument } from './document.js';

const router = express.Router();

/** The same guardrails the typecheck route uses; the same reasoning applies. */
const MAX_FILES = 400;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

router.post('/build', async (req, res) => {
    const started = Date.now();
    const { files } = req.body ?? {};

    if (!files || typeof files !== 'object' || Array.isArray(files)) {
        return res.status(400).json({ error: 'files must be an object of path -> content' });
    }
    const entries = Object.entries(files);
    if (entries.length === 0) {
        return res.status(400).json({ error: 'nothing to preview' });
    }
    if (entries.length > MAX_FILES) {
        return res.status(413).json({ error: `too many files (${entries.length} > ${MAX_FILES})` });
    }
    let total = 0;
    for (const [, content] of entries) total += typeof content === 'string' ? content.length : 0;
    if (total > MAX_TOTAL_BYTES) {
        return res.status(413).json({ error: 'project too large to preview' });
    }

    try {
        const built = await bundle(files);
        if (!built.ok) {
            if (res.writableEnded) return;
            /* Layer 1 of the three the preview surfaces: this never reaches the iframe.
               An empty frame with a hidden reason is the failure mode; a named file and
               line is the whole point of answering at all. */
            return res.json({ ok: false, errors: built.errors, durationMs: Date.now() - started });
        }

        const styles = await compileCss(files, built.stylesheets);
        const html = buildDocument({ html: files['index.html'], css: styles.css, code: built.code });

        if (res.writableEnded) return;
        return res.json({
            ok: true,
            html,
            entry: built.entry,
            bytes: html.length,
            /* A stylesheet that would not compile costs the styling, not the preview —
               so it travels as a warning beside a working app, never as a failure. */
            styleError: styles.error,
            stylesheet: styles.from,
            candidates: styles.candidates,
            durationMs: Date.now() - started,
        });
    } catch (err) {
        if (res.writableEnded) return;
        const message = err instanceof Error ? err.message : 'preview build failed';
        console.warn('[preview]', message);
        return res.status(500).json({ error: message });
    }
});

export default router;
