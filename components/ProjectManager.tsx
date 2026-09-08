import React, { useState } from 'react';
import LoadingIndicator from './LoadingIndicator';
import { useAuth } from '../hooks/useAuth';
import { useAppContext } from '../context/AppContext';
import { Project, ProjectFile } from '../types/index';

/**
 * Projects: home, and the whole screen.
 *
 * It was a rail — a fixed 384px column from `md:` up with a tab strip on top and a
 * collapse toggle, holding Agents and AI Settings as siblings of the project list. All
 * three of those went to the dock, and what is left is a destination, so it measures
 * itself in the viewport rather than in rail widths. The collapse toggle went with the
 * rail: there is nothing to collapse *into* when the panel is the screen.
 *
 * The list is a single column on a phone and a grid from `sm:` up, because a project
 * card wants about 20rem and a wide screen has room for several — mobile-first, one
 * layout, no breakpoint-specific second design.
 *
 * A checkbox still does two jobs here — it picks the IDE's project *and* chat's context.
 * That is the spine migration's problem to solve, and it is named rather than hidden.
 */
const ProjectManager: React.FC = () => {
    const {
        projects,
        selectedProjectIds,
        filesByProject,
        handleCreateProject,
        handleDeleteProject,
        projectDeletionCost,
        handleToggleProjectSelection,
        handleViewProjectFiles,
        activeProjectView,
        handleOpenProjectSettings,
        analyzingProjects,
        activeAgentId,
    } = useAppContext();

    const [newProjectName, setNewProjectName] = useState('');
    /* Which project is one press away from being gone. Deletion used to be a single
       click on a small × — immediate, irreversible, and next to two harmless icons.
       There is no undo anywhere in this app, so the confirmation is the only thing
       between a mis-tap and losing a project's files. */
    const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
    /* Who you are, on the screen that is home. It renders nothing at all when the
       backend is not enforcing authentication — which is the loopback development
       posture — so a signed-out app does not grow an empty account row. Signing out
       needs somewhere to be pressed, and a session with no way to end it is the same
       kind of orphan as a panel with no way to open it. */
    const { user, isAuthenticated, logout } = useAuth();

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

    const iconButton =
        'tap flex items-center justify-center rounded-lg text-metal-300 ' +
        'transition-colors duration-200 ease-fluid md:hover:text-metal-100 md:hover:bg-metal-700';

    return (
        <section className="flex-1 flex flex-col min-w-0 min-h-0 bg-ground">
            <div className="shrink-0 w-full max-w-5xl mx-auto px-4 md:px-6 pt-5 safe-t">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="font-display text-2xl md:text-3xl tracking-[-0.03em] text-metal-100">Projects</h1>
                        <p className="mt-1 text-sm text-metal-300">Tick one to open it in the editor and the preview.</p>
                    </div>
                    {isAuthenticated && user && (
                        <div className="shrink-0 flex items-center gap-2 text-xs text-metal-300">
                            <span className="truncate max-w-[10rem]" title={user.email}>{user.email}</span>
                            <button
                                onClick={logout}
                                className="tap px-2 rounded-lg text-metal-200 underline underline-offset-2
                                           transition-colors duration-200 ease-fluid
                                           md:hover:text-metal-100 md:hover:bg-metal-700"
                            >
                                Sign out
                            </button>
                        </div>
                    )}
                </div>
            </div>

                {/* The tab strip is gone, and that is the point of the dock.
                    `Projects` is a destination now, `Agents` and `AI Settings` are the
                    Harness, and `AI Tools` was dead the whole time — its tab lived here
                    while its content rendered in the main panel, so a phone that tapped
                    it got an empty card. Two levels of navigation saying the same thing
                    is how the two came to disagree. */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 w-full max-w-5xl mx-auto space-y-4">
                    {(
                        <>
                            <div className="flex gap-2 max-w-xl">
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
                                               transition-[background-color,transform] duration-200 ease-fluid
                                               md:hover:bg-[#33333a] active:scale-[0.98]"
                                >
                                    Create
                                </button>
                            </div>

                            {projects.length === 0 && (
                                <p className="text-sm text-metal-300">No projects yet. Create one to get started.</p>
                            )}
                            {/* One column on a phone, more when there is room for more —
                                the same list, not a second design. */}
                            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 items-start">
                                {projects.map(p => (
                                    <li key={p.id} className={`rounded-card bg-raised hairline ${activeAgentId ? 'opacity-50' : ''}`}>
                                        {/* Name on its own line, actions under it.
                                            They shared a row while this was a full-width
                                            rail, where there was room for both. As cards
                                            in a grid there is not: four 44px controls
                                            take ~176px of a ~317px card, leaving the name
                                            about eighty pixels, so "Harbour Dashboard"
                                            rendered as "Harbour D…" with nine hundred
                                            pixels of empty screen beside it.

                                            Nothing could catch that. `truncate` is valid,
                                            nothing overflowed, every target still met
                                            44px — `audit:ui` reported zero findings on
                                            this exact screen. It was found by opening the
                                            screenshot the audit had been producing all
                                            along and never being read. */}
                                        <div className="flex flex-col gap-1 p-3">
                                            <label className="tap flex items-center gap-3 cursor-pointer min-w-0">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedProjectIds.has(p.id)}
                                                    onChange={() => handleToggleProjectSelection(p.id)}
                                                    className="h-5 w-5 shrink-0 rounded bg-ground accent-metal-300"
                                                    disabled={!!activeAgentId}
                                                />
                                                <span className="font-medium text-metal-100 truncate" title={p.name}>{p.name}</span>
                                            </label>
                                            <div className="flex items-center -ml-1">
                                                {/* The file list below had no control that
                                                    opened it: `handleViewProjectFiles` was
                                                    read out of the context and never called,
                                                    so `activeProjectView` could only ever be
                                                    null and the whole branch was unreachable.
                                                    A panel nothing can open is the same as a
                                                    panel that does not exist. */}
                                                <button
                                                    onClick={() => handleViewProjectFiles(p.id)}
                                                    className={iconButton}
                                                    aria-expanded={activeProjectView === p.id}
                                                    aria-label={`${activeProjectView === p.id ? 'Hide' : 'Show'} files in ${p.name}`}
                                                ><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg></button>
                                                <button onClick={() => handleExportProject(p, filesByProject.get(p.id) || [])} className={iconButton} aria-label={`Export ${p.name}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg></button>
                                                <button onClick={() => handleOpenProjectSettings(p)} className={iconButton} aria-label={`Settings for ${p.name}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
                                                {/* Destructive: metal body, accent glyph. The colour marks the one
                                                    control here that can lose you something. */}
                                                <button onClick={() => setConfirmingDelete(p.id)} className={`${iconButton} md:hover:text-accent`} aria-label={`Delete ${p.name}`}><span aria-hidden className="text-xl leading-none">&times;</span></button>
                                            </div>
                                        </div>
                                        {/* The confirmation names everything the deletion
                                            takes, including the experts bound to this
                                            project — they are deleted too, because an
                                            agent whose project is gone is a control that
                                            resolves to nothing. A step that hides part of
                                            what it does is worse than no step at all. */}
                                        {confirmingDelete === p.id && (() => {
                                            const cost = projectDeletionCost(p.id);
                                            return (
                                                <div className="p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
                                                    <p className="flex items-start gap-2 text-sm text-metal-100">
                                                        <span aria-hidden className="w-1.5 h-1.5 mt-1.5 rounded-full bg-accent shrink-0" />
                                                        <span>
                                                            Delete <strong className="font-medium">{p.name}</strong>?
                                                            {' '}This cannot be undone.
                                                        </span>
                                                    </p>
                                                    <p className="mt-1 pl-3.5 text-xs text-metal-300">
                                                        {cost.files === 0 ? 'No files' : `${cost.files} file${cost.files === 1 ? '' : 's'}`}
                                                        {cost.agents.length > 0 && ` · ${cost.agents.length} expert${cost.agents.length === 1 ? '' : 's'} bound to it (${cost.agents.join(', ')})`}
                                                        {' will go with it.'}
                                                    </p>
                                                    <div className="mt-3 pl-3.5 flex items-center gap-2">
                                                        <button
                                                            onClick={() => { setConfirmingDelete(null); handleDeleteProject(p.id); }}
                                                            aria-label={`Confirm deleting ${p.name}`}
                                                            className="tap px-3 rounded-lg bg-metal-700 text-accent text-sm font-medium
                                                                       shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                                                                       transition-[background-color,transform] duration-200 ease-fluid
                                                                       md:hover:bg-[#33333a] active:scale-[0.98]"
                                                        >
                                                            Delete
                                                        </button>
                                                        <button
                                                            onClick={() => setConfirmingDelete(null)}
                                                            className="tap px-3 rounded-lg text-metal-300 text-sm
                                                                       transition-colors duration-200 ease-fluid md:hover:text-metal-100"
                                                        >
                                                            Keep
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                        {p.dependencySummary && (
                                            <div className="px-3 pb-3 pt-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
                                              <details>
                                                <summary className="tap cursor-pointer text-xs font-medium text-metal-300 md:hover:text-metal-100 flex items-center gap-2">
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
                </div>
        </section>
    );
}

export default ProjectManager;
