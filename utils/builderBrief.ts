import { Message, MessageAuthor } from '../types/index';

/**
 * Turning a conversation into the builder's starting point.
 *
 * Pure, and deliberately not a model call. A second model call here would be a second
 * thing that can fail, cost quota and take ten seconds — between pressing a button and
 * seeing the wizard. The assistant has already been told (in `plan` mode) to end each
 * turn with a `BRIEF` block, so the work is done by the time this runs; all that is left
 * is to find it.
 *
 * **Nothing here is authoritative.** Whatever comes out lands in an editable textarea on
 * the wizard's first step, before any builder request is made. That is the point: the
 * hand-off suggests, the person confirms. A composer that silently guessed wrong would
 * otherwise send a plausible-looking brief nobody read.
 */

/** The marker the plan-mode prompt is told to emit. Kept in step with `providers/prompts.js`. */
const BRIEF_MARKER = 'BRIEF';

const textOf = (message: Message): string =>
    (message.parts ?? []).map(p => p.text ?? '').join('').trim();

/**
 * The brief a conversation has arrived at, or the best available stand-in.
 *
 * Three sources, in descending order of how much the assistant intended them:
 *  1. the `BRIEF` block of the most recent assistant turn that produced one,
 *  2. that turn's whole text, if it answered without the block,
 *  3. what the person actually asked for, joined — which is never worse than an empty
 *     textarea and is what happens if `plan` mode was never used at all.
 */
export const composeBuilderBrief = (messages: Message[]): string => {
    const turns = messages ?? [];

    for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].author !== MessageAuthor.ASSISTANT) continue;
        const text = textOf(turns[i]);
        if (!text) continue;

        const at = text.lastIndexOf(BRIEF_MARKER);
        /* The marker must start a line. Without that check an assistant that merely
           mentions the word — "I'll put the brief at the end" — would have everything
           after it treated as the brief. */
        const startsLine = at === 0 || (at > 0 && text[at - 1] === '\n');
        if (at !== -1 && startsLine) {
            const body = text.slice(at + BRIEF_MARKER.length).trim();
            if (body) return body;
        }
        return text;
    }

    return turns
        .filter(m => m.author === MessageAuthor.USER)
        .map(textOf)
        .filter(Boolean)
        .join('\n\n');
};

/** Whether there is anything worth handing over yet. */
export const hasBuilderBrief = (messages: Message[]): boolean =>
    composeBuilderBrief(messages).trim().length > 0;
