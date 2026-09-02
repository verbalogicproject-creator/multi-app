import React from 'react';
import { ProjectFile } from '../types/index';

interface FileExplorerProps {
    files: ProjectFile[];
    activeFileId: string | null;
    onFileSelect: (fileId: string) => void;
    onCreateFile: (path: string) => void;
    onDeleteFile: (path: string) => void;
    /** Present when the explorer is a phone sheet rather than a desktop column. */
    onClose?: () => void;
}

const FileExplorer: React.FC<FileExplorerProps> = ({ files, activeFileId, onFileSelect, onCreateFile, onDeleteFile, onClose }) => {

    const handleCreate = () => {
        const path = prompt("Enter the new file path (e.g., src/components/New.tsx):");
        if (path) {
            onCreateFile(path);
        }
    };

    const iconButton =
        'tap flex items-center justify-center shrink-0 rounded-lg text-metal-300 ' +
        'transition-colors duration-200 ease-[--ease-fluid] md:hover:text-metal-100 md:hover:bg-metal-700';

    return (
        <div className="w-full flex flex-col min-h-0 bg-surface shadow-[inset_-1px_0_0_rgb(255_255_255/0.06)]">
            <div className="shrink-0 flex justify-between items-center gap-1 px-3 safe-t md:pt-0 shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]">
                <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300">Explorer</h3>
                <div className="flex items-center">
                    <button onClick={handleCreate} aria-label="New file" className={iconButton}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </button>
                    {/* Only the sheet needs a way out; the desktop column is always there. */}
                    {onClose && (
                        <button onClick={onClose} aria-label="Close explorer" className={`${iconButton} md:hidden`}>
                            <span aria-hidden className="text-lg leading-none">&times;</span>
                        </button>
                    )}
                </div>
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-0.5 safe-b md:pb-2">
                {files.length === 0 && <p className="text-xs text-metal-300 p-2">No files in project.</p>}
                {files.map(file => {
                    const selected = activeFileId === file.id;
                    return (
                        <li key={file.id} className="flex items-center gap-1">
                            <button
                                onClick={() => onFileSelect(file.id)}
                                aria-current={selected ? 'true' : undefined}
                                title={file.path}
                                /* Selected is value, not hue. */
                                className={`tap flex-1 min-w-0 text-left px-2 rounded-lg meta text-xs truncate
                                            transition-colors duration-200 ease-[--ease-fluid]
                                            ${selected
                                                ? 'bg-raised text-metal-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.10)]'
                                                : 'md:hover:bg-white/[0.05]'}`}
                            >
                                {file.path}
                            </button>
                            {/* Always reachable: an opacity-0 control that appears on hover is
                                a control a touch screen cannot find. */}
                            <button
                                onClick={() => {
                                    if (window.confirm(`Are you sure you want to delete ${file.path}?`)) {
                                        onDeleteFile(file.path);
                                    }
                                }}
                                aria-label={`Delete ${file.path}`}
                                className={`${iconButton} md:hover:text-accent`}
                            >
                                <span aria-hidden className="text-lg leading-none">&times;</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export default FileExplorer;
