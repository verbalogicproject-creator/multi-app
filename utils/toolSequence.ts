/**
 * The pure half of `runToolSequence` (see `hooks/useChat.ts`): given a queue of
 * tool calls, decide which run immediately and where the queue must pause for
 * approval — without touching React state, `handleToolCall`, or a network call,
 * so the decision is checkable on its own. See A3 item 3 in the plan: a
 * `runPython` call pauses the sequence wherever it sits, not only when it is
 * first, and everything queued behind it survives as `remaining` rather than
 * being dropped.
 */
export interface ToolCallLike {
    name: string;
    args: any;
}

export interface SequenceSplit<T extends ToolCallLike> {
    /** Calls before the gate, to execute immediately, in order. */
    before: T[];
    /** The call to pause on. Absent when nothing in the sequence needs approval. */
    paused?: T;
    /** Calls queued behind the gate, to resume once it resolves. */
    remaining: T[];
}

export const splitAtApprovalGate = <T extends ToolCallLike>(calls: T[], gateName: string): SequenceSplit<T> => {
    const index = calls.findIndex((call) => call.name === gateName);
    if (index === -1) return { before: calls, remaining: [] };
    return { before: calls.slice(0, index), paused: calls[index], remaining: calls.slice(index + 1) };
};
