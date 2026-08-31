import React from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import ProjectManager from './components/ProjectManager';
import ChatPanel from './components/ChatPanel';
import IdeView from './components/IdeView';
import WebAppBuilder from './components/builders/WebAppBuilder';

const AppContent: React.FC = () => {
    const { globalError, setGlobalError, activeAgentId, agents, activeTab } = useAppContext();
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
        <div className="flex h-screen bg-gray-900 text-white font-sans overflow-hidden">
            <ProjectManager />
            
            {renderMainPanel()}

            {globalError && (
                <div className="fixed bottom-4 right-4 bg-red-800 text-white p-4 rounded-lg shadow-lg max-w-sm z-50">
                    <div className="flex justify-between items-center">
                        <p className="font-semibold">Error</p>
                        <button onClick={() => setGlobalError(null)} className="text-xl">&times;</button>
                    </div>
                    <p className="text-sm mt-2">{globalError}</p>
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