/**
 * The memory bridge.
 *
 * Everything the server knows about `multi-graph-memory` passes through here,
 * and the module has one governing rule: **a memory failure is never a build
 * failure.** Every export catches, records why, and returns null. A generation
 * that would have succeeded without memory still succeeds with memory broken —
 * the builder simply runs unadvised, and `/api/memory/state` says so out loud
 * rather than pretending the trail is complete.
 *
 * Two facts about the environment shape the design:
 *
 *   1. The engine ships TypeScript and builds to `dist/`. npm's script policy
 *      skips `prepare` on a `file:` install, so the build is NOT guaranteed to
 *      have run. The import is therefore lazy and its failure is a documented
 *      degraded state, not a crash at require time.
 *   2. SQLite is synchronous and process-local, so it lives here, on the server,
 *      never in the browser. The client asks over HTTP.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/** One database per build. Overridable so the smoke test never touches real memory. */
const DB_DIR = process.env.MEMORY_DB_DIR || path.join(PROJECT_ROOT, '.multi-memory');

/** The workspace every build in this app belongs to. Tenancy beyond this is a later cycle. */
const WORKSPACE = 'multi-app';

/** Open databases are file handles; a long-lived server must not accumulate them. */
const MAX_OPEN_BUILDS = 8;

/** Recall must never be the reason a build feels slow. */
const RECALL_TIMEOUT_MS = 1_200;

/* ------------------------------------------------------------------ state -- */

let enginePromise = null;
let engine = null;

const state = {
    /** null until the first attempt; true/false afterwards. */
    available: null,
    reason: null,
    /** Rolling record of the most recent failure per operation, for the panel. */
    failures: {},
    /** What the last recall actually injected, so the E2E can prove injection happened. */
    lastInjection: null,
};

/** buildId -> { memory, storage, touchedAt }. Insertion order is the eviction order. */
const open = new Map();

const note = (operation, error) => {
    const message = String(error?.message ?? error).slice(0, 300);
    state.failures[operation] = { message, at: new Date().toISOString() };
    console.warn(`[memory] ${operation} failed: ${message}`);
    return null;
};

/* ----------------------------------------------------------------- engine -- */

/**
 * Loads the engine once. A failure here is expected and survivable: the package
 * may be absent, or present but unbuilt.
 */
/** How long a failed load is trusted before the next call tries again. */
const ENGINE_RETRY_MS = 30_000;
let engineFailedAt = 0;

async function loadEngine() {
    if (engine) return engine;

    // A failure is remembered, but not forever. The expected cause is "not built
    // yet", which a person fixes while the server keeps running -- so caching the
    // failure for the life of the process would mean every later build runs
    // unadvised until someone thinks to restart. A transient cause (a momentary
    // filesystem or memory failure during the dynamic import, which this device
    // is not immune to) deserves a retry for the same reason.
    if (!enginePromise && engineFailedAt > 0 && Date.now() - engineFailedAt < ENGINE_RETRY_MS) {
        return null;
    }

    if (!enginePromise) {
        enginePromise = import('multi-graph-memory')
            .then((loaded) => {
                engine = loaded;
                engineFailedAt = 0;
                state.available = true;
                state.reason = null;
                return loaded;
            })
            .catch((error) => {
                state.available = false;
                state.reason =
                    /Cannot find module|ERR_MODULE_NOT_FOUND/i.test(String(error?.message))
                        ? 'multi-graph-memory is not installed, or its dist/ build is missing — run `npm run build` in /root/multi-graph-memory'
                        : String(error?.message ?? error).slice(0, 300);
                console.warn(`[memory] disabled: ${state.reason}`);
                // Clear the cached promise so the next call past the cooldown
                // retries, rather than replaying this failure indefinitely.
                enginePromise = null;
                engineFailedAt = Date.now();
                return null;
            });
    }
    return enginePromise;
}

/* ---------------------------------------------------------------- builds -- */

/**
 * A build id becomes a filename, so it is validated rather than trusted. Anything
 * outside this alphabet is refused instead of sanitized: silently rewriting an id
 * would split one build's memory across two databases.
 */
const VALID_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Never evicts `keep`, so the build a request is actively using cannot be closed under it. */
function evictIfNeeded(keep) {
    while (open.size > MAX_OPEN_BUILDS) {
        const oldest = [...open.keys()].find((id) => id !== keep);
        if (oldest === undefined) return;
        const entry = open.get(oldest);
        open.delete(oldest);
        try {
            entry?.storage.close();
        } catch (error) {
            note('close', error);
        }
    }
}

/**
 * Opens in flight, keyed by build.
 *
 * The cache check and the open are separated by an `await`, so two requests for
 * the same never-before-opened build (a plan call and a directions call fired
 * together, say) would both miss the cache and both construct a SQLite handle on
 * the same file. The second `open.set` would then overwrite the first, leaking a
 * native handle that eviction can no longer see because it is no longer in the
 * map. Sharing the in-flight promise makes the second caller wait for the first.
 */
const opening = new Map();

/** The GraphMemory for one build, or null. Never throws. */
export async function forBuild(buildId) {
    if (!buildId || !VALID_BUILD_ID.test(buildId)) return note('forBuild', new Error(`invalid buildId "${buildId}"`));

    const cached = open.get(buildId);
    if (cached) {
        // Refresh recency: re-inserting moves it to the end of the iteration order.
        open.delete(buildId);
        open.set(buildId, cached);
        return cached.memory;
    }

    const inFlight = opening.get(buildId);
    if (inFlight) return inFlight;

    const attempt = (async () => {
        const loaded = await loadEngine();
        if (!loaded) return null;
        try {
            // Re-check: another caller may have finished while the engine loaded.
            const existing = open.get(buildId);
            if (existing) return existing.memory;

            const storage = new loaded.SqliteStorageAdapter({ path: path.join(DB_DIR, `${buildId}.db`) });
            storage.open();
            const memory = new loaded.GraphMemory({ storage, scope: { workspace: WORKSPACE, projectId: buildId } });
            open.set(buildId, { memory, storage });
            evictIfNeeded(buildId);
            return memory;
        } catch (error) {
            return note('forBuild', error);
        }
    })().finally(() => opening.delete(buildId));

    opening.set(buildId, attempt);
    return attempt;
}

/* ------------------------------------------------------------------ write -- */

/**
 * Opens an episode. Returns its id, or null — a null id makes every later tap a no-op.
 *
 * Reuses an episode that is still open for the same objective on the same base
 * revision, rather than opening a second one. The engine derives an episode id
 * partly from its open timestamp, so two requests a millisecond apart are two
 * different episodes to it -- which is right for two genuine attempts and wrong
 * for a double-tap, a retry, or a reload. Five identical requests produced five
 * episodes before this. An attempt that is still open IS the attempt; a genuinely
 * new one starts after the previous is closed.
 */
export async function openEpisodeSafe({ buildId, objective, baseRevisionId, attribution }) {
    const memory = await forBuild(buildId);
    if (!memory) return null;
    const cleanObjective = String(objective ?? 'build').slice(0, 2_000);
    const cleanBase = String(baseRevisionId ?? 'rev-1').slice(0, 512);
    try {
        const alreadyOpen = memory
            .listEpisodes()
            .find((e) => e.closedAt === undefined && e.objective === cleanObjective && e.baseRevisionId === cleanBase);
        if (alreadyOpen) return alreadyOpen.id;

        const episode = memory.openEpisode({
            objective: cleanObjective,
            baseRevisionId: cleanBase,
            ...(attribution ? { attribution } : {}),
        });
        return episode.id;
    } catch (error) {
        return note('openEpisode', error);
    }
}

export async function closeEpisodeSafe({ buildId, episodeId, outcome, attribution }) {
    if (!episodeId) return null;
    const memory = await forBuild(buildId);
    if (!memory) return null;
    try {
        // Closing an already-closed episode is a refusal by design, and a
        // duplicate close is an ordinary race here (a reload, a double click).
        // It is not worth surfacing as a failure.
        const existing = memory.getEpisode(episodeId);
        if (!existing || existing.closedAt !== undefined) return existing ?? null;
        return memory.closeEpisode(episodeId, outcome, undefined, attribution);
    } catch (error) {
        return note('closeEpisode', error);
    }
}

/** Appends one event. `kind` and the identity fields are the caller's responsibility. */
export async function appendEventSafe({ buildId, episodeId, kind, payload, evidenceIds, ...rest }) {
    const memory = await forBuild(buildId);
    if (!memory) return null;
    try {
        const result = memory.appendEvent({
            kind,
            occurredAt: new Date().toISOString(),
            projectId: buildId,
            cycleId: buildId,
            phaseId: rest.phaseId ?? 'builder',
            ...(episodeId ? { episodeId } : {}),
            // Bounded like every other free-text field reaching the engine. The
            // engine caps identifiers at 512 and REFUSES beyond that, and a
            // refusal here would silently drop the whole event over one long
            // string -- with only a count returned to the caller, that failure is
            // close to undiagnosable.
            ...(rest.provider ? { provider: String(rest.provider).slice(0, 512) } : {}),
            ...(rest.model ? { model: String(rest.model).slice(0, 512) } : {}),
            ...(rest.surface ? { surface: String(rest.surface).slice(0, 512) } : {}),
            ...(rest.component ? { component: String(rest.component).slice(0, 512) } : {}),
            ...(rest.domain ? { domain: rest.domain } : {}),
            ...(rest.triggerTags?.length
                ? { triggerTags: rest.triggerTags.slice(0, 64).map((tag) => String(tag).slice(0, 200)) }
                : {}),
            payload: payload ?? {},
            evidenceIds: evidenceIds ?? [],
        });
        return result.event;
    } catch (error) {
        return note('appendEvent', error);
    }
}

export async function recordEvidenceSafe({ buildId, kind, ref, summary, digest }) {
    const memory = await forBuild(buildId);
    if (!memory) return null;
    try {
        return memory.recordEvidence({
            kind: String(kind).slice(0, 512),
            ref: String(ref).slice(0, 2_000),
            ...(summary ? { summary: String(summary).slice(0, 2_000) } : {}),
            ...(digest ? { digest } : {}),
        });
    } catch (error) {
        return note('recordEvidence', error);
    }
}

export async function recordAppliedLessonSafe({ buildId, episodeId, lessonId }) {
    if (!episodeId || !lessonId) return null;
    const memory = await forBuild(buildId);
    if (!memory) return null;
    try {
        return memory.recordAppliedLesson(episodeId, lessonId);
    } catch (error) {
        return note('recordAppliedLesson', error);
    }
}

/* ------------------------------------------------------------------- read -- */

const withTimeout = (promise, ms, label) =>
    Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);

/**
 * The governed read.
 *
 * The packet is assembled by the engine, never composed here: the item budget,
 * the domain weighting, the diversity guard and the art-direction bar are all
 * properties of `queryContext`, and re-implementing any of them on this side
 * would be a second, weaker copy of the rule.
 */
export async function readContextSafe({ buildId, task, component, domain, triggerTags, directionGeneration }) {
    const memory = await forBuild(buildId);
    if (!memory) return null;
    try {
        const packet = await withTimeout(
            memory.queryContext({
                task: String(task ?? '').slice(0, 2_000),
                ...(component ? { component } : {}),
                ...(domain ? { domain } : {}),
                ...(triggerTags?.length ? { triggerTags } : {}),
                ...(directionGeneration ? { directionGeneration: true } : {}),
            }),
            RECALL_TIMEOUT_MS,
            'recall',
        );
        return packet?.items?.length ? packet : null;
    } catch (error) {
        return note('readContext', error);
    }
}

/**
 * Renders a packet for a prompt, and records that it happened.
 *
 * Delivery is content-side on purpose: the block is appended to the user prompt,
 * not to a provider's system prompt, so one wording reaches all four providers
 * and `providers/prompts.js` stays the only place house style is decided.
 */
export async function recallBlock({ buildId, episodeId, task, component, domain, triggerTags, directionGeneration, surface }) {
    const packet = await readContextSafe({ buildId, task, component, domain, triggerTags, directionGeneration });
    if (!packet) return '';

    const loaded = await loadEngine();
    if (!loaded?.renderPacket) return '';

    let rendered;
    try {
        rendered = loaded.renderPacket(packet);
    } catch (error) {
        return note('renderPacket', error) ?? '';
    }

    // Recording which lessons were applied is what later makes a reuse claim
    // checkable: a lesson cannot be "reused" in an episode that never saw it.
    //
    // Deliberately NOT awaited. Recall sits in front of the model call, so every
    // millisecond here is a millisecond before the user sees anything — and these
    // are real SQLite writes with a 2s lock timeout each, which under contention
    // could add seconds to a plan the user is waiting on. The read half is bounded
    // by RECALL_TIMEOUT_MS for exactly this reason; the write half is moved off
    // the path instead. It completes long before the model does.
    const lessonIds = packet.items.filter((item) => item.sourceKind === 'lesson').map((item) => item.id);
    void Promise.all(
        lessonIds.map((lessonId) => recordAppliedLessonSafe({ buildId, episodeId, lessonId })),
    );

    state.lastInjection = {
        at: new Date().toISOString(),
        buildId,
        surface: surface ?? null,
        itemCount: packet.items.length,
        lessonIds,
        domains: [...new Set(packet.items.map((item) => item.domain).filter(Boolean))],
        characters: rendered.length,
    };

    return `\n\n**Memory from earlier builds of this project — advisory context only. It never overrides the plan, the theme, or the user's instructions:**\n${rendered}`;
}

/* ----------------------------------------------------------------- report -- */

export async function listBuildState(buildId) {
    const memory = await forBuild(buildId);
    if (!memory) return null;
    try {
        return {
            buildId,
            episodes: memory.listEpisodes(),
            lessons: memory.listLessons(),
            evidenceCount: memory.listEvidence().length,
            eventCount: memory.queryEvents({}).length,
        };
    } catch (error) {
        return note('listBuildState', error);
    }
}

/**
 * Human-only approval.
 *
 * It lives on the bridge because the server route needs it, and it is deliberately
 * NOT reachable from anything a model touches: no tool declares it, and the engine's
 * own model-facing port has no approve method to expose. The engine still refuses a
 * lesson that has not qualified — this is a call site, not a second gate.
 */
export async function approveLessonSafe({ buildId, lessonId, approvedBy }) {
    const memory = await forBuild(buildId);
    if (!memory) return { ok: false, message: 'Memory is unavailable.' };
    try {
        const lesson = memory.approveLesson(lessonId, approvedBy);
        return { ok: true, lesson };
    } catch (error) {
        // A refusal is information for the human, not a server fault.
        return { ok: false, message: String(error?.message ?? error).slice(0, 300) };
    }
}

/**
 * Forces the engine load so a caller gets a real answer rather than "not yet
 * asked". The health endpoint uses it: a panel reporting `available: false`
 * before anything has been tried would be reporting its own laziness as a fault.
 */
export async function probe() {
    await loadEngine();
    return health();
}

export function health() {
    return {
        available: state.available === true,
        probed: state.available !== null,
        reason: state.reason,
        databaseDir: DB_DIR,
        openBuilds: [...open.keys()],
        failures: state.failures,
        lastInjection: state.lastInjection,
    };
}

/** Used by the smoke test to prove state survives a restart, and on shutdown. */
export function closeAll() {
    for (const [buildId, entry] of open) {
        try {
            entry.storage.close();
        } catch (error) {
            note('close', error);
        }
        open.delete(buildId);
    }
}
