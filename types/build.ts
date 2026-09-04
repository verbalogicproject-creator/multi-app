/**
 * What a generation attempt returns.
 *
 * `files` alone was not enough. A response cut off by its output budget still carries
 * every file that completed, and those are worth keeping — but they are **not** a
 * candidate to be judged. Reported as one, the validators run over a half-written
 * project and propose lessons about mistakes nobody made.
 */
export interface GenerateResult {
    files: Record<string, string>;
    /**
     * The model stopped before it finished. The instrument failed, not the model, so
     * no verdict drawn from these files may reach the lesson ladder.
     */
    truncated: boolean;
    /** How many whole files were recovered from a truncated response. */
    salvagedCount: number;
    /**
     * Every file the model said the project needed, declared before any was written.
     * Empty when the single-shot fallback path served the request.
     */
    manifest: string[];
    /**
     * Manifest entries with no file. A set difference, not a guess — which is what
     * makes a stopped build resumable rather than lost.
     */
    missing: string[];
    /**
     * Files a compiler rejected and the builder then re-requested with the errors
     * attached. Present so a build that needed rescuing does not read as one that
     * never did.
     */
    repaired: string[];
    repairRounds: number;
    /** The provider's own word for why it stopped — `MAX_TOKENS`, `length`, … */
    finishReason: string | null;
}
