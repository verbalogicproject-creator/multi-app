/**
 * The logic behind the `patchFile` tool, pure and model-free — see A3 in the
 * plan for why this exists alongside `updateFile` rather than instead of it.
 *
 * Content-anchored, not line-anchored: a line number is only correct until an
 * earlier tool call in the same turn changes the file's line count, which
 * multi-call execution made a same-turn possibility. `find` has to be exact
 * and unique, the same contract this project's own editing tool already
 * enforces — refusing an ambiguous or absent match is what keeps a patch from
 * silently landing somewhere other than where it was meant to.
 */

export type PatchResult =
    | { ok: true; content: string }
    | { ok: false; error: string };

export const applyPatch = (content: string, find: string, replace: string): PatchResult => {
    if (find === '') {
        return { ok: false, error: 'find must not be empty — an empty string matches everywhere and nowhere meaningfully.' };
    }
    const firstAt = content.indexOf(find);
    if (firstAt === -1) {
        return { ok: false, error: `Could not find the exact text to replace. It does not appear in the file — re-read the file and match it exactly, including whitespace.` };
    }
    const secondAt = content.indexOf(find, firstAt + find.length);
    if (secondAt !== -1) {
        return { ok: false, error: `The text to replace appears more than once in the file. Include more surrounding context so it matches exactly one place.` };
    }
    return { ok: true, content: content.slice(0, firstAt) + replace + content.slice(firstAt + find.length) };
};
