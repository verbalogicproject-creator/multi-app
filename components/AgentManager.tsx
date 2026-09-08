import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Agent, ComposedStyle, CustomAiStyle, Persona, Project } from '../types/index';
import { useAppContext } from '../context/AppContext';
import * as apiService from '../services/apiService';
import type { SkillMeta } from '../services/apiService';

const field =
    'tap w-full px-3 bg-raised rounded-lg text-sm text-metal-100 ' +
    'placeholder:text-metal-400 hairline focus:outline-none';

const button =
    'tap px-4 rounded-lg text-sm font-medium ' +
    'transition-[background-color,transform] duration-200 ease-fluid ' +
    'active:scale-[0.98] disabled:opacity-35 disabled:active:scale-100';

const solid = `${button} bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] md:hover:bg-[#33333a]`;
const quiet = `${button} bg-transparent text-metal-300 hairline md:hover:text-metal-100`;

const AgentForm: React.FC<{
    agent?: Agent | null;
    projects: Project[];
    personas: Persona[];
    onSave: (data: { id?: string; name: string; personaId: string; projectId: string; }) => void;
    onCancel: () => void;
}> = ({ agent, projects, personas, onSave, onCancel }) => {
    const [name, setName] = useState(agent?.name || '');
    const [personaId, setPersonaId] = useState(agent?.personaId || personas[0]?.id || '');
    const [projectId, setProjectId] = useState(agent?.projectId || projects[0]?.id || '');
    const [error, setError] = useState('');
    const isEditing = !!agent;
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !personaId || !projectId) { setError('All fields are required.'); return; }
        onSave({ id: agent?.id, name: name.trim(), personaId, projectId });
    };

    // Something is missing and you have to go do it — which is exactly what the
    // accent is for, and the only thing on this screen wearing it.
    if (projects.length === 0 || personas.length === 0) {
        return (
            <div className="p-4 rounded-card bg-raised hairline text-sm">
                <p className="flex items-center gap-2 font-medium text-metal-100 mb-2">
                    <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                    Prerequisites missing
                </p>
                <p className="text-metal-300 leading-relaxed">
                    To create an agent you need at least one project and one saved persona — compose one below first.
                </p>
                <button onClick={onCancel} className={`${quiet} mt-3`}>Got it</button>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="p-4 rounded-card bg-raised hairline space-y-4">
            <h3 className="font-display text-base tracking-[-0.02em] text-metal-100">
                {isEditing ? `Edit agent: ${agent.name}` : 'Create new agent'}
            </h3>
            {error && (
                <p className="flex items-center gap-2 text-sm text-metal-100">
                    <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                    {error}
                </p>
            )}
            <div>
                <label htmlFor="agent-name" className="block text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-2">Agent name</label>
                <input id="agent-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. React Expert" className={field} />
            </div>
            <div>
                <label htmlFor="agent-persona" className="block text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-2">Behaviour (persona)</label>
                <select id="agent-persona" value={personaId} onChange={e => setPersonaId(e.target.value)} className={field}>
                    {personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <p className="mt-1.5 text-[11px] text-metal-400">Compose or edit a persona's model, skills and instructions below.</p>
            </div>
            <div>
                <label htmlFor="agent-project" className="block text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-2">Knowledge base (project)</label>
                <select id="agent-project" value={projectId} onChange={e => setProjectId(e.target.value)} className={field}>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" onClick={onCancel} className={quiet}>Cancel</button>
                <button type="submit" className={solid}>{isEditing ? 'Save changes' : 'Create agent'}</button>
            </div>
        </form>
    );
};

const CustomStyleEditor: React.FC<{
  style: CustomAiStyle | null;
  onSave: (id: string | null, name: string, instructions: string) => void;
  onCancel: () => void;
  existingNames: string[];
}> = ({ style, onSave, onCancel, existingNames }) => {
  const [name, setName] = useState(style?.name || '');
  const [instructions, setInstructions] = useState(style?.instructions || '');
  const [error, setError] = useState('');
  const isEditing = !!style;
  const originalName = style?.name || '';
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || !instructions.trim()) { setError('Name and instructions cannot be empty.'); return; }
    if (trimmedName !== originalName && existingNames.includes(trimmedName)) { setError('A style with this name already exists.'); return; }
    onSave(style?.id || null, trimmedName, instructions.trim());
  };
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-lg hairline"><form onSubmit={handleSubmit}>
        <header className="p-4 border-b border-white/[0.06]"><h3 className="text-lg font-bold text-metal-200">{isEditing ? 'Edit Style Block' : 'Create New Style Block'}</h3></header>
        <main className="p-6 space-y-4">
          {error && <p className="text-accent-soft text-sm">{error}</p>}
          <div><label htmlFor="styleName" className="block text-sm font-medium text-metal-300 mb-1">Style Name</label><input id="styleName" type="text" value={name} onChange={e => setName(e.target.value)} className="w-full p-2 bg-metal-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent" placeholder="e.g., Socratic Tutor" /></div>
          <div><label htmlFor="styleInstructions" className="block text-sm font-medium text-metal-300 mb-1">Instructions</label><textarea id="styleInstructions" value={instructions} onChange={e => setInstructions(e.target.value)} className="w-full h-40 p-2 bg-metal-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-accent" placeholder="Describe how the AI should behave with this style..."></textarea></div>
        </main>
        <footer className="p-4 border-t border-white/[0.06] flex justify-end gap-2"><button type="button" onClick={onCancel} className="tap px-4 bg-metal-700 rounded-lg md:hover:bg-[#33333a] transition-colors text-sm font-medium">Cancel</button><button type="submit" className="tap px-4 bg-raised rounded-lg md:hover:bg-[#33333a] transition-colors text-sm font-medium">Save Style</button></footer>
      </form></div>
    </div>
  );
};

/**
 * Persona composition — relocated here from `AiControls.tsx` (see
 * `Harness.tsx`'s doc comment): "Experts" is where a persona is defined, not
 * a separate "Configuration" screen, since a persona has no meaning apart
 * from the agent(s) it drives. Logic is unchanged from its previous home
 * (same `activePersona`/`selectedPersonaId`/`handleSavePersona` singleton
 * pattern already proven there) — only its location, and two new fields,
 * are new: `modelId` and `skillIds` (see `types/ai.ts`'s `Persona`), which
 * `providers/prompts.js`'s `skillsBlock()` reads to assemble the actual
 * system prompt a persona's chosen model receives.
 */
const PersonaComposer: React.FC = () => {
    const {
        customAiStyles, handleAddCustomStyle: onAddCustomStyle, handleUpdateCustomStyle: onUpdateCustomStyle, handleDeleteCustomStyle: onDeleteCustomStyle,
        personas, selectedPersonaId, handleSelectPersona: onSelectPersona, handleSavePersona: onSavePersona, handleDeletePersona,
        activePersona, setActivePersona: onActivePersonaChange, catalog,
    } = useAppContext();

    const [styleToAdd, setStyleToAdd] = useState<string>(customAiStyles[0]?.name || '');
    const fileImportRef = useRef<HTMLInputElement>(null);
    const [isManagingStyles, setIsManagingStyles] = useState(false);
    const [editingStyle, setEditingStyle] = useState<CustomAiStyle | null>(null);
    const [showStyleEditor, setShowStyleEditor] = useState(false);
    const [availableSkills, setAvailableSkills] = useState<SkillMeta[]>([]);

    useEffect(() => { apiService.listSkills().then(setAvailableSkills); }, []);

    const availableStyles = useMemo(() => customAiStyles.map(s => s.name), [customAiStyles]);
    const modelPrompts = useMemo(() => availableSkills.filter(s => s.kind === 'model-prompt'), [availableSkills]);
    const additiveSkills = useMemo(() => availableSkills.filter(s => s.kind === 'skill'), [availableSkills]);

    const updateActivePersona = (updates: Partial<Persona>) => onActivePersonaChange({ ...activePersona, ...updates });
    const handleAddComposedStyle = () => { if (styleToAdd && !activePersona.composedStyles.some(s => s.name === styleToAdd)) updateActivePersona({ composedStyles: [...activePersona.composedStyles, { name: styleToAdd, weight: 0.5 }] }); };
    const handleRemoveComposedStyle = (index: number) => updateActivePersona({ composedStyles: activePersona.composedStyles.filter((_, i) => i !== index) });
    const handleUpdateComposedStyle = (index: number, updates: Partial<ComposedStyle>) => { const newStyles = [...activePersona.composedStyles]; newStyles[index] = { ...newStyles[index], ...updates }; updateActivePersona({ composedStyles: newStyles }); };
    const handleMoveStyle = (index: number, direction: 'up' | 'down') => {
        const newStyles = [...activePersona.composedStyles];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= newStyles.length) return;
        [newStyles[index], newStyles[targetIndex]] = [newStyles[targetIndex], newStyles[index]];
        updateActivePersona({ composedStyles: newStyles });
    };
    const toggleSkill = (skillId: string) => {
        const current = activePersona.skillIds ?? [];
        updateActivePersona({ skillIds: current.includes(skillId) ? current.filter(id => id !== skillId) : [...current, skillId] });
    };

    const handleSaveCurrentPersona = () => {
        const personaName = selectedPersonaId ? personas.find(p => p.id === selectedPersonaId)?.name : window.prompt("Enter a name for this new persona:", "My New Persona");
        if (personaName) onSavePersona(personaName, {
            baseInstructions: activePersona.baseInstructions,
            composedStyles: activePersona.composedStyles,
            modelId: activePersona.modelId,
            skillIds: activePersona.skillIds,
        });
    };

    const handleExport = () => {
        const dataStr = JSON.stringify({ baseInstructions: activePersona.baseInstructions, composedStyles: activePersona.composedStyles, modelId: activePersona.modelId, skillIds: activePersona.skillIds }, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(personas.find(p => p.id === selectedPersonaId)?.name || 'untitled').toLowerCase().replace(/\s/g, '_')}_persona.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const imported = JSON.parse(e.target?.result as string);
                    if (imported.composedStyles && Array.isArray(imported.composedStyles)) {
                        onSelectPersona(null);
                        updateActivePersona({ name: 'Imported Persona', baseInstructions: imported.baseInstructions || '', composedStyles: imported.composedStyles, modelId: imported.modelId, skillIds: imported.skillIds });
                    } else alert("Invalid persona file format.");
                } catch (err) { alert("Error parsing persona file."); }
            };
            reader.readAsText(file);
        }
        if (event.target) event.target.value = '';
    };

    const handleSaveStyle = (id: string | null, name: string, instructions: string) => {
        if (id) onUpdateCustomStyle(id, name, instructions); else onAddCustomStyle(name, instructions);
        setShowStyleEditor(false);
    };

    return (
        <div className="bg-surface hairline rounded-lg p-3 space-y-4">
            {showStyleEditor && <CustomStyleEditor style={editingStyle} onSave={handleSaveStyle} onCancel={() => setShowStyleEditor(false)} existingNames={customAiStyles.filter(s => !s.isDefault).map(s => s.name)} />}
            <div className="pb-3 border-b border-white/[0.06]">
                <button onClick={() => setIsManagingStyles(!isManagingStyles)} className="tap w-full flex justify-between items-center text-left text-sm font-medium text-metal-300 md:hover:text-metal-100">Manage Style Blocks<svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-transform ${isManagingStyles ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></button>
                {isManagingStyles && (<div className="mt-3 space-y-2">
                    <div className="max-h-40 overflow-y-auto pr-2 space-y-2">
                        {customAiStyles.length === 0 && <p className="text-xs text-metal-400 italic text-center">No styles created yet.</p>}
                        {customAiStyles.map(style => (<div key={style.id} className={`flex items-center justify-between p-2 rounded-md ${style.isDefault ? 'bg-white/[0.04]' : 'bg-metal-700'}`}>
                            <div className="flex items-center gap-2">
                                {style.isDefault && <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-metal-300 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" /></svg>}
                                <span className="text-sm truncate" title={style.name}>{style.name}</span>
                            </div>
                            {!style.isDefault && (<div className="flex gap-2">
                                <button onClick={() => { setEditingStyle(style); setShowStyleEditor(true); }} className="p-1 text-metal-300 hover:text-metal-200" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" /></svg></button>
                                <button onClick={() => { if (window.confirm(`Delete "${style.name}"? This removes it from saved personas.`)) onDeleteCustomStyle(style.id); }} className="p-1 text-metal-300 hover:text-accent-soft" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                            </div>)}
                        </div>))}
                    </div>
                    <button onClick={() => { setEditingStyle(null); setShowStyleEditor(true); }} className="w-full p-2 bg-metal-700 hover:bg-metal-700 rounded-md text-sm transition-colors mt-2 font-semibold">Create New Custom Style</button>
                </div>)}
            </div>
            <div>
                <label htmlFor="persona-select" className="block text-xs font-semibold text-metal-300 mb-2">Load Persona</label>
                <div className="flex gap-2">
                    <select id="persona-select" value={selectedPersonaId || ''} onChange={e => onSelectPersona(e.target.value || null)} className="tap flex-1 min-w-0 px-3 bg-metal-700 rounded-lg text-sm focus:outline-none"><option value="">✨ New Persona (Unsaved)</option>{personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    {selectedPersonaId && (<button onClick={() => handleDeletePersona(selectedPersonaId)} className="tap p-2 rounded-md bg-metal-700 text-accent md:hover:bg-[#33333a]" title="Delete persona"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>)}
                </div>
            </div>
            <div className="pt-3 border-t border-white/[0.06] space-y-3">
                <h3 className="text-sm font-semibold text-metal-300">Persona Composer</h3>
                <div>
                    <label className="block text-xs font-semibold text-metal-300 mb-1">Model</label>
                    <select value={activePersona.modelId ?? ''} onChange={e => updateActivePersona({ modelId: e.target.value || undefined })} className="tap w-full px-3 bg-metal-700 rounded-lg text-sm focus:outline-none">
                        <option value="">Model-agnostic (no foundation prompt)</option>
                        {catalog.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                    {activePersona.modelId && !modelPrompts.some(s => s.id === activePersona.modelId) && (
                        <p className="mt-1.5 text-[11px] text-metal-400">No foundation prompt in the catalog for this model yet — the persona still works, just without one.</p>
                    )}
                </div>
                <div>
                    <label className="block text-xs font-semibold text-metal-300 mb-1">Skills</label>
                    <div className="flex flex-wrap gap-2">
                        {additiveSkills.map(s => {
                            const selected = (activePersona.skillIds ?? []).includes(s.id);
                            return (
                                <button key={s.id} onClick={() => toggleSkill(s.id)} aria-pressed={selected} title={s.description}
                                    className={`tap px-3 py-1.5 rounded-full text-xs font-medium transition-[background-color,box-shadow] duration-200 ease-fluid
                                                ${selected
                                                    ? 'bg-raised text-metal-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]'
                                                    : 'bg-white/[0.04] text-metal-300 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)] md:hover:bg-white/[0.07]'}`}>
                                    {s.name}
                                </button>
                            );
                        })}
                        {additiveSkills.length === 0 && <p className="text-xs text-metal-400 italic">No skills in the catalog.</p>}
                    </div>
                </div>
                <div><label className="block text-xs font-semibold text-metal-300 mb-1">Base Instructions</label><textarea placeholder="Enter core directives for the AI here..." value={activePersona.baseInstructions} onChange={e => updateActivePersona({ baseInstructions: e.target.value })} className="w-full h-24 p-2 bg-metal-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-accent" /></div>
                <div><label className="block text-xs font-semibold text-metal-300 mb-1">Composed Styles (Primary is first)</label>
                    <div className="space-y-2 p-2 bg-black/20 rounded-md">
                        {activePersona.composedStyles.map((style, index) => (<div key={index} className="flex items-center gap-2 bg-metal-700 p-2 rounded">
                            <div className="flex shrink-0"><button onClick={() => handleMoveStyle(index, 'up')} disabled={index === 0} aria-label="Move up" className="tap flex items-center justify-center rounded-lg text-xs text-metal-300 transition-colors duration-200 ease-fluid disabled:opacity-20 md:hover:text-metal-100 md:hover:bg-[#33333a]">&#9650;</button><button onClick={() => handleMoveStyle(index, 'down')} disabled={index === activePersona.composedStyles.length - 1} aria-label="Move down" className="tap flex items-center justify-center rounded-lg text-xs text-metal-300 transition-colors duration-200 ease-fluid disabled:opacity-20 md:hover:text-metal-100 md:hover:bg-[#33333a]">&#9660;</button></div>
                            <span className="font-semibold text-sm flex-1 truncate" title={style.name}>{style.name}</span>
                            <input type="range" min="0" max="1" step="0.05" value={style.weight} onChange={e => handleUpdateComposedStyle(index, { weight: Number(e.target.value) })} className="w-20 h-11 accent-metal-300" />
                            <span className="text-xs w-8 text-center">{Math.round(style.weight * 100)}%</span>
                            <button onClick={() => handleRemoveComposedStyle(index)} aria-label="Remove style"
                                className="tap flex items-center justify-center shrink-0 rounded-lg text-metal-300 text-lg leading-none
                                           transition-colors duration-200 ease-fluid md:hover:text-accent md:hover:bg-metal-700"><span aria-hidden>&times;</span></button>
                        </div>))}
                        {activePersona.composedStyles.length === 0 && <p className="text-center text-xs text-metal-400 italic py-2">No styles added. Add a style to begin composing.</p>}
                    </div>
                    <div className="flex gap-2 mt-2">
                        <select value={styleToAdd} onChange={e => setStyleToAdd(e.target.value)} className="tap flex-1 min-w-0 px-3 bg-metal-700 rounded-lg text-sm focus:outline-none">{availableStyles.map(s => <option key={s} value={s}>{s}</option>)}</select>
                        <button onClick={handleAddComposedStyle} className="tap px-4 bg-metal-700 rounded-lg md:hover:bg-[#33333a] text-sm font-medium">Add Style</button>
                    </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-white/[0.06]">
                    <button onClick={() => fileImportRef.current?.click()} className="tap px-4 bg-metal-700 text-metal-200 text-xs font-medium rounded-lg md:hover:bg-[#33333a]">Import</button><input type="file" ref={fileImportRef} onChange={handleFileImport} accept=".json" className="hidden" />
                    <button onClick={handleExport} className="tap px-4 bg-metal-700 text-metal-200 text-xs font-medium rounded-lg md:hover:bg-[#33333a]">Export</button>
                    <button onClick={handleSaveCurrentPersona} className="tap px-4 bg-raised text-metal-100 text-sm font-medium rounded-lg md:hover:bg-[#33333a]">{selectedPersonaId ? 'Update Persona' : 'Save as New Persona'}</button>
                </div>
            </div>
        </div>
    );
};

const AgentManager: React.FC = () => {
    const {
        agents, activeAgentId, projects, personas, handleSelectAgent,
        handleAddAgent, handleUpdateAgent, handleDeleteAgent
    } = useAppContext();
    const [isCreating, setIsCreating] = useState(false);
    const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

    const handleSaveAgent = (data: { id?: string; name: string; personaId: string; projectId: string; }) => {
        if (data.id) {
            handleUpdateAgent(data.id, data.name, data.personaId, data.projectId);
        } else {
            handleAddAgent(data.name, data.personaId, data.projectId);
        }
        setIsCreating(false);
        setEditingAgent(null);
    }

    const currentView = editingAgent ? 'edit' : isCreating ? 'create' : 'list';

    const iconButton =
        'tap flex items-center justify-center rounded-lg text-metal-300 ' +
        'transition-colors duration-200 ease-fluid md:hover:text-metal-100 md:hover:bg-metal-700';

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                {currentView === 'edit' && editingAgent && (<AgentForm agent={editingAgent} projects={projects} personas={personas} onSave={handleSaveAgent} onCancel={() => setEditingAgent(null)} />)}
                {currentView === 'create' && (<AgentForm projects={projects} personas={personas} onSave={handleSaveAgent} onCancel={() => setIsCreating(false)} />)}
                {currentView === 'list' && (<>
                    <button onClick={() => setIsCreating(true)} className={`${solid} w-full`}>Create new agent</button>
                    <div className="space-y-3">
                        {agents.length === 0 && <p className="text-sm text-center text-metal-300 pt-4">No agents created yet.</p>}
                        {agents.map(agent => {
                            const isSelected = activeAgentId === agent.id;
                            const persona = personas.find(p => p.id === agent.personaId);
                            const project = projects.find(p => p.id === agent.projectId);
                            return (
                                <div
                                    key={agent.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={isSelected}
                                    onClick={() => handleSelectAgent(isSelected ? null : agent.id)}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectAgent(isSelected ? null : agent.id); } }}
                                    /* Selected is a state you caused: it rises and brightens. No orange. */
                                    className={`p-3 rounded-card cursor-pointer
                                                transition-[background-color,box-shadow] duration-200 ease-fluid
                                                ${isSelected
                                                    ? 'bg-raised shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]'
                                                    : 'bg-white/[0.04] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)] md:hover:bg-white/[0.07]'}`}
                                >
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="min-w-0">
                                            <p className={`font-medium truncate ${isSelected ? 'text-metal-100' : 'text-metal-200'}`}>{agent.name}</p>
                                            <div className="mt-1 space-y-0.5">
                                                <p className="text-xs text-metal-300 truncate">Persona · <span className="meta">{persona?.name || 'unknown'}</span></p>
                                                <p className="text-xs text-metal-300 truncate">Knowledge · <span className="meta">{project?.name || 'unknown'}</span></p>
                                            </div>
                                        </div>
                                        <div className="flex items-center shrink-0">
                                            <button onClick={(e) => { e.stopPropagation(); setEditingAgent(agent); }} className={iconButton} aria-label={`Edit ${agent.name}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" /></svg></button>
                                            {/* The one control here that can lose you something. */}
                                            <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete agent "${agent.name}"? This also deletes its chat history.`)) { handleDeleteAgent(agent.id); } }} className={`${iconButton} md:hover:text-accent`} aria-label={`Delete ${agent.name}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>)}
            </div>

            <div>
                <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-3">Compose a persona</h2>
                <PersonaComposer />
            </div>
        </div>
    );
};

export default AgentManager;
