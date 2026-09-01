import React, { useEffect, useState } from 'react';
import { useAppContext } from '../../context/AppContext';

interface PlanPage { name: string; path: string; description: string; }
interface PlanComponent { name: string; description: string; }
interface DraftPlan {
    projectName: string;
    projectDescription: string;
    pages: PlanPage[];
    components: PlanComponent[];
    acceptanceCriteria: string[];
}

/** Normalizes a model-produced plan (or an older saved one) into an editable shape. */
const toDraft = (plan: any): DraftPlan => ({
    projectName: plan?.projectName ?? '',
    projectDescription: plan?.projectDescription ?? '',
    pages: Array.isArray(plan?.pages)
        ? plan.pages.map((p: any) => ({ name: p?.name ?? '', path: p?.path ?? '', description: p?.description ?? '' }))
        : [],
    components: Array.isArray(plan?.components)
        ? plan.components.map((c: any) => ({ name: c?.name ?? '', description: c?.description ?? '' }))
        : [],
    acceptanceCriteria: Array.isArray(plan?.acceptanceCriteria)
        ? plan.acceptanceCriteria.map((c: any) => String(c ?? ''))
        : [],
});

const inputClass = "w-full p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-60";
const removeBtnClass = "px-2 text-gray-500 hover:text-red-400 text-lg leading-none shrink-0";
const addBtnClass = "mt-2 w-full py-1.5 border border-dashed border-gray-600 text-gray-400 text-xs rounded-md hover:border-sky-500 hover:text-sky-400";

const Step_Plan: React.FC = () => {
    const { builderState, setBuilderState, refineWebAppPlan, recordEvidence } = useAppContext();
    const { plan, status } = builderState;

    const [draft, setDraft] = useState<DraftPlan>(() => toDraft(plan));
    const [feedback, setFeedback] = useState('');

    // A new plan object means the AI returned a revision — adopt it as the new draft.
    useEffect(() => { setDraft(toDraft(plan)); }, [plan]);

    if (!plan) {
        return <div className="text-center text-gray-400">Generating plan...</div>;
    }

    const isBusy = status.isLoading;
    const isDirty = JSON.stringify(draft) !== JSON.stringify(toDraft(plan));

    const update = (patch: Partial<DraftPlan>) => setDraft(prev => ({ ...prev, ...patch }));
    const updatePage = (index: number, patch: Partial<PlanPage>) =>
        update({ pages: draft.pages.map((p, i) => i === index ? { ...p, ...patch } : p) });
    const updateComponent = (index: number, patch: Partial<PlanComponent>) =>
        update({ components: draft.components.map((c, i) => i === index ? { ...c, ...patch } : c) });

    const handleApprove = () => {
        if (isDirty) recordEvidence('Blueprint hand-edited before approval');
        recordEvidence(`Blueprint approved — ${draft.pages.length} pages, ${draft.components.length} components, ${draft.acceptanceCriteria.length} acceptance criteria`);
        setBuilderState(prev => ({
            ...prev,
            plan: { ...prev.plan, ...draft },
            currentStep: 3,
            status: { ...prev.status, message: '' },
        }));
    };

    const handleRefine = () => {
        if (!feedback.trim() || isBusy) return;
        refineWebAppPlan({ ...plan, ...draft }, feedback.trim());
        setFeedback('');
    };

    return (
        <div className="w-full max-w-3xl mx-auto bg-gray-800/50 border border-gray-700 rounded-lg p-4 md:p-6">
            <h2 className="text-2xl font-bold text-sky-400 text-center">Project Blueprint</h2>
            <p className="mt-1 text-center text-gray-400 text-sm">
                Edit anything directly, or ask the AI to revise it. Nothing is built until you approve.
            </p>

            {/* Identity */}
            <div className="mt-6 p-4 bg-gray-900 rounded-md space-y-3">
                <div>
                    <label className="block text-xs text-gray-400 mb-1">Project name</label>
                    <input type="text" value={draft.projectName} disabled={isBusy}
                        onChange={e => update({ projectName: e.target.value })} className={inputClass} />
                </div>
                <div>
                    <label className="block text-xs text-gray-400 mb-1">Description</label>
                    <textarea value={draft.projectDescription} disabled={isBusy} rows={2}
                        onChange={e => update({ projectDescription: e.target.value })} className={inputClass} />
                </div>
            </div>

            <div className="mt-4 grid md:grid-cols-2 gap-4">
                {/* Pages */}
                <div className="p-4 bg-gray-900 rounded-md">
                    <h3 className="font-semibold text-gray-200 mb-2 border-b border-gray-700 pb-2 text-sm">Pages</h3>
                    <ul className="space-y-3">
                        {draft.pages.map((page, index) => (
                            <li key={index} className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <input type="text" value={page.name} disabled={isBusy} placeholder="HomePage"
                                        onChange={e => updatePage(index, { name: e.target.value })} className={inputClass} />
                                    <input type="text" value={page.path} disabled={isBusy} placeholder="/"
                                        onChange={e => updatePage(index, { path: e.target.value })} className={`${inputClass} w-24 shrink-0`} />
                                    <button onClick={() => update({ pages: draft.pages.filter((_, i) => i !== index) })}
                                        disabled={isBusy} className={removeBtnClass} title="Remove page">&times;</button>
                                </div>
                                <textarea value={page.description} disabled={isBusy} rows={2} placeholder="What this page is for"
                                    onChange={e => updatePage(index, { description: e.target.value })} className={`${inputClass} text-xs`} />
                            </li>
                        ))}
                    </ul>
                    <button disabled={isBusy} className={addBtnClass}
                        onClick={() => update({ pages: [...draft.pages, { name: '', path: '/', description: '' }] })}>
                        + Add page
                    </button>
                </div>

                {/* Components */}
                <div className="p-4 bg-gray-900 rounded-md">
                    <h3 className="font-semibold text-gray-200 mb-2 border-b border-gray-700 pb-2 text-sm">Components</h3>
                    <ul className="space-y-3">
                        {draft.components.map((component, index) => (
                            <li key={index} className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <input type="text" value={component.name} disabled={isBusy} placeholder="Navbar"
                                        onChange={e => updateComponent(index, { name: e.target.value })} className={inputClass} />
                                    <button onClick={() => update({ components: draft.components.filter((_, i) => i !== index) })}
                                        disabled={isBusy} className={removeBtnClass} title="Remove component">&times;</button>
                                </div>
                                <textarea value={component.description} disabled={isBusy} rows={2} placeholder="What this component does"
                                    onChange={e => updateComponent(index, { description: e.target.value })} className={`${inputClass} text-xs`} />
                            </li>
                        ))}
                    </ul>
                    <button disabled={isBusy} className={addBtnClass}
                        onClick={() => update({ components: [...draft.components, { name: '', description: '' }] })}>
                        + Add component
                    </button>
                </div>
            </div>

            {/* Acceptance criteria */}
            <div className="mt-4 p-4 bg-gray-900 rounded-md">
                <h3 className="font-semibold text-gray-200 mb-1 text-sm">Acceptance criteria</h3>
                <p className="text-xs text-gray-500 mb-2">What the finished app must do. These are sent to the code generator as requirements.</p>
                <ul className="space-y-2">
                    {draft.acceptanceCriteria.map((criterion, index) => (
                        <li key={index} className="flex items-center gap-2">
                            <span className="text-gray-600 text-xs shrink-0">{index + 1}.</span>
                            <input type="text" value={criterion} disabled={isBusy}
                                onChange={e => update({ acceptanceCriteria: draft.acceptanceCriteria.map((c, i) => i === index ? e.target.value : c) })}
                                className={inputClass} />
                            <button onClick={() => update({ acceptanceCriteria: draft.acceptanceCriteria.filter((_, i) => i !== index) })}
                                disabled={isBusy} className={removeBtnClass} title="Remove criterion">&times;</button>
                        </li>
                    ))}
                </ul>
                <button disabled={isBusy} className={addBtnClass}
                    onClick={() => update({ acceptanceCriteria: [...draft.acceptanceCriteria, ''] })}>
                    + Add criterion
                </button>
            </div>

            {/* AI refine */}
            <div className="mt-4 p-4 bg-gray-900 rounded-md">
                <h3 className="font-semibold text-gray-200 mb-1 text-sm">Ask the AI to revise this blueprint</h3>
                <p className="text-xs text-gray-500 mb-2">
                    Your manual edits above are included. Costs one model request; untouched parts are kept as-is.
                </p>
                <textarea
                    value={feedback}
                    onChange={e => setFeedback(e.target.value)}
                    disabled={isBusy}
                    rows={2}
                    placeholder="e.g. Make it a single page, drop the blog, and add a pricing section"
                    className={inputClass}
                />
                <button
                    onClick={handleRefine}
                    disabled={isBusy || !feedback.trim()}
                    className="mt-2 px-5 py-2 bg-gray-700 text-white text-sm font-semibold rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:hover:bg-gray-700"
                >
                    {isBusy ? 'Revising…' : 'Refine with AI'}
                </button>
                {status.message && <span className="ml-3 text-xs text-gray-400">{status.message}</span>}
            </div>

            <div className="mt-8 text-center">
                <button
                    onClick={handleApprove}
                    disabled={isBusy}
                    className="px-10 py-3 bg-sky-600 text-white font-semibold rounded-lg shadow-md hover:bg-sky-500 transition-all transform hover:scale-105 disabled:opacity-50 disabled:transform-none"
                >
                    Looks Good, Let's Add Style!
                </button>
                {isDirty && (
                    <button onClick={() => setDraft(toDraft(plan))} disabled={isBusy}
                        className="block mx-auto mt-3 text-xs text-gray-500 hover:text-gray-300">
                        Discard my edits
                    </button>
                )}
            </div>
        </div>
    );
};

export default Step_Plan;
