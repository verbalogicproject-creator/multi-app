import { generateUniqueId } from '../utils/common';

// Persistence for the web-app builder: the in-progress wizard state (so a page
// reload never destroys work) and a library of finished builds.
const BUILDER_STATE_KEY = 'gemini_builder_state';
const SAVED_BUILDS_KEY = 'gemini_saved_builds';
const MAX_SAVED_BUILDS = 10;

/**
 * Where this build's memory lives.
 *
 * `episodeId` is populated ONLY while an episode is open — every close path clears
 * it — so an id still sitting here at startup is unambiguously an episode a reload
 * cut short, and can be closed as abandoned without guessing.
 */
export interface BuildMemoryRef {
    buildId: string | null;
    episodeId: string | null;
    lastOutcome?: 'verified' | 'failed' | 'abandoned' | null;
    /** The model that served the last generation, so a decision made after a reload can still attribute it. */
    servingModel?: string | null;
}

/** The subset of builder state worth surviving a reload (transient status is dropped). */
export interface PersistedBuilderState {
    isActive: boolean;
    currentStep: number;
    idea: string;
    plan: any | null;
    theme: any;
    generatedFiles: Record<string, string> | null;
    candidateFiles?: Record<string, string> | null;
    validation?: any | null;
    artDirections?: any[] | null;
    evidence?: { ts: number; event: string }[];
    savedBuildId?: string | null;
    memory?: BuildMemoryRef;
}

export interface SavedBuild {
    id: string;
    name: string;
    savedAt: string;
    idea: string;
    plan: any;
    theme: any;
    generatedFiles: Record<string, string>;
    evidence?: { ts: number; event: string }[];
    /** Verdict recorded when the build was saved, so the shelf can show it. */
    validation?: { ok: boolean; issues: { severity: string; code?: string; message: string; file?: string }[]; checked: number } | null;
    /**
     * The memory cluster and the episode that produced this build. Absent on builds
     * saved before memory existed, which is why every reader must tolerate it.
     */
    memory?: { buildId: string; episodeId: string | null };
}

const isQuotaError = (e: unknown): boolean =>
    e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);

// =========================================================================================
// In-progress builder state
// =========================================================================================

export const loadBuilderState = (): PersistedBuilderState | null => {
    try {
        const raw = localStorage.getItem(BUILDER_STATE_KEY);
        return raw ? (JSON.parse(raw) as PersistedBuilderState) : null;
    } catch (e) {
        console.error('Failed to load builder state', e);
        return null;
    }
};

/** Returns null on success, or a user-facing message when the state could not be saved. */
export const saveBuilderState = (state: PersistedBuilderState): string | null => {
    try {
        localStorage.setItem(BUILDER_STATE_KEY, JSON.stringify(state));
        return null;
    } catch (e) {
        if (isQuotaError(e)) {
            return 'Browser storage is full, so this build could not be auto-saved. Export or delete a saved build to free space.';
        }
        console.error('Failed to save builder state', e);
        return 'Could not auto-save the current build to browser storage.';
    }
};

export const clearBuilderState = (): void => {
    try { localStorage.removeItem(BUILDER_STATE_KEY); } catch { /* non-fatal */ }
};

// =========================================================================================
// Saved build library
// =========================================================================================

export const getSavedBuilds = (): SavedBuild[] => {
    try {
        const raw = localStorage.getItem(SAVED_BUILDS_KEY);
        const builds = raw ? (JSON.parse(raw) as SavedBuild[]) : [];
        return Array.isArray(builds) ? builds : [];
    } catch (e) {
        console.error('Failed to load saved builds', e);
        return [];
    }
};

/**
 * Writes the library, evicting the oldest entries if storage is full.
 * Throws only when even a single build will not fit.
 */
const writeSavedBuilds = (builds: SavedBuild[]): SavedBuild[] => {
    let candidates = [...builds].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, MAX_SAVED_BUILDS);
    while (candidates.length > 0) {
        try {
            localStorage.setItem(SAVED_BUILDS_KEY, JSON.stringify(candidates));
            return candidates;
        } catch (e) {
            if (!isQuotaError(e) || candidates.length === 1) {
                throw new Error(isQuotaError(e)
                    ? 'This build is too large for browser storage. Export it as a ZIP instead.'
                    : 'Could not save this build to browser storage.');
            }
            candidates = candidates.slice(0, -1);  // drop the oldest and retry
        }
    }
    throw new Error('Could not save this build to browser storage.');
};

/** Creates a new saved build (or updates the one matching `existingId`). */
export const saveBuild = (
    input: { name: string; idea: string; plan: any; theme: any; generatedFiles: Record<string, string>; evidence?: { ts: number; event: string }[]; validation?: SavedBuild['validation']; memory?: SavedBuild['memory'] },
    existingId?: string | null,
): SavedBuild => {
    const builds = getSavedBuilds();
    const existing = existingId ? builds.find(b => b.id === existingId) : undefined;
    const build: SavedBuild = {
        id: existing?.id ?? generateUniqueId(),
        savedAt: new Date().toISOString(),
        ...input,
    };
    const others = builds.filter(b => b.id !== build.id);
    const written = writeSavedBuilds([build, ...others]);
    if (!written.some(b => b.id === build.id)) {
        throw new Error('This build is too large for browser storage. Export it as a ZIP instead.');
    }
    return build;
};

export const deleteSavedBuild = (id: string): SavedBuild[] => {
    const remaining = getSavedBuilds().filter(b => b.id !== id);
    try {
        localStorage.setItem(SAVED_BUILDS_KEY, JSON.stringify(remaining));
    } catch (e) {
        console.error('Failed to delete saved build', e);
    }
    return remaining;
};
