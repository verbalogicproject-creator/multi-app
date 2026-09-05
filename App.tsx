import React, { useCallback, useEffect, useState } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import ProjectManager from './components/ProjectManager';
import ChatPanel from './components/ChatPanel';
import IdeView from './components/IdeView';
import WebAppBuilder from './components/builders/WebAppBuilder';
import ProjectSettingsModal from './components/ProjectSettingsModal';
import MemoryPanel from './components/memory/MemoryPanel';
import AppDock from './components/AppDock';
import PreviewHost from './components/PreviewHost';
import Harness from './components/Harness';

/**
 * The shell: one dock, six destinations, one layout.
 *
 * This replaces two navigation systems that disagreed with each other — a four-slot
 * phone bar plus a rail of tabs inside one of its slots. Chat and Build shared a slot
 * whose label flipped depending on a rail tab, so what you tapped and what you got were
 * decided in different places, and `AI Tools` was dead because its tab lived in one
 * destination and its content rendered in another.
 *
 * **A destination fills the screen, at every width.** The first pass kept a desktop
 * two-up — the chosen destination at two thirds with chat beside it — which is the
 * arrangement that produced the problem in the first place: a second place for a
 * destination to be meant every destination had two layouts, two sets of widths, and
 * two ways to be wrong. One layout that grows is not a compromise here; it is the
 * reason the dock could replace the rail at all.
 *
 * What that costs, stated rather than glossed: you can no longer watch chat and the
 * editor at once on a wide screen. That is a real loss, and the honest place to give it
 * back is a split the user chooses, not a split the shell imposes on six destinations
 * that mostly do not want one.
 *
 * `DESIGN.md §1` locked "phone nav: bottom tab bar" and "two designs, not one layout
 * that recomposes". Both are overturned here on purpose and rewritten there with the
 * reason.
 *
 * Surfaces are hidden, never unmounted. Chat scroll, an unsent message and terminal
 * history all survive a trip elsewhere and back, which is why they are `hidden` rather
 * than conditional.
 */
const AppContent: React.FC = () => {
    const {
        globalError, setGlobalError, activeAgentId, agents, projects, selectedProjectIds,
        surface, setSurface,
        editingProject, filesByProject, handleCloseProjectSettings, handleRenameProject, handleAddFile, handleDeleteFile,
    } = useAppContext();
    const activeAgent = agents.find(a => a.id === activeAgentId);

    /**
     * The project the IDE is editing.
     *
     * It used to be `activeAgent.projectId`, full stop — which made the editor
     * unreachable by the one path built to reach it. "Open in IDE" creates the
     * project, writes every file, and deselects the agent; with the IDE gated on an
     * agent, the button whose only job was to open the editor guaranteed it was
     * closed, and the Code tab stayed grey.
     *
     * `IdeView` only ever needed a `projectId`. An agent names one, and otherwise it
     * is the project you last ticked in Projects — a `Set` keeps insertion order, so
     * "last" is the one you most recently ticked.
     *
     * **And it has to still exist.** Naming a project is not the same as having one:
     * deleting a project does not repair the agents bound to it, so an active agent goes
     * on reporting a `projectId` that nothing answers to. That id is truthy, so Code and
     * Preview stayed enabled, the guard below never fired, and both destinations rendered
     * against a project that was gone — an editor with no files and no explanation. The
     * same hole swallows an agent restored from storage whose project was deleted in
     * another session.
     *
     * So the candidate is checked against the projects that are actually loaded. An id
     * nobody can resolve is the same as no id at all, and saying so here means every
     * consumer — the availability hints, the redirect, the preview's file map — agrees
     * without each having to remember.
     *
     * Worth knowing before the layout pass: that checkbox is doing two jobs at once,
     * choosing chat's context *and* the IDE's target. Making it work is not the same
     * as making it right.
     */
    const candidateProjectId = activeAgent?.projectId ?? [...selectedProjectIds].at(-1) ?? null;
    const ideProjectId = candidateProjectId && projects.some(p => p.id === candidateProjectId)
        ? candidateProjectId
        : null;

    const [memoryOpen, setMemoryOpen] = useState(false);
    const [memoryNeedsYou, setMemoryNeedsYou] = useState(false);

    /* Code and Preview both need a project, and the dock says so before you tap.
       This is the other half: if the project goes away while you are standing in one,
       you land where projects are opened rather than on an empty editor. */
    useEffect(() => {
        if ((surface === 'code' || surface === 'preview') && !ideProjectId) setSurface('projects');
    }, [surface, ideProjectId, setSurface]);

    const handleNeedsYou = useCallback((needsYou: boolean) => setMemoryNeedsYou(needsYou), []);

    const files = ideProjectId ? (filesByProject.get(ideProjectId) ?? []) : [];
    const previewFiles = React.useMemo(() => {
        const record: Record<string, string> = {};
        for (const file of files) record[file.path] = file.content ?? '';
        return record;
    }, [files]);

    const noProject = 'Open a project to see this.';
    const unavailable = ideProjectId ? {} : { code: noProject, preview: noProject };

    /* One destination, full width, at every width. `flex-1` rather than a fraction:
       the pane is the screen, and `min-w-0` keeps a wide child — the editor's long
       lines, the preview's frame — from pushing the shell into a horizontal scroll. */
    const pane = (name: typeof surface) =>
        `min-w-0 ${surface === name ? 'flex flex-1' : 'hidden'}`;

    return (
        <div className="flex flex-col h-dvh bg-ground text-metal-100 font-sans overflow-hidden
                        pb-[calc(3.25rem+max(1rem,env(safe-area-inset-bottom)))]">

            <div className="flex-1 min-h-0 flex">
                {/* Projects is home. It used to be a rail pinned open from `md:` up, which
                    is why it still measured itself in rail widths; as a destination it
                    measures itself in the screen. */}
                <div className={pane('projects')}><ProjectManager /></div>

                <div className={pane('build')}><WebAppBuilder /></div>
                <div className={pane('harness')}><Harness /></div>

                {/* Keyed on the agent so chat state never leaks across two of them. */}
                <div className={pane('chat')}>
                    <ChatPanel key={activeAgent ? `agent-${activeAgent.id}` : 'general'} />
                </div>

                {ideProjectId && (
                    <>
                        <div className={pane('code')}>
                            <IdeView projectId={ideProjectId} />
                        </div>
                        {/* The preview is the thing you look at, so it gets the viewport
                            rather than a fixed height inside a scrolling column. */}
                        <div className={`${pane('preview')} flex-col p-3 md:p-4`}>
                            <PreviewHost
                                projectId={ideProjectId}
                                files={previewFiles}
                                title="Preview of the open project"
                                active={surface === 'preview'}
                                className="flex-1 min-h-0"
                            />
                        </div>
                    </>
                )}
            </div>

            {/* Reachable from every tab, because a build runs while you are elsewhere. */}
            <MemoryPanel
                open={memoryOpen}
                onOpenChange={setMemoryOpen}
                onNeedsYouChange={handleNeedsYou}
            />

            <AppDock
                surface={surface}
                onSurfaceChange={setSurface}
                unavailable={unavailable}
                memoryOpen={memoryOpen}
                onMemoryToggle={() => setMemoryOpen(o => !o)}
                memoryNeedsYou={memoryNeedsYou}
            />

            {editingProject && (
                <ProjectSettingsModal
                    project={editingProject}
                    files={filesByProject.get(editingProject.id) || []}
                    onClose={handleCloseProjectSettings}
                    onRenameProject={handleRenameProject}
                    onAddFile={handleAddFile}
                    onDeleteFile={handleDeleteFile}
                />
            )}

            {globalError && (
                <div className="fixed right-4 z-50 max-w-sm p-4 rounded-card bg-raised shadow-[inset_0_0_0_1px_rgb(255_255_255/0.10)]
                                bottom-[calc(4.25rem+max(1rem,env(safe-area-inset-bottom)))]">
                    <div className="flex justify-between items-center">
                        <p className="flex items-center gap-2 text-sm font-medium text-metal-100">
                            <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                            Error
                        </p>
                        <button onClick={() => setGlobalError(null)} aria-label="Dismiss error"
                            className="tap -mr-2 text-metal-300 md:hover:text-metal-100">
                            <span aria-hidden>&times;</span>
                        </button>
                    </div>
                    <p className="text-xs text-metal-300 mt-2 leading-relaxed">{globalError}</p>
                </div>
            )}
        </div>
    );
}

const App: React.FC = () => {
    return (
        <AppProvider>
            <AppContent />
        </AppProvider>
    );
};

export default App;
