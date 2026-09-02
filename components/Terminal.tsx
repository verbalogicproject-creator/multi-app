import React, { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';

interface TerminalProps {
    projectId: string;
}

const Terminal: React.FC<TerminalProps> = ({ projectId }) => {
    const { filesByProject, aiCreateFile, aiDeleteFile } = useAppContext();
    const [history, setHistory] = useState<string[]>(['Welcome to the virtual terminal!']);
    const [input, setInput] = useState('');
    const endOfHistoryRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endOfHistoryRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history]);

    const executeCommand = async (command: string) => {
        const [cmd, ...args] = command.trim().split(' ');
        let output = `> ${command}\n`;
        const files = filesByProject.get(projectId) || [];

        switch (cmd) {
            case 'ls':
                output += files.map(f => f.path).join('\n') || 'No files in project.';
                break;
            case 'cat':
                if (args.length === 0) {
                    output += 'Usage: cat <file_path>';
                } else {
                    const file = files.find(f => f.path === args[0]);
                    output += file ? file.content : `cat: ${args[0]}: No such file or directory`;
                }
                break;
            case 'touch':
                 if (args.length === 0) {
                    output += 'Usage: touch <file_path>';
                } else {
                    await aiCreateFile(projectId, args[0], '');
                    output += `Created file: ${args[0]}`;
                }
                break;
             case 'rm':
                 if (args.length === 0) {
                    output += 'Usage: rm <file_path>';
                } else {
                    const success = await aiDeleteFile(projectId, args[0]);
                    output += success ? `Removed file: ${args[0]}` : `rm: ${args[0]}: No such file or directory`;
                }
                break;
            case 'clear':
                setHistory([]);
                return;
            case 'help':
                output += 'Available commands: ls, cat, touch, rm, clear, help';
                break;
            case '':
                break;
            default:
                output += `command not found: ${cmd}`;
        }
        setHistory(prev => [...prev, output]);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            executeCommand(input);
            setInput('');
        }
    };

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-ground font-mono text-xs md:text-sm text-metal-200 p-2 overflow-hidden">
            <div className="flex-1 overflow-y-auto" onClick={() => document.getElementById('terminal-input')?.focus()}>
                {history.map((line, index) => (
                    <pre key={index} className="whitespace-pre-wrap">{line}</pre>
                ))}
                <div ref={endOfHistoryRef} />
            </div>
            <div className="flex items-center">
                <span aria-hidden className="text-metal-300 mr-2">{'>'}</span>
                <input
                    id="terminal-input"
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    aria-label="Terminal input"
                    className="flex-1 min-w-0 bg-transparent text-metal-100 focus:outline-none"
                    autoComplete="off"
                />
            </div>
        </div>
    );
};

export default Terminal;