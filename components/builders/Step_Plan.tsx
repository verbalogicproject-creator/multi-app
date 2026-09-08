import React, { useEffect, useState } from 'react';
import { useAppContext } from '../../context/AppContext';

interface PlanPage { name: string; path: string; description: string; }
interface PlanComponent { name: string; description: string; }
interface PlanEntityField { name: string; type: string; }
interface PlanEntity { name: string; fields: PlanEntityField[]; }
interface DraftPlan {
    projectName: string;
    projectDescription: string;
    designDirection: string;
    pages: PlanPage[];
    components: PlanComponent[];
    entities: PlanEntity[];
    acceptanceCriteria: string[];
}

/** Normalizes a model-produced plan (or an older saved one) into an editable shape.
 *  `designDirection` is absent on a plan saved before this field existed — an empty
 *  string there means "say nothing extra," exactly like an unset aesthetic dimension
 *  in `providers/aesthetic.js`, not an error. */
const toDraft = (plan: any): DraftPlan => ({
    projectName: plan?.projectName ?? '',
    projectDescription: plan?.projectDescription ?? '',
    designDirection: plan?.designDirection ?? '',
    pages: Array.isArray(plan?.pages)
        ? plan.pages.map((p: any) => ({ name: p?.name ?? '', path: p?.path ?? '', description: p?.description ?? '' }))
        : [],
    components: Array.isArray(plan?.components)
        ? plan.components.map((c: any) => ({ name: c?.name ?? '', description: c?.description ?? '' }))
        : [],
    entities: Array.isArray(plan?.entities)
        ? plan.entities.map((e: any) => ({
            name: e?.name ?? '',
            fields: Array.isArray(e?.fields) ? e.fields.map((f: any) => ({ name: f?.name ?? '', type: f?.type ?? '' })) : [],
        }))
        : [],
    acceptanceCriteria: Array.isArray(plan?.acceptanceCriteria)
        ? plan.acceptanceCriteria.map((c: any) => String(c ?? ''))
        : [],
});

const inputClass =
    "tap w-full px-3 bg-raised rounded-lg text-sm text-metal-100 placeholder:text-metal-400 " +
    "hairline focus:outline-none disabled:opacity-40";
/* Destructive, and reachable by thumb: an opacity-0-until-hover control is a
   control a touch screen cannot find. Metal at rest, accent on the glyph only
   when you are about to use it. */
const removeBtnClass =
    "tap flex items-center justify-center shrink-0 rounded-lg text-metal-300 text-lg leading-none " +
    "transition-colors duration-200 ease-fluid md:hover:text-accent md:hover:bg-metal-700";
const addBtnClass =
    "tap mt-2 w-full rounded-lg text-metal-300 text-xs " +
    "shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] " +
    "transition-colors duration-200 ease-fluid md:hover:text-metal-100 md:hover:bg-white/[0.04] " +
    "disabled:opacity-40";
const panelClass = "p-4 md:p-5 bg-surface rounded-card hairline";
const panelHeading = "text-xs font-medium uppercase tracking-[0.12em] text-metal-300";

const Step_Plan: React.FC = () => {
    const { builderState, setBuilderState, refineWebAppPlan, recordEvidence } = useAppContext();
    const { plan, status } = builderState;

    const [draft, setDraft] = useState<DraftPlan>(() => toDraft(plan));
    const [feedback, setFeedback] = useState('');

    // A new plan object means the AI returned a revision — adopt it as the new draft.
    useEffect(() => { setDraft(toDraft(plan)); }, [plan]);

    if (!plan) {
        return <div className="text-center text-sm text-metal-300">Generating plan…</div>;
    }

    const isBusy = status.isLoading;
    const isDirty = JSON.stringify(draft) !== JSON.stringify(toDraft(plan));

    const update = (patch: Partial<DraftPlan>) => setDraft(prev => ({ ...prev, ...patch }));
    const updatePage = (index: number, patch: Partial<PlanPage>) =>
        update({ pages: draft.pages.map((p, i) => i === index ? { ...p, ...patch } : p) });
    const updateComponent = (index: number, patch: Partial<PlanComponent>) =>
        update({ components: draft.components.map((c, i) => i === index ? { ...c, ...patch } : c) });
    const updateEntity = (index: number, patch: Partial<PlanEntity>) =>
        update({ entities: draft.entities.map((e, i) => i === index ? { ...e, ...patch } : e) });
    const updateEntityField = (entityIndex: number, fieldIndex: number, patch: Partial<PlanEntityField>) =>
        update({
            entities: draft.entities.map((e, i) => i === entityIndex
                ? { ...e, fields: e.fields.map((f, fi) => fi === fieldIndex ? { ...f, ...patch } : f) }
                : e),
        });

    const handleApprove = () => {
        if (isDirty) recordEvidence('Blueprint hand-edited before approval');
        recordEvidence(`Blueprint approved — ${draft.pages.length} pages, ${draft.components.length} components, ${draft.entities.length} shared shapes, ${draft.acceptanceCriteria.length} acceptance criteria`);
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
        <div className="w-full max-w-3xl mx-auto bg-surface rounded-card hairline p-4 md:p-6">
            <h2 className="font-display text-2xl md:text-3xl tracking-[-0.03em] text-metal-100 text-center">
                Project blueprint
            </h2>
            <p className="mt-2 text-center text-metal-300 text-sm">
                Edit anything directly, or ask the AI to revise it. Nothing is built until you approve.
            </p>

            {/* Identity */}
            <div className="mt-6 p-4 md:p-5 bg-raised rounded-card space-y-3">
                <div>
                    <label className="block text-xs text-metal-300 mb-2">Project name</label>
                    <input type="text" value={draft.projectName} disabled={isBusy}
                        onChange={e => update({ projectName: e.target.value })} className={inputClass} />
                </div>
                <div>
                    <label className="block text-xs text-metal-300 mb-2">Description</label>
                    <textarea value={draft.projectDescription} disabled={isBusy} rows={2}
                        onChange={e => update({ projectDescription: e.target.value })} className={inputClass} />
                </div>
                <div>
                    <label className="block text-xs text-metal-300 mb-2">Design direction</label>
                    <input type="text" value={draft.designDirection} disabled={isBusy}
                        placeholder="e.g. dense technical dashboard, dark mono"
                        onChange={e => update({ designDirection: e.target.value })} className={inputClass} />
                    <p className="mt-1.5 text-[11px] text-metal-400">
                        Feeds the Style step's suggestions and the generator's own prompt. Change it here if it doesn't fit.
                    </p>
                </div>
            </div>

            <div className="mt-4 grid md:grid-cols-2 gap-4 md:gap-5">
                {/* Pages */}
                <div className={panelClass}>
                    <h3 className={`${panelHeading} mb-3 pb-3 shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]`}>Pages</h3>
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
                <div className={panelClass}>
                    <h3 className={`${panelHeading} mb-3 pb-3 shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]`}>Components</h3>
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

            {/* Shared data shapes — decided once instead of guessed separately by
                every page and component that needs one. See providers/schemas.js's
                doc comment on PLAN_SCHEMA.entities for why this exists. */}
            <div className={`mt-4 ${panelClass}`}>
                <h3 className={panelHeading}>Shared data shapes</h3>
                <p className="text-xs text-metal-300 mt-2 mb-3">
                    Anything more than one page or component needs — a photo, a review, a booking. Declared once so every file agrees on the fields. Leave empty if nothing is shared.
                </p>
                <ul className="space-y-3">
                    {draft.entities.map((entity, index) => (
                        <li key={index} className="p-3 bg-raised rounded-card space-y-2">
                            <div className="flex items-center gap-2">
                                <input type="text" value={entity.name} disabled={isBusy} placeholder="PhotoItem"
                                    onChange={e => updateEntity(index, { name: e.target.value })} className={`${inputClass} font-mono`} />
                                <button onClick={() => update({ entities: draft.entities.filter((_, i) => i !== index) })}
                                    disabled={isBusy} className={removeBtnClass} title="Remove shape">&times;</button>
                            </div>
                            <ul className="space-y-1.5">
                                {entity.fields.map((field, fieldIndex) => (
                                    <li key={fieldIndex} className="flex items-center gap-2 pl-2">
                                        <input type="text" value={field.name} disabled={isBusy} placeholder="location"
                                            onChange={e => updateEntityField(index, fieldIndex, { name: e.target.value })}
                                            className={`${inputClass} text-xs`} />
                                        <input type="text" value={field.type} disabled={isBusy} placeholder="string"
                                            onChange={e => updateEntityField(index, fieldIndex, { type: e.target.value })}
                                            className={`${inputClass} text-xs w-32 shrink-0 font-mono`} />
                                        <button onClick={() => updateEntity(index, { fields: entity.fields.filter((_, i) => i !== fieldIndex) })}
                                            disabled={isBusy} className={removeBtnClass} title="Remove field">&times;</button>
                                    </li>
                                ))}
                            </ul>
                            <button disabled={isBusy} className={`${addBtnClass} ml-2 w-[calc(100%-0.5rem)]`}
                                onClick={() => updateEntity(index, { fields: [...entity.fields, { name: '', type: 'string' }] })}>
                                + Add field
                            </button>
                        </li>
                    ))}
                </ul>
                <button disabled={isBusy} className={addBtnClass}
                    onClick={() => update({ entities: [...draft.entities, { name: '', fields: [{ name: '', type: 'string' }] }] })}>
                    + Add shape
                </button>
            </div>

            {/* Acceptance criteria */}
            <div className={`mt-4 ${panelClass}`}>
                <h3 className={panelHeading}>Acceptance criteria</h3>
                <p className="text-xs text-metal-300 mt-2 mb-3">What the finished app must do. These are sent to the code generator as requirements.</p>
                <ul className="space-y-2">
                    {draft.acceptanceCriteria.map((criterion, index) => (
                        <li key={index} className="flex items-center gap-2">
                            <span aria-hidden className="meta text-xs shrink-0 w-4 text-right">{index + 1}</span>
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
            <div className={`mt-4 ${panelClass}`}>
                <h3 className={panelHeading}>Ask the AI to revise this blueprint</h3>
                <p className="text-xs text-metal-300 mt-2 mb-3">
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
                    className="tap mt-3 px-5 rounded-lg bg-metal-700 text-metal-100 text-sm font-medium
                               shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                               transition-[background-color,transform] duration-200 ease-fluid
                               md:hover:bg-[#33333a] active:scale-[0.98]
                               disabled:opacity-40 disabled:active:scale-100"
                >
                    {isBusy ? 'Revising…' : 'Refine with AI'}
                </button>
                {status.message && <span className="ml-3 text-xs text-metal-300">{status.message}</span>}
            </div>

            <div className="mt-8 text-center">
                <button
                    onClick={handleApprove}
                    disabled={isBusy}
                    className="tap w-full sm:w-auto px-10 rounded-xl bg-metal-700 text-metal-100 font-medium
                               shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]
                               transition-[background-color,transform] duration-200 ease-fluid
                               md:hover:bg-[#33333a] active:scale-[0.98]
                               disabled:opacity-40 disabled:active:scale-100"
                >
                    Looks good — add style
                </button>
                {isDirty && (
                    <button onClick={() => setDraft(toDraft(plan))} disabled={isBusy}
                        className="tap block mx-auto mt-2 px-3 text-xs text-metal-300 md:hover:text-metal-100">
                        Discard my edits
                    </button>
                )}
            </div>
        </div>
    );
};

export default Step_Plan;
