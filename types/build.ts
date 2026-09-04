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
    /** The provider's own word for why it stopped — `MAX_TOKENS`, `length`, … */
    finishReason: string | null;
}
