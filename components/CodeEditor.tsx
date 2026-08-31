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
        <div className="flex-1 flex flex-col bg-gray-800">
            <div className="flex justify-between items-center p-2 bg-gray-900 border-b border-gray-700">
                <h3 className="text-sm font-mono text-gray-400">{file.path} {!isSaved && '*'}</h3>
                <button onClick={handleSave} disabled={isSaved} className="text-xs px-3 py-1 bg-sky-600 rounded hover:bg-sky-500 disabled:bg-gray-600 disabled:cursor-not-allowed">
                    Save
                </button>
            </div>
            <textarea
                value={content}
                onChange={handleChange}
                className="flex-1 w-full h-full bg-[#1e1e1e] text-gray-200 font-mono p-4 text-sm resize-none focus:outline-none"
                spellCheck="false"
            />
        </div>
    );
};

export default CodeEditor;