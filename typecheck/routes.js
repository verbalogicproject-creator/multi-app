/**
 * `/api/typecheck` — the one route Stage 2 needs.
 *
 * Mounted like `/api/memory`: before the model routes, so its availability is a fact
 * the UI can read rather than something a request has to discover by failing.
 */

import express from 'express';

import { cancel, typecheck } from './runner.js';

const router = express.Router();

/** Guardrails on request size. The whole point is a generated app, not a monorepo. */
const MAX_FILES = 400;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

router.post('/', async (req, res) => {
    const { projectId, revision, files } = req.body ?? {};

    if (!projectId || typeof projectId !== 'string') {
        return res.status(400).json({ error: 'projectId is required' });
    }
    if (!files || typeof files !== 'object' || Array.isArray(files)) {
        return res.status(400).json({ error: 'files must be an object of path -> content' });
    }
    const entries = Object.entries(files);
    if (entries.length > MAX_FILES) {
        return res.status(413).json({ error: `too many files (${entries.length} > ${MAX_FILES})` });
    }
    let total = 0;
    for (const [, content] of entries) total += typeof content === 'string' ? content.length : 0;
    if (total > MAX_TOTAL_BYTES) {
        return res.status(413).json({ error: 'project too large to typecheck' });
    }

    /* If the client goes away mid-run, so does the compiler. A phone that navigated
       off should not leave a tsc holding memory. */
    let done = false;
    res.on('close', () => { if (!done) cancel(projectId); });

    try {
        const result = await typecheck({ projectId, files });
        done = true;
        if (res.writableEnded) return;
        /* The revision is echoed, never interpreted. The client is what knows whether
           its buffer has moved on, and a stale answer that arrives is dropped there —
           the guard has to live where the document does. */
        return res.json({ revision: revision ?? null, ...result });
    } catch (err) {
        done = true;
        if (res.writableEnded) return;
        const message = err instanceof Error ? err.message : 'typecheck failed';
        const status = message.startsWith('path escape refused') ? 400 : 500;
        if (status === 500) console.warn('[typecheck]', message);
        return res.status(status).json({ error: message });
    }
});

export default router;
