/**
 * Recovering the files a truncated generation did finish.
 *
 * A model that runs out of output budget stops mid-character. The result is not
 * "malformed JSON" in any useful sense — it is *correct* JSON with the end missing,
 * and every file before the cut is intact. Measured on this project: eleven complete
 * files were discarded because the twelfth was half-written.
 *
 * So rather than handing the whole accumulator to `JSON.parse` and losing everything
 * when it throws, walk the `files` array and keep every object that closed. What is
 * left is exactly what the model finished saying.
 *
 * Pure and dependency-free on purpose: this is the piece that has to be trustworthy,
 * so it must be testable without a provider, a network, or a clock.
 */

/** Where the `files` array opens. -1 when the response never got that far. */
const findFilesArray = (text) => {
    const key = /"files"\s*:\s*\[/g;
    const match = key.exec(text);
    return match ? match.index + match[0].length - 1 : -1;
};

/**
 * Walk one JSON array, returning the index just past the last element that closed.
 *
 * The walk has to be string-aware or it ends early on the first `}` inside a file's
 * content — which, since the content *is* source code, is roughly immediately.
 *
 * @returns {{ end: number, complete: number }} `end` is an index into `text`
 *   one past the final closing brace of the last whole element; `complete` counts them.
 */
const walkElements = (text, arrayStart) => {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    let complete = 0;

    for (let i = arrayStart + 1; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') { inString = true; continue; }
        if (ch === '{' || ch === '[') { depth++; continue; }
        if (ch === '}' || ch === ']') {
            /* Depth 0 here is the array's own `]` — the response was not truncated
               at all, and the caller's own `JSON.parse` will have succeeded. */
            if (depth === 0) break;
            depth--;
            if (depth === 0) { end = i + 1; complete++; }
        }
    }

    return { end, complete };
};

/**
 * Every complete `{path, content}` object in a possibly-truncated response.
 *
 * @param {string} text the raw accumulated model output
 * @returns {{ files: Array<{path: string, content: string}>, salvaged: boolean }}
 *   `salvaged` is true only when whole files were recovered from text that did not
 *   parse as a whole — a complete response returns `salvaged: false`, because there
 *   was nothing to rescue.
 */
export const salvageFiles = (text) => {
    if (typeof text !== 'string' || text === '') return { files: [], salvaged: false };

    /* The ordinary path first. A response that parses needs none of this. */
    try {
        const whole = JSON.parse(text);
        if (Array.isArray(whole?.files)) return { files: whole.files, salvaged: false };
    } catch {
        /* Truncated, or genuinely malformed. Tell them apart below. */
    }

    const arrayStart = findFilesArray(text);
    if (arrayStart === -1) return { files: [], salvaged: false };

    const { end, complete } = walkElements(text, arrayStart);
    if (end === -1 || complete === 0) return { files: [], salvaged: false };

    try {
        const files = JSON.parse(`[${text.slice(arrayStart + 1, end)}]`);
        if (!Array.isArray(files)) return { files: [], salvaged: false };
        /* A file whose `content` never arrived is not a file. The walk only closes
           an object when its braces balance, so this is belt-and-braces — but the
           whole point of this module is not to hand back half of something. */
        const usable = files.filter(f => typeof f?.path === 'string' && typeof f?.content === 'string');
        return { files: usable, salvaged: usable.length > 0 };
    } catch {
        return { files: [], salvaged: false };
    }
};

/**
 * Did the model stop because it ran out of room?
 *
 * Every provider says so in its own word, and until now every adapter threw the
 * answer away — which is why this failure arrived dressed as "malformed JSON" for
 * as long as it did. Normalised here so the callers can ask one question.
 */
const TRUNCATION_REASONS = new Set([
    'MAX_TOKENS',      // Google
    'max_tokens',      // Anthropic
    'length',          // OpenAI, NVIDIA
    'max_output_tokens',
]);

export const isTruncation = (finishReason) =>
    typeof finishReason === 'string' && TRUNCATION_REASONS.has(finishReason);
