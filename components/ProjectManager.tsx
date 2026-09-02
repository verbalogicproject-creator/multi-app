import React, { useState } from 'react';
import AiControls from './AiControls';
import LoadingIndicator from './LoadingIndicator';
import AgentManager from './AgentManager';
import { useAppContext } from '../context/AppContext';
import { Project, ProjectFile } from '../types/index';

/**
 * The rail. A fixed column from `md:` up, and the whole screen on a phone —
 * where it is a destination reached from the tab bar rather than something
 * permanently eating 384px of a 390px viewport.
 *
 * Collapsing is a desktop affordance: on a phone the rail is either the screen
 * you are on or not on screen at all, so there is nothing to collapse. The
 * button and the collapsed state are therefore gated at `md:` in CSS rather
 * than in state, which keeps one source of truth across the breakpoint.
 */
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

    // Selection is state you caused — value and a rule, never the accent.
    const tabButtonClasses = (tabName: TabName, disabled = false) =>
        [
            'tap shrink-0 px-4 text-sm font-medium border-b-2',
            'transition-colors duration-200 ease-[--ease-fluid]',
            disabled
                ? 'text-metal-500 border-transparent cursor-not-allowed opacity-60'
                : activeTab === tabName
                    ? 'border-metal-300 text-metal-100'
                    : 'border-transparent text-metal-300 md:hover:text-metal-100 md:hover:border-metal-700',
        ].join(' ');

    const iconButton =
        'tap flex items-center justify-center rounded-lg text-metal-300 ' +
        'transition-colors duration-200 ease-[--ease-fluid] md:hover:text-metal-100 md:hover:bg-metal-700';

    return (
        <aside
            className={`bg-surface shadow-[inset_-1px_0_0_rgb(255_255_255/0.06)] flex flex-col w-full min-w-0
                        md:shrink-0 md:transition-[width] md:duration-300 md:ease-[--ease-fluid]
                        ${isProjectPanelCollapsed ? 'md:w-16' : 'md:w-96'}`}
        >
            <div className={`flex items-center gap-2 px-4 py-2 safe-t md:pt-2
                             ${isProjectPanelCollapsed ? 'md:justify-center' : 'justify-between'}`}>
                <h2 className={`font-display text-lg tracking-[-0.02em] text-metal-100 capitalize truncate
                                ${isProjectPanelCollapsed ? 'md:hidden' : ''}`}>
                    {activeTab.replace('-', ' ')}
                </h2>
                {/* Collapsing only means something where the rail shares the screen. */}
                <button
                    onClick={handleToggleProjectPanel}
                    className={`${iconButton} hidden md:flex shrink-0`}
                    aria-label={isProjectPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
                >
                    {isProjectPanelCollapsed
                        ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                        : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>}
                </button>
            </div>

            {/* Collapsed hides the contents at md: only — a phone has no collapsed rail. */}
            <div className={`flex-1 flex flex-col min-h-0 ${isProjectPanelCollapsed ? 'md:hidden' : ''}`}>
                <div className="flex px-2 overflow-x-auto shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]">
                    <button onClick={() => setActiveTab('projects')} className={tabButtonClasses('projects')}>Projects</button>
                    <button onClick={() => setActiveTab('agents')} className={tabButtonClasses('agents')}>Agents</button>
                    <button onClick={() => setActiveTab('tools')} className={tabButtonClasses('tools', !!activeAgentId)} disabled={!!activeAgentId} title={activeAgentId ? "AI Tools are disabled while an Agent is active" : ""}>AI Tools</button>
                    <button onClick={() => setActiveTab('ai-settings')} className={tabButtonClasses('ai-settings', !!activeAgentId)} disabled={!!activeAgentId} title={activeAgentId ? "AI settings are managed by the active Agent" : ""}>AI Settings</button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
                    {activeTab === 'projects' && (
                        <>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newProjectName}
                                    onChange={e => setNewProjectName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                                    placeholder="New project name…"
                                    className="tap flex-1 min-w-0 px-3 bg-raised rounded-lg text-sm text-metal-100
                                               placeholder:text-metal-400 hairline focus:outline-none"
                                />
                                <button
                                    onClick={handleCreate}
                                    className="tap shrink-0 px-4 rounded-lg bg-metal-700 text-metal-100 text-sm font-medium
                                               shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                                               transition-[background-color,transform] duration-200 ease-[--ease-fluid]
                                               md:hover:bg-[#33333a] active:scale-[0.98]"
                                >
                                    Create
                                </button>
                            </div>

                            {projects.length === 0 && (
                                <p className="text-sm text-metal-300">No projects yet. Create one to get started.</p>
                            )}
                            <ul className="space-y-3">
                                {projects.map(p => (
                                    <li key={p.id} className={`rounded-[--radius-card] bg-raised hairline ${activeAgentId ? 'opacity-50' : ''}`}>
                                        <div className="flex items-center justify-between gap-2 p-3">
                                            <label className="flex items-center gap-3 cursor-pointer min-w-0">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedProjectIds.has(p.id)}
                                                    onChange={() => handleToggleProjectSelection(p.id)}
                                                    className="h-5 w-5 shrink-0 rounded bg-ground accent-[--color-accent]"
                                                    disabled={!!activeAgentId}
                                                />
                                                <span className="font-medium text-metal-100 truncate">{p.name}</span>
                                            </label>
                                            <div className="flex items-center shrink-0">
                                                <button onClick={() => handleExportProject(p, filesByProject.get(p.id) || [])} className={iconButton} aria-label={`Export ${p.name}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg></button>
                                                <button onClick={() => handleOpenProjectSettings(p)} className={iconButton} aria-label={`Settings for ${p.name}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
                                                {/* Destructive: metal body, accent glyph. The colour marks the one
                                                    control here that can lose you something. */}
                                                <button onClick={() => handleDeleteProject(p.id)} className={`${iconButton} md:hover:text-accent`} aria-label={`Delete ${p.name}`}><span aria-hidden className="text-xl leading-none">&times;</span></button>
                                            </div>
                                        </div>
                                        {p.dependencySummary && (
                                            <div className="px-3 pb-3 pt-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
                                              <details>
                                                <summary className="cursor-pointer text-xs font-medium text-metal-300 md:hover:text-metal-100 flex items-center gap-2">
                                                    Detected dependencies
                                                    {analyzingProjects.has(p.id) && <div className="scale-50"><LoadingIndicator /></div>}
                                                </summary>
                                                <pre className="meta mt-2 p-2 bg-ground rounded-lg text-[11px] overflow-x-auto"><code>{p.dependencySummary}</code></pre>
                                              </details>
                                            </div>
                                        )}
                                        {activeProjectView === p.id && (
                                            <div className="p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
                                                <ul className="space-y-1">
                                                    {(filesByProject.get(p.id) || []).map(file => (
                                                        <li key={file.id} className="meta text-[11px] bg-ground px-2 py-1 rounded truncate" title={file.path}>{file.path}</li>
                                                    ))}
                                                    {(filesByProject.get(p.id) || []).length === 0 && <p className="text-xs text-metal-300 text-center">No files yet.</p>}
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
                            <p className="font-display text-lg tracking-[-0.02em] text-metal-100">Web App Builder</p>
                            <p className="text-sm text-metal-300 mt-2">Create a new React webpage from an idea using the guided wizard.</p>
                            <div className="mt-4 p-5 rounded-[--radius-card] bg-raised hairline">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto text-metal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c.251.023.501.05.75.082a.75.75 0 01.75.75v5.714a2.25 2.25 0 00.659 1.591L14.25 14.5M9.75 3.104a2.25 2.25 0 00-1.632-2.062M14.25 14.5a2.25 2.25 0 01-1.632 2.062M14.25 14.5a2.25 2.25 0 001.632 2.062M14.25 14.5L19 19.25l-4.75-4.75M9.75 14.5L5 19.25l4.75-4.75" /></svg>
                                <p className="text-xs text-metal-300 mt-3">Pick a tool to begin. It opens in the main panel.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
}

export default ProjectManager;
