import React, { useState, useEffect } from 'react';
import FileExplorer from './FileExplorer';
import CodeEditor from './CodeEditor';
import Terminal from './Terminal';
import { useAppContext } from '../context/AppContext';
import { ProjectFile } from '../types/index';

interface IdeViewProps {
    projectId: string;
}

const IdeView: React.FC<IdeViewProps> = ({ projectId }) => {
    const { filesByProject, handleAddFile, aiDeleteFile, handleSaveFileContent, aiCreateFile } = useAppContext();
    const [activeFileId, setActiveFileId] = useState<string | null>(null);

    const files = filesByProject.get(projectId) || [];
    const activeFile = files.find(f => f.id === activeFileId);
    
    useEffect(() => {
        // If the active file is deleted or project changes, deselect.
        if (activeFileId && !files.some(f => f.id === activeFileId)) {
            setActiveFileId(null);
        }
        // If there's no selection but there are files, select the first one.
        if (!activeFileId && files.length > 0) {
            setActiveFileId(files[0].id);
        }
    }, [files, activeFileId]);

    const handleSave = (newContent: string) => {
        if (activeFile) {
            handleSaveFileContent(projectId, activeFile.id, newContent);
        }
    };

    return (
        <div className="flex-1 flex bg-gray-800 h-full overflow-hidden">
            <FileExplorer 
                files={files} 
                activeFileId={activeFileId}
                onFileSelect={setActiveFileId}
                onCreateFile={(path) => aiCreateFile(projectId, path, '')}
                onDeleteFile={(path) => aiDeleteFile(projectId, path)}
            />
            <div className="flex-1 flex flex-col">
                <div className="flex-1">
                    {activeFile ? (
                        <CodeEditor file={activeFile} onSave={handleSave} />
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            <p>Select a file to view or create a new one.</p>
                        </div>
                    )}
                </div>
                <div className="h-1/3 border-t-2 border-gray-700">
                    <Terminal projectId={projectId} />
                </div>
            </div>
        </div>
    );
};

export default IdeView;