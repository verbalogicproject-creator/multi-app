import React from 'react';
import { useAppContext } from '../context/AppContext';

/**
 * Purely harness-wide runtime behaviour — nothing persona-shaped lives here
 * anymore. It used to also hold Manage Style Blocks, Load Persona, and the
 * whole Persona Composer; those moved to `AgentManager.tsx` ("Experts"),
 * since a persona has no meaning apart from the agent(s) it drives. See
 * `Harness.tsx`'s doc comment.
 */
const AiControls: React.FC = () => {
  const {
    useWebSearch, setUseWebSearch: onWebSearchToggle, lowLatencyMode, setLowLatencyMode: onLowLatencyModeToggle,
  } = useAppContext();

  return (
    <div className="bg-surface hairline rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-around w-full gap-6">
        <div className="tap flex flex-col items-center justify-center"><label className="block text-xs font-medium text-metal-300 mb-2">Web Search</label><button aria-label="Web search" aria-pressed={useWebSearch} onClick={() => onWebSearchToggle(!useWebSearch)} className="tap flex items-center justify-center focus:outline-none"><span aria-hidden className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors duration-200 ease-fluid ${useWebSearch ? 'bg-metal-300' : 'bg-metal-700'}`}><span className={`inline-block w-4 h-4 transform rounded-full transition-transform duration-200 ease-fluid ${useWebSearch ? "bg-ground" : "bg-metal-400"} ${useWebSearch ? 'translate-x-6' : 'translate-x-1'}`} /></span></button></div>
        <div className="tap flex flex-col items-center justify-center"><label className="block text-xs font-medium text-metal-300 mb-2" title="Disables 'thinking' for gemini-2.5-flash for faster responses.">Low Latency</label><button aria-label="Low latency" aria-pressed={lowLatencyMode} onClick={() => onLowLatencyModeToggle(!lowLatencyMode)} className="tap flex items-center justify-center focus:outline-none"><span aria-hidden className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors duration-200 ease-fluid ${lowLatencyMode ? 'bg-metal-300' : 'bg-metal-700'}`}><span className={`inline-block w-4 h-4 transform rounded-full transition-transform duration-200 ease-fluid ${lowLatencyMode ? "bg-ground" : "bg-metal-400"} ${lowLatencyMode ? 'translate-x-6' : 'translate-x-1'}`} /></span></button></div>
      </div>
      {useWebSearch && <p className="text-center text-xs text-metal-300 pt-2 border-t border-white/[0.06]">Note: Web Search disables other tools like `runPython` for the query.</p>}
    </div>
  );
};

export default AiControls;
