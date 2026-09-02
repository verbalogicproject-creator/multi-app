import React, { useCallback, useEffect, useState } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import ProjectManager from './components/ProjectManager';
import ChatPanel from './components/ChatPanel';
import IdeView from './components/IdeView';
import WebAppBuilder from './components/builders/WebAppBuilder';
import ProjectSettingsModal from './components/ProjectSettingsModal';
import MemoryPanel from './components/memory/MemoryPanel';
import MobileTabBar, { type MobileSurface } from './components/MobileTabBar';

/**
 * The shell, and the one place the phone and the desktop part company.
 *
 * Desktop is unchanged: the rail, then the main panel — which for an active
 * agent is IdeView at two thirds beside its chat at one third — and the memory
 * drawer over the top.
 *
 * A phone has room for exactly one of those at a time, so the same three become
 * destinations reached from a bottom bar. They are shown and hidden with CSS
 * rather than mounted and unmounted, so chat state, scroll position and an
 * unsent message survive a trip to the Code tab and back.
 */
const AppContent: React.FC = () => {
    const {
        globalError, setGlobalError, activeAgentId, agents, activeTab,
        editingProject, filesByProject, handleCloseProjectSettings, handleRenameProject, handleAddFile, handleDeleteFile,
    } = useAppContext();
    const activeAgent = agents.find(a => a.id === activeAgentId);

    const [surface, setSurface] = useState<MobileSurface>('main');
    const [memoryOpen, setMemoryOpen] = useState(false);
    const [memoryNeedsYou, setMemoryNeedsYou] = useState(false);

    // Code follows the active agent. Deselecting one while looking at it would
    // otherwise leave the phone on a destination that no longer has contents.
    useEffect(() => {
        if (surface === 'code' && !activeAgent) setSurface('main');
    }, [surface, activeAgent]);

    const handleNeedsYou = useCallback((needsYou: boolean) => setMemoryNeedsYou(needsYou), []);

    const isBuilder = activeTab === 'tools';
    const mainPanel = isBuilder
        ? <WebAppBuilder />
        // key forces a remount on agent switch so chat state never leaks across agents
        : <ChatPanel key={activeAgent ? `agent-${activeAgent.id}` : 'general'} />;

    // Shown unless the phone is looking at the rail; at md: always.
    const stageVisibility = surface === 'projects' ? 'hidden md:flex' : 'flex';

    return (
        <div className="flex h-dvh bg-ground text-metal-100 font-sans overflow-hidden
                        pb-[calc(3.25rem+max(1rem,env(safe-area-inset-bottom)))] md:pb-0">

            {/* The rail — full width on a phone, a fixed column from md: up. */}
            <div className={`min-w-0 ${surface === 'projects' ? 'flex flex-1' : 'hidden'} md:flex md:flex-initial`}>
                <ProjectManager />
            </div>

            <div className={`${stageVisibility} flex-1 min-w-0`}>
                {activeAgent ? (
                    <>
                        <div className={`min-w-0 ${surface === 'code' ? 'flex flex-1' : 'hidden'} md:flex md:flex-initial md:w-2/3`}>
                            <IdeView projectId={activeAgent.projectId} />
                        </div>
                        <div className={`min-w-0 ${surface === 'main' ? 'flex flex-1' : 'hidden'} md:flex md:flex-initial md:w-1/3
                                         md:shadow-[inset_1px_0_0_rgb(255_255_255/0.08)]`}>
                            {mainPanel}
                        </div>
                    </>
                ) : (
                    <div className={`min-w-0 ${surface === 'main' ? 'flex flex-1' : 'hidden'} md:flex md:flex-1`}>
                        {mainPanel}
                    </div>
                )}
            </div>

            {/* Reachable from every tab, because a build runs while you are elsewhere. */}
            <MemoryPanel
                open={memoryOpen}
                onOpenChange={setMemoryOpen}
                onNeedsYouChange={handleNeedsYou}
            />

            <MobileTabBar
                surface={surface}
                onSurfaceChange={setSurface}
                mainLabel={isBuilder ? 'Build' : 'Chat'}
                codeEnabled={!!activeAgent}
                codeHint="Select an agent to open its code."
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
                                bottom-[calc(4.25rem+max(1rem,env(safe-area-inset-bottom)))] md:bottom-20">
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
