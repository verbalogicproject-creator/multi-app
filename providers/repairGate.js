/**
 * The outer safety net around `server.js`'s post-generation repair loop.
 *
 * `repairIfNeeded` mutates a single `record` (path -> file content) across up to
 * `MAX_ROUNDS` rounds, and its own per-file revert only ever asks "did *this file*
 * get better?" -- it never asks "is the whole project better than where it started?"
 * A round can fix three files and break a fourth worse than all three combined, and
 * without an aggregate check that round still ships. A real build went 47 -> 61
 * aggregate errors across two rounds and that worse state was what shipped.
 *
 * This tracker is the fix: it remembers the lowest aggregate error count seen at any
 * point in the loop -- starting from the pre-repair state, which is itself always a
 * valid fallback -- and, once the loop ends for any reason, restores the file record
 * to that best snapshot if the loop's final state did not match it.
 *
 * Deliberately not a generic decision gate or expression language -- this is one
 * binary decision (keep the final state, or fall back to the best one seen) and the
 * scope stays exactly that.
 */
export const createBestTracker = ({ errors, files, keptFiles = [] }) => {
    let best = { errors, files: { ...files }, keptFiles: [...keptFiles] };

    return {
        /** The best snapshot recorded so far, for inspection/testing. */
        get best() {
            return best;
        },

        /**
         * Record a fully-measured state as a new best if it strictly beats the
         * current one. `files`/`keptFiles` are copied at call time -- both are
         * mutated further by the caller after this returns.
         */
        consider(candidateErrors, files, keptFiles = []) {
            if (candidateErrors < best.errors) {
                best = { errors: candidateErrors, files: { ...files }, keptFiles: [...keptFiles] };
            }
        },

        /**
         * Called once, after the loop has ended for any reason. If the loop's final
         * state (`finalErrors`) is not the best one ever seen, restores `record`'s
         * contents (in place -- callers hold other references to this exact object)
         * to the best snapshot and reports that as the outcome instead.
         */
        resolve(record, finalErrors) {
            if (best.errors < finalErrors) {
                for (const path of Object.keys(best.files)) record[path] = best.files[path];
                return { postRepairErrors: best.errors, repairedFiles: best.keptFiles, reverted: true };
            }
            return { postRepairErrors: finalErrors, repairedFiles: null, reverted: false };
        },
    };
};
