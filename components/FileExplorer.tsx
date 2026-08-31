import React from 'react';
import { ProjectFile } from '../types/index';

interface FileExplorerProps {
    files: ProjectFile[];
    activeFileId: string | null;
    onFileSelect: (fileId: string) => void;
    onCreateFile: (path: string) => void;
    onDeleteFile: (path: string) => void;
}

const FileExplorer: React.FC<FileExplorerProps> = ({ files, activeFileId, onFileSelect, onCreateFile, onDeleteFile }) => {

    const handleCreate = () => {
        const path = prompt("Enter the new file path (e.g., src/components/New.tsx):");
        if (path) {
            onCreateFile(path);
        }
    };
    
    return (
        <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
            <div className="p-2 flex justify-between items-center border-b border-gray-700">
                <h3 className="text-sm font-semibold text-gray-200">EXPLORER</h3>
                <button onClick={handleCreate} title="New File" className="text-gray-400 hover:text-white p-1">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </button>
            </div>
            <ul className="flex-1 overflow-y-auto p-1">
                {files.length === 0 && <p className="text-xs text-gray-500 p-2 italic">No files in project.</p>}
                {files.map(file => (
                    <li key={file.id}>
                        <button
                            onClick={() => onFileSelect(file.id)}
                            className={`group w-full text-left text-sm px-2 py-1 rounded truncate flex justify-between items-center ${
                                activeFileId === file.id ? 'bg-sky-600/50 text-white' : 'hover:bg-gray-700'
                            }`}
                        >
                            <span className="truncate">{file.path}</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Are you sure you want to delete ${file.path}?`)) {
                                        onDeleteFile(file.path);
                                    }
                                }}
                                title="Delete File"
                                className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100"
                            >
                                &times;
                            </button>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default FileExplorer;