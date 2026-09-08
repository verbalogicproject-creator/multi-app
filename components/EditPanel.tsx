import React, { useState } from 'react';
import type { BuildIssue } from '../utils/validateBuild';
import { useAppContext } from '../context/AppContext';

interface EditPanelProps {
    projectId: string;
}

/**
 * "Generate again, but with feedback" — see A3's `/api/builder/edit`. A drawer
 * tab alongside Problems and Terminal, not a replacement for either: the
 * result of an edit is reported the same way a generation's validation
 * already is (`Step_Export.tsx`'s "Passed with"/"Kept despite" convention),
 * so the two places this app reports on generated code keep agreeing with
 * each other.
 */
const EditPanel: React.FC<EditPanelProps> = ({ projectId }) => {
    const { editOpenProject } = useAppContext();
    const [instruction, setInstruction] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ summary: string; changedPaths: string[]; issues: BuildIssue[]; ok: boolean } | null>(null);

    const submit = async () => {
        if (!instruction.trim() || busy) return;
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            const { validation, changedPaths, summary } = await editOpenProject(projectId, instruction.trim());
            setResult({ summary, changedPaths, issues: validation.issues, ok: validation.ok });
            setInstruction('');
        } catch (e: any) {
            setError(e?.message ?? 'The change could not be applied.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            <p className="text-xs text-metal-300">
                Describe a change. The model sees every current file and the current diagnostics, and returns only what needs to change.
            </p>
            <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                disabled={busy}
                rows={3}
                placeholder="e.g. Make the header sticky when you scroll"
                className="tap w-full px-3 py-2 bg-raised rounded-lg text-sm text-metal-100 placeholder:text-metal-400
                           hairline focus:outline-none disabled:opacity-40"
            />
            <button
                type="button"
                onClick={submit}
                disabled={busy || !instruction.trim()}
                className="tap px-5 rounded-lg bg-metal-700 text-metal-100 text-sm font-medium
                           shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                           transition-[background-color,transform] duration-200 ease-fluid
                           md:hover:bg-[#33333a] active:scale-[0.98]
                           disabled:opacity-40 disabled:active:scale-100"
            >
                {busy ? 'Applying…' : 'Apply change'}
            </button>

            {error && (
                <p className="text-sm text-accent-soft">{error}</p>
            )}

            {result && (
                <div className="p-3 bg-surface rounded-card hairline space-y-2">
                    <p className="text-sm text-metal-200">{result.summary}</p>
                    <p className="meta text-xs text-metal-400">
                        Changed: {result.changedPaths.length > 0 ? result.changedPaths.join(', ') : 'nothing'}
                    </p>
                    {result.issues.length === 0 ? (
                        <p className="text-sm text-metal-300">
                            <span aria-hidden className="text-metal-400">✓</span> No issues.
                        </p>
                    ) : (
                        <ul className="space-y-1">
                            {result.issues.map((issue, index) => (
                                <li key={index} className={issue.severity === 'error' ? 'text-accent-soft' : 'text-metal-300'}>
                                    <span className="uppercase text-[10px] mr-1 tracking-[0.12em]">{issue.severity}</span>
                                    {issue.file && <span className="meta mr-1 text-xs">{issue.file}</span>}
                                    <span className="text-sm text-metal-200">{issue.message}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
};

export default EditPanel;
