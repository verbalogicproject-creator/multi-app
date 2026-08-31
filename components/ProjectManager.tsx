import React, { useState } from 'react';
import AiControls from './AiControls';
import LoadingIndicator from './LoadingIndicator';
import AgentManager from './AgentManager';
import { useAppContext } from '../context/AppContext';
import { Project, ProjectFile } from '../types/index';

const ProjectManager: React.FC = () => {
    const {
        projects, 
        selectedProjectIds, 
        filesByProject, 
        handleCreateProject, 
        handleDeleteProject, 
        handleToggleProjectSelection, 
        handleViewProjectFiles,
        activeProjectView, 
        handleOpenProjectSettings, 
        isProjectPanelCollapsed, 
        handleToggleProjectPanel,
        analyzingProjects,
        activeAgentId,
        activeTab,
        setActiveTab,
    } = useAppContext();
    
    const [newProjectName, setNewProjectName] = useState('');

    const handleCreate = () => {
        if (newProjectName.trim()) {
            handleCreateProject(newProjectName.trim());
            setNewProjectName('');
        }
    };

    const handleExportProject = (project: Project, files: ProjectFile[]) => {
        const exportData = {
            project,
            files,
        };
        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name.toLowerCase().replace(/\s+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };
    
    type TabName = 'projects' | 'agents' | 'ai-settings' | 'tools';
    const tabButtonClasses = (tabName: TabName, disabled = false) => 
        `px-4 py-2 text-sm font-semibold transition-colors duration-200 border-b-2 focus:outline-none ${
            disabled ? 'text-gray-600 border-transparent cursor-not-allowed' :
            activeTab === tabName 
            ? 'border-sky-500 text-sky-400' 
            : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
        }`;


    return (
        <aside className={`bg-gray-800 border-r border-gray-700 flex flex-col shrink-0 transition-all duration-300 ease-in-out ${isProjectPanelCollapsed ? 'w-16' : 'w-96'}`}>
            <div className={`flex items-center p-4 ${isProjectPanelCollapsed ? 'justify-center' : 'justify-between'}`}>
                {!isProjectPanelCollapsed && <h2 className="text-xl font-bold text-sky-400 capitalize">{activeTab.replace('-', ' ')}</h2>}
                <button onClick={handleToggleProjectPanel} className="p-1 rounded-full text-gray-400 hover:text-white hover:bg-gray-700" aria-label={isProjectPanelCollapsed ? 'Expand panel' : 'Collapse panel'}>
                    {isProjectPanelCollapsed ? <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>}
                </button>
            </div>
            {!isProjectPanelCollapsed && (
              <>
                <div className="flex border-b border-gray-700 px-2">
                    <button onClick={() => setActiveTab('projects')} className={tabButtonClasses('projects')}>Projects</button>
                    <button onClick={() => setActiveTab('agents')} className={tabButtonClasses('agents')}>Agents</button>
                    <button onClick={() => setActiveTab('tools')} className={tabButtonClasses('tools', !!activeAgentId)} disabled={!!activeAgentId} title={activeAgentId ? "AI Tools are disabled while an Agent is active" : ""}>AI Tools</button>
                    <button onClick={() => setActiveTab('ai-settings')} className={tabButtonClasses('ai-settings', !!activeAgentId)} disabled={!!activeAgentId} title={activeAgentId ? "AI settings are managed by the active Agent" : ""}>AI Settings</button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {activeTab === 'projects' && (
                        <>
                            <div className="flex gap-2">
                                <input type="text" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="New project name..." className="flex-1 p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                                <button onClick={handleCreate} className="p-2 bg-sky-600 rounded-md hover:bg-sky-500 transition-colors text-sm font-semibold">Create</button>
                            </div>

                            {projects.length === 0 && <p className="text-sm text-gray-500">No projects yet. Create one to get started!</p>}
                            <ul className="space-y-3">
                                {projects.map(p => (
                                    <li key={p.id} className={`bg-gray-700/50 rounded-lg ${activeAgentId ? 'opacity-50' : ''}`}>
                                        <div className="flex items-center justify-between p-3">
                                            <label className="flex items-center gap-3 cursor-pointer">
                                                <input type="checkbox" checked={selectedProjectIds.has(p.id)} onChange={() => handleToggleProjectSelection(p.id)} className="form-checkbox h-5 w-5 bg-gray-800 border-gray-600 rounded text-sky-600 focus:ring-sky-500" disabled={!!activeAgentId}/>
                                                <span className="font-semibold hover:text-sky-400">{p.name}</span>
                                            </label>
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => handleExportProject(p, filesByProject.get(p.id) || [])} className="text-gray-400 hover:text-sky-400 p-1" aria-label={`Export ${p.name}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg></button>
                                                <button onClick={() => handleOpenProjectSettings(p)} className="text-gray-400 hover:text-sky-400 p-1" aria-label={`Settings for ${p.name}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
                                                <button onClick={() => handleDeleteProject(p.id)} className="text-gray-500 hover:text-red-400 text-2xl leading-none">&times;</button>
                                            </div>
                                        </div>
                                        {p.dependencySummary && (
                                            <div className="px-3 pb-2 text-xs text-gray-400 border-t border-gray-600/50 pt-2">
                                              <details>
                                                <summary className="cursor-pointer font-semibold hover:text-gray-200 flex items-center gap-2">
                                                    Detected Dependencies
                                                    {analyzingProjects.has(p.id) && <div className="scale-50"><LoadingIndicator /></div>}
                                                </summary>
                                                <pre className="mt-2 p-2 bg-gray-900 rounded text-xs overflow-x-auto"><code>{p.dependencySummary}</code></pre>
                                              </details>
                                            </div>
                                        )}
                                        {activeProjectView === p.id && (
                                            <div className="p-3 border-t border-gray-600">
                                                <ul className="text-xs space-y-1">
                                                    {(filesByProject.get(p.id) || []).map(file => ( <li key={file.id} className="flex justify-between items-center bg-gray-800 p-1 rounded"><span className="truncate" title={file.path}>{file.path}</span></li> ))}
                                                    {(filesByProject.get(p.id) || []).length === 0 && <p className="text-gray-500 text-center italic text-xs">No files yet.</p>}
                                                </ul>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                    {activeTab === 'agents' && <AgentManager />}
                    {activeTab === 'ai-settings' && <AiControls />}
                    {activeTab === 'tools' && (
                        <div className="text-center p-4">
                            <p className="text-lg font-semibold text-gray-200">Web App Builder</p>
                            <p className="text-sm text-gray-400 mt-2">Create a new React webpage from an idea using our guided wizard.</p>
                             <div className="mt-4 p-4 border border-dashed border-gray-600 rounded-lg">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c.251.023.501.05.75.082a.75.75 0 01.75.75v5.714a2.25 2.25 0 00.659 1.591L14.25 14.5M9.75 3.104a2.25 2.25 0 00-1.632-2.062M14.25 14.5a2.25 2.25 0 01-1.632 2.062M14.25 14.5a2.25 2.25 0 001.632 2.062M14.25 14.5L19 19.25l-4.75-4.75M9.75 14.5L5 19.25l4.75-4.75" /></svg>
                                <p className="text-xs text-gray-500 mt-2">Select a tool to get started. It will open in the main panel.</p>
                            </div>
                        </div>
                    )}
                </div>
              </>
            )}
        </aside>
    );
}

export default ProjectManager;