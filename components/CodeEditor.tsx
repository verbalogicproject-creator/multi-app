import React, { useState, useEffect } from 'react';
import { ProjectFile } from '../types/index';

interface CodeEditorProps {
    file: ProjectFile;
    onSave: (newContent: string) => void;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ file, onSave }) => {
    const [content, setContent] = useState(file.content);
    const [isSaved, setIsSaved] = useState(true);

    useEffect(() => {
        setContent(file.content);
        setIsSaved(true);
    }, [file]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setContent(e.target.value);
        setIsSaved(false);
    };

    const handleSave = () => {
        onSave(content);
        setIsSaved(true);
    };

    return (
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-ground">
            {/* The desktop keeps the path in view here; on a phone the switcher
                above already shows it, so this row is only the save state. */}
            <div className="shrink-0 flex justify-between items-center gap-2 px-3 md:px-4
                            bg-surface shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]">
                <h3 className="meta text-xs truncate hidden md:flex items-center gap-2">
                    {/* Unsaved work is the one thing in this pane that needs you. */}
                    {!isSaved && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                    {file.path}
                </h3>
                <span className="md:hidden text-xs text-metal-300 flex items-center gap-2">
                    {!isSaved && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                    {isSaved ? 'Saved' : 'Unsaved changes'}
                </span>
                <button
                    onClick={handleSave}
                    disabled={isSaved}
                    className="tap shrink-0 px-4 rounded-lg text-sm font-medium
                               bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                               transition-[background-color,transform] duration-200 ease-[--ease-fluid]
                               md:hover:bg-[#33333a] active:scale-[0.98]
                               disabled:opacity-35 disabled:active:scale-100 disabled:md:hover:bg-metal-700"
                >
                    Save
                </button>
            </div>
            <textarea
                value={content}
                onChange={handleChange}
                aria-label={`Contents of ${file.path}`}
                className="flex-1 w-full min-h-0 bg-ground text-metal-200 font-mono p-4 text-sm
                           resize-none focus:outline-none"
                spellCheck="false"
            />
        </div>
    );
};

export default CodeEditor;