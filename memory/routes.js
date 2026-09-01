/**
 * The `/api/memory/*` surface.
 *
 * Two kinds of caller land here, and the split is deliberate:
 *
 *   - The **builder client** posts lifecycle facts it alone observes — that a
 *     generation started, what the validator said, whether a human kept or
 *     discarded a candidate. Those decisions happen in the browser; the database
 *     is on the server; this is the seam between them.
 *   - The **human** approves a lesson. That route is here rather than anywhere
 *     near the model routes for a structural reason: nothing in `providers/`
 *     declares it, so no tool schema can name it and no prompt can reach it.
 *
 * Every route answers 200 with a shaped body even when memory is unavailable.
 * A degraded memory is a fact the UI displays, not an error the builder handles.
 */

import express from 'express';
import * as bridge from './bridge.js';

export const memoryRouter = express.Router();

/** Event kinds the client is allowed to report. Anything else is ignored, not stored. */
const CLIENT_EVENT_KINDS = new Set([
    'direction.selected',
    'verification.completed',
    'repair.attempted',
    'revision.promoted',
    'revision.rolled_back',
    'human.decision',
    'deviation.observed',
]);

const OUTCOMES = new Set(['verified', 'failed', 'abandoned']);

memoryRouter.post('/episodes/open', async (req, res) => {
    const { buildId, objective, baseRevisionId } = req.body ?? {};
    const episodeId = await bridge.openEpisodeSafe({ buildId, objective, baseRevisionId });
    // A null id is not an error: the client treats it as "memory off" and every
    // downstream tap becomes a no-op on its side too.
    res.json({ episodeId });
});

memoryRouter.post('/episodes/close', async (req, res) => {
    const { buildId, episodeId, outcome, provider, model } = req.body ?? {};
    if (!OUTCOMES.has(outcome)) {
        return res.status(400).json({ message: `outcome must be one of ${[...OUTCOMES].join(', ')}` });
    }
    const attribution = provider || model
        ? { ...(provider ? { provider } : {}), ...(model ? { model } : {}) }
        : undefined;
    const episode = await bridge.closeEpisodeSafe({ buildId, episodeId, outcome, attribution });
    res.json({ closed: Boolean(episode) });
});

/**
 * A batch, because the client often learns several things at once (a verdict,
 * its evidence, and the decision that followed) and one request keeps them
 * together in time.
 *
 * Evidence is addressed, never shared. Each submitted evidence item carries a
 * `key`, and an event cites evidence by listing keys in `evidenceKeys`. An
 * earlier version attached the whole batch's evidence to every event in it,
 * which quietly cited a failing-test result against an unrelated human decision.
 * Events are immutable, so that kind of corruption is permanent and invisible --
 * and the evidence trail is the thing every later reuse claim is checked against.
 */
memoryRouter.post('/events', async (req, res) => {
    const { buildId, episodeId, events = [], evidence = [] } = req.body ?? {};

    const byKey = new Map();
    const evidenceIds = [];
    for (const [index, item] of (Array.isArray(evidence) ? evidence.slice(0, 32) : []).entries()) {
        const recorded = await bridge.recordEvidenceSafe({
            buildId,
            kind: item?.kind ?? 'note',
            ref: item?.ref ?? 'client://unspecified',
            summary: item?.summary,
        });
        if (!recorded) continue;
        evidenceIds.push(recorded.id);
        byKey.set(String(item?.key ?? index), recorded.id);
    }

    const accepted = [];
    const rejected = [];
    for (const [index, event] of (Array.isArray(events) ? events.slice(0, 32) : []).entries()) {
        if (!CLIENT_EVENT_KINDS.has(event?.kind)) {
            rejected.push({ index, kind: event?.kind ?? null, reason: 'unknown event kind' });
            continue;
        }

        // Only the evidence this event actually names. An event that names none
        // cites none -- silence is not an invitation to attach the batch.
        const cited = Array.isArray(event.evidenceKeys)
            ? event.evidenceKeys.map((key) => byKey.get(String(key))).filter(Boolean)
            : [];

        const appended = await bridge.appendEventSafe({
            buildId,
            episodeId: event.episodeId ?? episodeId,
            kind: event.kind,
            payload: event.payload ?? {},
            evidenceIds: cited,
            ...(event.provider ? { provider: event.provider } : {}),
            ...(event.model ? { model: event.model } : {}),
            ...(event.surface ? { surface: event.surface } : {}),
            ...(event.component ? { component: event.component } : {}),
            ...(event.domain ? { domain: event.domain } : {}),
            ...(event.triggerTags ? { triggerTags: event.triggerTags } : {}),
        });

        if (appended) accepted.push({ index, id: appended.id });
        // A rejection here is the engine refusing the record. Saying which one and
        // why is the difference between a diagnosable gap and a silent hole.
        else rejected.push({ index, kind: event.kind, reason: 'refused by the memory engine' });
    }

    res.json({ accepted: accepted.length, accepted_ids: accepted, rejected, evidenceIds });
});

memoryRouter.get('/state', async (req, res) => {
    const buildId = typeof req.query.buildId === 'string' ? req.query.buildId : null;
    const health = await bridge.probe();
    const build = buildId ? await bridge.listBuildState(buildId) : null;
    res.json({ health, build });
});

/**
 * The human gate. `approvedBy` is required and never defaulted: an approval whose
 * approver is "unknown" is not an approval, and the engine records the name.
 */
memoryRouter.post('/lessons/:lessonId/approve', async (req, res) => {
    const { buildId, approvedBy } = req.body ?? {};
    const name = typeof approvedBy === 'string' ? approvedBy.trim() : '';
    if (!name) return res.status(400).json({ ok: false, message: 'approvedBy is required.' });

    const result = await bridge.approveLessonSafe({ buildId, lessonId: req.params.lessonId, approvedBy: name });
    // A refusal (the lesson has not qualified) is a 200 carrying the engine's
    // reason: it is a legitimate answer to a legitimate question, not a fault.
    res.json(result);
});
