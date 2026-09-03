import React from 'react';
import type { DiagnosticsState } from '../hooks/useDiagnostics';
import type { TscDiagnostic } from '../types/diagnostics';

interface ProblemsPanelProps {
    state: DiagnosticsState;
    /** Jump to the offending token. The panel names a place; the editor goes there. */
    onSelect: (diagnostic: TscDiagnostic) => void;
}

/**
 * Every type error in the project, in one list.
 *
 * It lists across *all* files rather than only the open one, because tsc checks the
 * project as a whole and the error you need is routinely in the file you are not
 * looking at. The colour convention is the one `Step_Export` already uses for
 * validation issues — accent for errors, plain metal for warnings — so the two
 * places the app reports on generated code agree with each other.
 */
const ProblemsPanel: React.FC<ProblemsPanelProps> = ({ state, onSelect }) => {
    const { all, status, truncated, durationMs } = state;

    if (status === 'checking') {
        return (
            <p className="px-4 py-3 text-sm text-metal-300">
                Type-checking<span className="meta">…</span>
            </p>
        );
    }

    if (status === 'unavailable') {
        return (
            <p className="px-4 py-3 text-sm text-metal-300">
                The type checker did not answer. The editor is unaffected; nothing here is a verdict on your code.
            </p>
        );
    }

    if (status === 'idle') {
        return <p className="px-4 py-3 text-sm text-metal-300">Save a file to type-check the project.</p>;
    }

    if (all.length === 0) {
        return (
            <p className="px-4 py-3 text-sm text-metal-300">
                No type errors
                {durationMs !== null && <span className="meta text-xs text-metal-400"> · checked in {(durationMs / 1000).toFixed(1)}s</span>}
            </p>
        );
    }

    return (
        <div className="flex-1 min-h-0 overflow-y-auto">
            <ul className="divide-y divide-white/5">
                {all.map((d, index) => (
                    <li key={`${d.path}:${d.line}:${d.col}:${d.code}:${index}`}>
                        <button
                            type="button"
                            onClick={() => onSelect(d)}
                            className="tap w-full px-4 py-2 text-left flex flex-col gap-0.5
                                       transition-colors duration-200 ease-fluid
                                       md:hover:bg-white/[0.03] active:bg-white/[0.05]"
                        >
                            <span className="meta text-xs text-metal-400">
                                <span className={d.severity === 'error' ? 'text-accent-soft' : 'text-metal-300'}>{d.code}</span>
                                {'  '}{d.path}:{d.line}:{d.col}
                            </span>
                            {/* Elaborated diagnostics carry their detail on following
                                lines; the first is the claim, the rest is why. */}
                            <span className="text-sm text-metal-200 whitespace-pre-wrap">{d.message}</span>
                        </button>
                    </li>
                ))}
            </ul>
            {truncated && (
                <p className="px-4 py-2 meta text-xs text-metal-400">
                    List truncated — there are more than are worth reading here.
                </p>
            )}
        </div>
    );
};

export default ProblemsPanel;
