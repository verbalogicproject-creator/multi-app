import React from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import ProjectManager from './components/ProjectManager';
import ChatPanel from './components/ChatPanel';
import IdeView from './components/IdeView';
import WebAppBuilder from './components/builders/WebAppBuilder';
import ProjectSettingsModal from './components/ProjectSettingsModal';
import MemoryPanel from './components/memory/MemoryPanel';

const AppContent: React.FC = () => {
    const {
        globalError, setGlobalError, activeAgentId, agents, activeTab,
        editingProject, filesByProject, handleCloseProjectSettings, handleRenameProject, handleAddFile, handleDeleteFile,
    } = useAppContext();
    const activeAgent = agents.find(a => a.id === activeAgentId);

    const renderMainPanel = () => {
        if (activeTab === 'tools') {
            return <WebAppBuilder />;
        }

        if (activeAgent) {
            return (
                 <div className="flex flex-1 min-w-0">
                    <div className="w-2/3">
                        <IdeView projectId={activeAgent.projectId} />
                    </div>
                    <div className="w-1/3 border-l-2 border-gray-700">
                        {/* key forces a remount on agent switch so chat state never leaks across agents */}
                        <ChatPanel key={`agent-${activeAgent.id}`} />
                    </div>
                </div>
            );
        }

        return <ChatPanel key="general" />;
    };

    return (
        <div className="flex h-dvh bg-ground text-metal-100 font-sans overflow-hidden">
            <ProjectManager />

            {renderMainPanel()}

            {/* Reachable from every tab, because a build runs while you are elsewhere. */}
            <MemoryPanel />

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
                <div className="fixed bottom-20 right-4 z-50 max-w-sm p-4 rounded-[--radius-card] bg-raised shadow-[inset_0_0_0_1px_rgb(255_255_255/0.10)]">
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