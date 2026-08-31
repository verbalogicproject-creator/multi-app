import React, { useState } from 'react';
import { Agent, Persona, Project } from '../types/index';
import { useAppContext } from '../context/AppContext';

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

    if (projects.length === 0 || personas.length === 0) {
        return (
            <div className="p-4 bg-yellow-900/50 border border-yellow-700 rounded-lg text-sm text-yellow-200">
                <p className="font-bold mb-2">Prerequisites Missing</p>
                <p>To create an Agent, you must first have at least one Project and one saved Persona.</p>
                <button onClick={onCancel} className="mt-3 px-3 py-1 bg-gray-600 rounded-md hover:bg-gray-500 text-xs">Got it</button>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="p-4 bg-gray-700/50 border border-gray-600 rounded-lg space-y-4">
             <h3 className="text-md font-bold text-sky-400">{isEditing ? `Edit Agent: ${agent.name}` : 'Create New Agent'}</h3>
             {error && <p className="text-red-400 text-sm">{error}</p>}
             <div><label htmlFor="agent-name" className="block text-sm font-medium text-gray-300 mb-1">Agent Name</label><input id="agent-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., React Expert" className="w-full p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
             <div><label htmlFor="agent-persona" className="block text-sm font-medium text-gray-300 mb-1">Behavior (Persona)</label><select id="agent-persona" value={personaId} onChange={e => setPersonaId(e.target.value)} className="w-full p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-sky-500">{personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
             <div><label htmlFor="agent-project" className="block text-sm font-medium text-gray-300 mb-1">Knowledge Base (Project)</label><select id="agent-project" value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-sky-500">{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-600 rounded-md hover:bg-gray-500 transition-colors text-sm font-semibold">Cancel</button><button type="submit" className="px-4 py-2 bg-sky-600 rounded-md hover:bg-sky-500 transition-colors text-sm font-semibold">{isEditing ? 'Save Changes' : 'Create Agent'}</button></div>
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
    
    return (
        <div className="space-y-4">
            {currentView === 'edit' && editingAgent && (<AgentForm agent={editingAgent} projects={projects} personas={personas} onSave={handleSaveAgent} onCancel={() => setEditingAgent(null)} />)}
            {currentView === 'create' && (<AgentForm projects={projects} personas={personas} onSave={handleSaveAgent} onCancel={() => setIsCreating(false)} />)}
            {currentView === 'list' && (<>
                <button onClick={() => setIsCreating(true)} className="w-full p-2 bg-sky-600 rounded-md hover:bg-sky-500 transition-colors text-sm font-semibold">Create New Agent</button>
                <div className="space-y-3">
                    {agents.length === 0 && <p className="text-sm text-center text-gray-500 italic pt-4">No agents created yet.</p>}
                    {agents.map(agent => {
                        const isSelected = activeAgentId === agent.id;
                        const persona = personas.find(p => p.id === agent.personaId);
                        const project = projects.find(p => p.id === agent.projectId);
                        return (
                            <div key={agent.id} className={`p-3 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-sky-800/50 border-2 border-sky-500' : 'bg-gray-700/50 hover:bg-gray-700'}`} onClick={() => handleSelectAgent(isSelected ? null : agent.id)}>
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="font-bold text-white">{agent.name}</p>
                                    <div className="text-xs text-gray-400 mt-1">
                                        <p>Persona: <span className="font-medium text-gray-300">{persona?.name || 'Unknown'}</span></p>
                                        <p>Knowledge: <span className="font-medium text-gray-300">{project?.name || 'Unknown'}</span></p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={(e) => { e.stopPropagation(); setEditingAgent(agent); }} className="p-1 text-gray-400 hover:text-sky-400" title="Edit Agent"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" /></svg></button>
                                    <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete agent "${agent.name}"? This also deletes its chat history.`)) { handleDeleteAgent(agent.id); } }} className="p-1 text-gray-400 hover:text-red-400" title="Delete Agent"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
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