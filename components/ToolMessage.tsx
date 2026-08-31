import React, { useState } from 'react';
import { Message, Project } from '../types/index';
import CodeBlock from './CodeBlock';

interface ToolMessageProps {
  message: Message;
  onSaveScript?: (projectId: string, filename: string, content: string) => void;
  selectedProjects?: Project[];
  onResolvePendingTool?: (messageId: string, approved: boolean) => void;
}

const SaveScriptForm: React.FC<{ projects: Project[]; onSave: (projectId: string, filename: string) => void; onCancel: () => void; }> = ({ projects, onSave, onCancel }) => {
    const [targetProjectId, setTargetProjectId] = useState(projects[0]?.id || '');
    const [filename, setFilename] = useState('script.py');

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        if (targetProjectId && filename.trim()) onSave(targetProjectId, filename.trim());
    };

    return (
        <form onSubmit={handleSave} className="mt-3 p-3 border border-gray-600 rounded-lg bg-gray-900/50 space-y-3">
            <p className="text-xs font-semibold text-gray-300">Save Script to Project</p>
            <div><label htmlFor="project-select" className="block text-xs text-gray-400 mb-1">Project</label><select id="project-select" value={targetProjectId} onChange={e => setTargetProjectId(e.target.value)} className="w-full p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-sky-500">{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label htmlFor="filename-input" className="block text-xs text-gray-400 mb-1">Filename</label><input id="filename-input" type="text" value={filename} onChange={e => setFilename(e.target.value)} placeholder="e.g., script.py" className="w-full p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-sky-500" /></div>
            <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="px-3 py-1 bg-gray-600 text-gray-200 text-xs font-semibold rounded-md hover:bg-gray-500">Cancel</button><button type="submit" disabled={!targetProjectId || !filename.trim()} className="px-3 py-1 bg-sky-600 text-white text-xs font-semibold rounded-md hover:bg-sky-500 disabled:bg-gray-500">Save</button></div>
        </form>
    );
};

const ToolMessage: React.FC<ToolMessageProps> = ({ message, onSaveScript, selectedProjects, onResolvePendingTool }) => {
    const [isSaving, setIsSaving] = useState(false);
    if (!message.toolResponse) return null;
    const { name, response } = message.toolResponse;
    const result = response.content;
    const originalCode = response.originalCode;
    let content;
    if (name === 'runPython' && result?.pending) {
      // Model-proposed Python awaiting explicit user approval before execution.
      content = (
        <div>
            <p className="text-xs text-amber-400 font-semibold mb-2">The assistant wants to run this Python code. Review it before allowing execution.</p>
            {originalCode && <CodeBlock language="python" code={originalCode} />}
            <div className="flex gap-2 mt-3">
                <button onClick={() => onResolvePendingTool?.(message.id, true)} className="px-4 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-md hover:bg-emerald-500">Run</button>
                <button onClick={() => onResolvePendingTool?.(message.id, false)} className="px-4 py-1.5 bg-gray-600 text-gray-200 text-xs font-semibold rounded-md hover:bg-gray-500">Skip</button>
            </div>
        </div>
      );
    } else if (name === 'runPython') {
      content = (<>
          {result.stdout && (<div><h4 className="font-semibold text-xs text-gray-400 mt-2">STDOUT:</h4><pre className="p-2 bg-gray-900 rounded text-xs overflow-x-auto"><code>{result.stdout}</code></pre></div>)}
          {result.stderr && (<div><h4 className="font-semibold text-xs text-red-400 mt-2">STDERR:</h4><pre className="p-2 bg-gray-900 rounded text-xs overflow-x-auto"><code>{result.stderr}</code></pre></div>)}
          {result.error && (<div><h4 className="font-semibold text-xs text-red-400 mt-2">ERROR:</h4><pre className="p-2 bg-gray-900 rounded text-xs overflow-x-auto"><code>{result.error}</code></pre></div>)}
          {result.result && result.result !== 'null' && (<div><h4 className="font-semibold text-xs text-gray-400 mt-2">RESULT:</h4><pre className="p-2 bg-gray-900 rounded text-xs overflow-x-auto"><code>{result.result}</code></pre></div>)}
          {originalCode && (<div className="mt-3 border-t border-gray-700 pt-3">
              <details><summary className="cursor-pointer text-xs font-semibold text-gray-400 hover:text-white">View Executed Code</summary><CodeBlock language="python" code={originalCode} /></details>
              {onSaveScript && selectedProjects && selectedProjects.length > 0 && !isSaving && (<button onClick={() => setIsSaving(true)} className="mt-2 px-3 py-1 bg-gray-600 text-gray-200 text-xs font-semibold rounded-md hover:bg-sky-600 flex items-center"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>Save Script</button>)}
              {isSaving && selectedProjects && (<SaveScriptForm projects={selectedProjects} onCancel={() => setIsSaving(false)} onSave={(projectId, filename) => { if(onSaveScript) onSaveScript(projectId, filename, originalCode); setIsSaving(false); }} />)}
          </div>)}
      </>);
    } else { content = <pre className="p-2 bg-gray-900 rounded text-xs overflow-x-auto"><code>{JSON.stringify(result, null, 2)}</code></pre>; }
    return (
        <div className="my-2 p-3 bg-gray-800/50 border border-gray-600 rounded-lg text-sm text-gray-300 max-w-lg lg:max-w-2xl xl:max-w-4xl w-full">
             <div className="flex items-center gap-2 font-mono text-xs text-purple-400"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span>Tool Result: {name}</span></div>
             <div className="mt-1">{content}</div>
        </div>
    );
};

export default ToolMessage;