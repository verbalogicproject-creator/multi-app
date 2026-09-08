import React, { useEffect, useState } from 'react';
import * as apiService from '../services/apiService';
import type { SkillMeta, Skill } from '../services/apiService';

/**
 * The second half of "harness" `components/Harness.tsx`'s own doc comment
 * named as not-yet-here: editing the model-tuned foundation prompts a Persona
 * can select (see `providers/prompts.js`'s `skillsBlock`). Deliberately
 * narrower than that comment's full scope — it names "the main agent, the
 * builder, the wizard" too, meaning this app's own embedded generation
 * prompts (`server.js`'s `/api/builder/*` routes, `HARNESS.md`). Those stay
 * un-editable through any UI; that is a separate, larger piece of work this
 * component does not attempt.
 *
 * Read-only for `kind: 'skill'` entries on purpose — third-party, MIT-licensed
 * content (`skills/THIRD-PARTY-NOTICES.md`); editing someone else's attributed
 * work in place, silently diverging from its upstream, is a footgun, not a
 * feature. Only `kind: 'model-prompt'` entries (this project's own, wrapped
 * from a self-authored source) are ever sent to `PUT /api/skills/:id`.
 */

const field =
    'tap w-full px-3 bg-raised rounded-lg text-sm text-metal-100 ' +
    'placeholder:text-metal-400 hairline focus:outline-none';

const button =
    'tap px-4 rounded-lg text-sm font-medium ' +
    'transition-[background-color,transform] duration-200 ease-fluid ' +
    'active:scale-[0.98] disabled:opacity-35 disabled:active:scale-100';

const solid = `${button} bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] md:hover:bg-[#33333a]`;

const PromptEngineeringStudio: React.FC = () => {
    const [skills, setSkills] = useState<SkillMeta[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selected, setSelected] = useState<Skill | null>(null);
    const [draftBody, setDraftBody] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        apiService.listSkills().then((list) => { setSkills(list); setLoading(false); });
    }, []);

    useEffect(() => {
        if (!selectedId) { setSelected(null); setDraftBody(''); return; }
        setError('');
        setSaved(false);
        apiService.getSkill(selectedId).then((skill) => {
            setSelected(skill);
            setDraftBody(skill?.body ?? '');
        });
    }, [selectedId]);

    const isDirty = selected !== null && draftBody !== selected.body;
    const canEdit = selected?.kind === 'model-prompt';

    const handleSave = async () => {
        if (!selected || !canEdit) return;
        setSaving(true);
        setError('');
        try {
            const updated = await apiService.updateSkillBody(selected.id, draftBody);
            setSelected(updated);
            setDraftBody(updated.body);
            setSaved(true);
        } catch (e: any) {
            setError(e.message || 'Failed to save.');
        } finally {
            setSaving(false);
        }
    };

    const modelPrompts = skills.filter((s) => s.kind === 'model-prompt');
    const thirdPartySkills = skills.filter((s) => s.kind === 'skill');

    return (
        <div className="grid md:grid-cols-[16rem_1fr] gap-4 md:gap-5">
            {/* Catalog */}
            <div className="bg-surface hairline rounded-lg p-3 space-y-4">
                <div>
                    <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-2">
                        Model prompts
                    </h3>
                    <p className="text-[11px] text-metal-400 mb-2">Editable — this project's own.</p>
                    {loading && <p className="text-xs text-metal-400 italic">Loading…</p>}
                    <div className="space-y-1">
                        {modelPrompts.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setSelectedId(s.id)}
                                aria-pressed={selectedId === s.id}
                                className={`tap w-full text-left px-3 py-2 rounded-lg text-sm transition-colors duration-200 ease-fluid
                                            ${selectedId === s.id
                                                ? 'bg-raised text-metal-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]'
                                                : 'text-metal-300 md:hover:bg-white/[0.04] md:hover:text-metal-100'}`}
                            >
                                {s.name}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="pt-3 border-t border-white/[0.06]">
                    <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-2">
                        Skills
                    </h3>
                    <p className="text-[11px] text-metal-400 mb-2">Read-only — third-party, MIT-licensed.</p>
                    <div className="space-y-1">
                        {thirdPartySkills.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setSelectedId(s.id)}
                                aria-pressed={selectedId === s.id}
                                className={`tap w-full text-left px-3 py-2 rounded-lg text-sm transition-colors duration-200 ease-fluid
                                            ${selectedId === s.id
                                                ? 'bg-raised text-metal-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]'
                                                : 'text-metal-300 md:hover:bg-white/[0.04] md:hover:text-metal-100'}`}
                            >
                                {s.name}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Editor */}
            <div className="bg-surface hairline rounded-lg p-4 md:p-5">
                {!selected && (
                    <p className="text-sm text-metal-300 text-center py-8">Pick a prompt or skill from the list.</p>
                )}
                {selected && (
                    <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="font-display text-lg text-metal-100 truncate">{selected.name}</h3>
                                <p className="text-xs text-metal-300 mt-1">{selected.description}</p>
                            </div>
                            {!canEdit && (
                                <span className="shrink-0 px-2 py-1 rounded-md text-[11px] font-medium text-metal-300 bg-white/[0.04]">
                                    Read-only
                                </span>
                            )}
                        </div>
                        <textarea
                            value={draftBody}
                            onChange={(e) => canEdit && setDraftBody(e.target.value)}
                            readOnly={!canEdit}
                            rows={20}
                            className={`${field} font-mono text-xs leading-relaxed`}
                        />
                        {canEdit && (
                            <div className="flex items-center gap-3">
                                <button onClick={handleSave} disabled={!isDirty || saving} className={solid}>
                                    {saving ? 'Saving…' : 'Save'}
                                </button>
                                {isDirty && !saving && <span className="text-xs text-metal-300">Unsaved changes</span>}
                                {saved && !isDirty && <span className="text-xs text-metal-300">Saved — live immediately for any persona using this model.</span>}
                                {error && <span className="text-xs text-accent-soft">{error}</span>}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PromptEngineeringStudio;
