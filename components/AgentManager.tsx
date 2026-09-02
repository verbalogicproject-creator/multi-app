import React, { useState } from 'react';
import { Agent, Persona, Project } from '../types/index';
import { useAppContext } from '../context/AppContext';

const field =
    'tap w-full px-3 bg-raised rounded-lg text-sm text-metal-100 ' +
    'placeholder:text-metal-400 hairline focus:outline-none';

const button =
    'tap px-4 rounded-lg text-sm font-medium ' +
    'transition-[background-color,transform] duration-200 ease-[--ease-fluid] ' +
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
            <div className="p-4 rounded-[--radius-card] bg-raised hairline text-sm">
                <p className="flex items-center gap-2 font-medium text-metal-100 mb-2">
                    <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                    Prerequisites missing
                </p>
                <p className="text-metal-300 leading-relaxed">
                    To create an agent you need at least one project and one saved persona.
                </p>
                <button onClick={onCancel} className={`${quiet} mt-3`}>Got it</button>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="p-4 rounded-[--radius-card] bg-raised hairline space-y-4">
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
        'transition-colors duration-200 ease-[--ease-fluid] md:hover:text-metal-100 md:hover:bg-metal-700';

    return (
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
                                className={`p-3 rounded-[--radius-card] cursor-pointer
                                            transition-[background-color,box-shadow] duration-200 ease-[--ease-fluid]
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
    );
};

export default AgentManager;
