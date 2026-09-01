/**
 * The client half of the memory loop.
 *
 * The server owns the database; the browser owns the facts only it can see — that
 * a generation started, what the validator said, whether a human kept or threw
 * away the result. This module is the seam between them.
 *
 * Memory is advisory. It records what happened and recalls what was learned, and
 * it must never be the reason a build fails. So nothing here throws: every call
 * bounds itself with a timeout and answers `null` on any failure, and no caller
 * is expected to handle one. Exactly one call is awaited — `openEpisode` — because
 * a null episode id is what makes every later tap a no-op, and the taps have to
 * know which case they are in.
 */

/** Long enough for a local SQLite write under lock contention, short enough to be invisible. */
const TIMEOUT_MS = 2_000;

export type EpisodeOutcome = 'verified' | 'failed' | 'abandoned';

/**
 * The event kinds the server accepts from a client (`CLIENT_EVENT_KINDS` in
 * `memory/routes.js`). Anything else is dropped there rather than stored, so this
 * union exists to turn that silent rejection into a compile error.
 */
export type ClientEventKind =
    | 'direction.selected'
    | 'verification.completed'
    | 'repair.attempted'
    | 'revision.promoted'
    | 'revision.rolled_back'
    | 'human.decision'
    | 'deviation.observed';

/**
 * The engine's declared lesson domains (`LESSON_DOMAINS` in its `core/types`).
 *
 * An undeclared domain is not stored with a shrug: the whole event fails schema
 * validation and is refused, and the bridge can only report that as a count.
 * Mirroring the vocabulary here turns that runtime refusal into a compile error —
 * which is how `domain: 'design'` was caught before it could quietly drop every
 * direction the user ever chose.
 *
 * The grouping is the engine's, and it is a weighting: build, diagnostics,
 * dependency, api-usage, environment and repair are correctness territory and
 * recall strongly; taste, layout, copy and art-direction are taste and recall
 * weakly by default.
 */
export type MemoryDomain =
    | 'build' | 'diagnostics' | 'dependency' | 'api-usage' | 'environment' | 'repair'
    | 'bug' | 'performance' | 'architecture'
    | 'taste' | 'layout' | 'copy' | 'art-direction';

export interface MemoryEvent {
    kind: ClientEventKind;
    payload?: Record<string, unknown>;
    /**
     * Keys of evidence submitted in the same batch that this event actually cites.
     * Naming nothing cites nothing: the server deliberately will not attach a
     * batch's evidence to an event that did not ask for it.
     */
    evidenceKeys?: string[];
    provider?: string;
    model?: string;
    surface?: string;
    domain?: MemoryDomain;
}

export interface MemoryEvidence {
    /** Batch-local handle an event uses to cite this item. */
    key: string;
    kind: string;
    ref: string;
    summary?: string;
}

export interface Attribution {
    provider?: string;
    model?: string;
}

/**
 * The alphabet a build id must be in — the server's `VALID_BUILD_ID`, mirrored.
 *
 * A build id names one memory cluster, which is one database file. The server
 * refuses an id outside this set rather than sanitizing it, because silently
 * rewriting one would split a build's memory across two databases.
 * `generateUniqueId()` is NOT usable here: it contains a `.`.
 */
const VALID_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const newBuildId = (): string =>
    `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const warned = new Set<string>();

/**
 * The id if the server can use it, `null` otherwise.
 *
 * Absent is a normal state — memory off, or a build that predates it — and says
 * nothing. Present but malformed is a bug on this side, and would otherwise
 * present as every tap quietly doing nothing for the rest of the build: the
 * server refuses the id, each call returns 200 with a null, and the wizard runs
 * to completion recording not one thing. Once per bad id is enough to find it.
 */
const usableBuildId = (buildId: string | null): string | null => {
    if (!buildId) return null;
    if (VALID_BUILD_ID.test(buildId)) return buildId;
    if (!warned.has(buildId)) {
        warned.add(buildId);
        console.error(
            `[memory] build id "${buildId}" is not one the server will accept, so nothing will be ` +
            `recorded for this build. Ids must match ${VALID_BUILD_ID}; use newBuildId().`,
        );
    }
    return null;
};

const post = async <T>(path: string, body: unknown): Promise<T | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        return response.ok ? ((await response.json()) as T) : null;
    } catch {
        return null;   // unreachable server, timeout, malformed body — all the same answer
    } finally {
        clearTimeout(timer);
    }
};

/**
 * Opens an episode for one generation attempt, or answers null.
 *
 * The server reuses an episode that is still open for the same objective and base
 * revision rather than opening a second one, so a double-tap, a retry or a
 * remount joins the attempt already in flight instead of forking it. The
 * consequence is that closing matters: an episode left open will absorb the next
 * genuine attempt.
 */
export const openEpisode = async (
    buildId: string | null,
    objective: string,
    baseRevisionId?: string | null,
): Promise<string | null> => {
    const id = usableBuildId(buildId);
    if (!id) return null;
    const result = await post<{ episodeId: string | null }>('/api/memory/episodes/open', {
        buildId: id,
        objective,
        ...(baseRevisionId ? { baseRevisionId } : {}),
    });
    return result?.episodeId ?? null;
};

/**
 * Closes an episode. Fire-and-forget: nothing downstream waits on the answer.
 *
 * `attribution` is the model that actually served the attempt, which is only known
 * once the attempt is over — that is why it belongs here and not at open time.
 */
export const closeEpisode = (
    buildId: string | null,
    episodeId: string | null,
    outcome: EpisodeOutcome,
    attribution?: Attribution,
): void => {
    const id = usableBuildId(buildId);
    if (!id || !episodeId) return;
    void post('/api/memory/episodes/close', { buildId: id, episodeId, outcome, ...attribution });
};

/**
 * Records events, and the evidence they cite, in one batch — because the client
 * usually learns several things at the same instant (a verdict, what produced it,
 * and the decision that followed) and one request keeps them together in time.
 *
 * An event with no episode still records: `direction.selected` happens before any
 * generation exists to belong to.
 */
export const record = (
    buildId: string | null,
    episodeId: string | null,
    events: MemoryEvent[],
    evidence: MemoryEvidence[] = [],
): void => {
    const id = usableBuildId(buildId);
    if (!id || events.length === 0) return;
    void post('/api/memory/events', { buildId: id, episodeId, events, evidence });
};

export interface MemoryStateResponse {
    health: {
        available: boolean;
        probed: boolean;
        reason: string | null;
        databaseDir: string;
        openBuilds: string[];
        failures: unknown[];
        lastInjection: unknown;
    };
    build: {
        buildId: string;
        episodes: unknown[];
        lessons: unknown[];
        evidenceCount: number;
        eventCount: number;
    } | null;
}

/** What memory currently holds for a build, for the panel and the smoke test. */
export const getState = async (buildId?: string | null): Promise<MemoryStateResponse | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const query = buildId ? `?buildId=${encodeURIComponent(buildId)}` : '';
        const response = await fetch(`/api/memory/state${query}`, { signal: controller.signal });
        return response.ok ? ((await response.json()) as MemoryStateResponse) : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
};
