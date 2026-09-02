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
        <div className="relative flex-1 flex flex-col min-w-0 min-h-0 bg-ground">
            {/* Desktop keeps a persistent header. A phone does not: the switcher
                above already carries the path, and a second 44px row of chrome
                costs more than it returns on a 390px screen. */}
            <div className="hidden md:flex shrink-0 justify-between items-center gap-2 px-4
                            bg-surface shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]">
                <h3 className="meta text-xs truncate flex items-center gap-2">
                    {/* Unsaved work is the one thing in this pane that needs you. */}
                    {!isSaved && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                    {file.path}
                </h3>
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
            {/* Absolutely positioned so that appearing mid-keystroke cannot push the
                text you are typing. Present only while there is something to save,
                which is exactly what the accent is for. */}
            {!isSaved && (
                <button
                    onClick={handleSave}
                    className="tap md:hidden absolute bottom-3 right-3 flex items-center gap-2 px-4 rounded-full
                               bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.10)]
                               transition-transform duration-200 ease-[--ease-fluid] active:scale-[0.98]"
                >
                    <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                    Save
                </button>
            )}
        </div>
    );
};

export default CodeEditor;