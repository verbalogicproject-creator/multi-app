import React, { useState, useRef, useMemo } from 'react';
// FIX: Update import path to new types directory structure.
import { AiResponseStyle, CustomAiStyle, Persona, ComposedStyle } from '../types/index';
import { useAppContext } from '../context/AppContext';

const CustomStyleEditor: React.FC<{
  style: CustomAiStyle | null;
  onSave: (id: string | null, name: string, instructions: string) => void;
  onCancel: () => void;
  existingNames: string[];
}> = ({ style, onSave, onCancel, existingNames }) => {
  const [name, setName] = useState(style?.name || '');
  const [instructions, setInstructions] = useState(style?.instructions || '');
  const [error, setError] = useState('');
  const isEditing = !!style;
  const originalName = style?.name || '';
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || !instructions.trim()) { setError('Name and instructions cannot be empty.'); return; }
    if (trimmedName !== originalName && existingNames.includes(trimmedName)) { setError('A style with this name already exists.'); return; }
    onSave(style?.id || null, trimmedName, instructions.trim());
  };
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg border border-gray-700"><form onSubmit={handleSubmit}>
        <header className="p-4 border-b border-gray-700"><h3 className="text-lg font-bold text-sky-400">{isEditing ? 'Edit Style Block' : 'Create New Style Block'}</h3></header>
        <main className="p-6 space-y-4">
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div><label htmlFor="styleName" className="block text-sm font-medium text-gray-300 mb-1">Style Name</label><input id="styleName" type="text" value={name} onChange={e => setName(e.target.value)} className="w-full p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="e.g., Socratic Tutor" /></div>
          <div><label htmlFor="styleInstructions" className="block text-sm font-medium text-gray-300 mb-1">Instructions</label><textarea id="styleInstructions" value={instructions} onChange={e => setInstructions(e.target.value)} className="w-full h-40 p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-sky-500" placeholder="Describe how the AI should behave with this style..."></textarea></div>
        </main>
        <footer className="p-4 border-t border-gray-700 flex justify-end gap-2"><button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-600 rounded-md hover:bg-gray-500 transition-colors text-sm font-semibold">Cancel</button><button type="submit" className="px-4 py-2 bg-sky-600 rounded-md hover:bg-sky-500 transition-colors text-sm font-semibold">Save Style</button></footer>
      </form></div>
    </div>
  );
};

const AiControls: React.FC = () => {
  const {
    useWebSearch, setUseWebSearch: onWebSearchToggle, lowLatencyMode, setLowLatencyMode: onLowLatencyModeToggle,
    customAiStyles, handleAddCustomStyle: onAddCustomStyle, handleUpdateCustomStyle: onUpdateCustomStyle, handleDeleteCustomStyle: onDeleteCustomStyle,
    personas, selectedPersonaId, handleSelectPersona: onSelectPersona, handleSavePersona: onSavePersona, handleDeletePersona,
    activePersona, setActivePersona: onActivePersonaChange,
  } = useAppContext();
  
  const [styleToAdd, setStyleToAdd] = useState<string>(customAiStyles[0]?.name || '');
  const fileImportRef = useRef<HTMLInputElement>(null);
  const [isManagingStyles, setIsManagingStyles] = useState(false);
  const [editingStyle, setEditingStyle] = useState<CustomAiStyle | null>(null);
  const [showStyleEditor, setShowStyleEditor] = useState(false);

  const availableStyles = useMemo(() => customAiStyles.map(s => s.name), [customAiStyles]);
  const updateActivePersona = (updates: Partial<Persona>) => onActivePersonaChange({ ...activePersona, ...updates });
  const handleAddComposedStyle = () => { if (styleToAdd && !activePersona.composedStyles.some(s => s.name === styleToAdd)) updateActivePersona({ composedStyles: [...activePersona.composedStyles, { name: styleToAdd, weight: 0.5 }] }); };
  const handleRemoveComposedStyle = (index: number) => updateActivePersona({ composedStyles: activePersona.composedStyles.filter((_, i) => i !== index) });
  const handleUpdateComposedStyle = (index: number, updates: Partial<ComposedStyle>) => { const newStyles = [...activePersona.composedStyles]; newStyles[index] = { ...newStyles[index], ...updates }; updateActivePersona({ composedStyles: newStyles }); };
  const handleMoveStyle = (index: number, direction: 'up' | 'down') => {
      const newStyles = [...activePersona.composedStyles];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newStyles.length) return;
      [newStyles[index], newStyles[targetIndex]] = [newStyles[targetIndex], newStyles[index]];
      updateActivePersona({ composedStyles: newStyles });
  }

  const handleSaveCurrentPersona = () => {
    const personaName = selectedPersonaId ? personas.find(p=>p.id === selectedPersonaId)?.name : window.prompt("Enter a name for this new persona:", "My New Persona");
    if (personaName) onSavePersona(personaName, { baseInstructions: activePersona.baseInstructions, composedStyles: activePersona.composedStyles });
  };
  
  const handleExport = () => {
    const dataStr = JSON.stringify({ baseInstructions: activePersona.baseInstructions, composedStyles: activePersona.composedStyles }, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(personas.find(p=>p.id === selectedPersonaId)?.name || 'untitled').toLowerCase().replace(/\s/g, '_')}_persona.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target?.result as string);
                if (imported.composedStyles && Array.isArray(imported.composedStyles)) {
                    onSelectPersona(null);
                    updateActivePersona({ name: 'Imported Persona', baseInstructions: imported.baseInstructions || '', composedStyles: imported.composedStyles });
                } else alert("Invalid persona file format.");
            } catch (err) { alert("Error parsing persona file."); }
        };
        reader.readAsText(file);
    }
    if(event.target) event.target.value = '';
  };
  
  const handleSaveStyle = (id: string | null, name: string, instructions: string) => {
    if (id) onUpdateCustomStyle(id, name, instructions); else onAddCustomStyle(name, instructions);
    setShowStyleEditor(false);
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-4">
      {showStyleEditor && <CustomStyleEditor style={editingStyle} onSave={handleSaveStyle} onCancel={() => setShowStyleEditor(false)} existingNames={customAiStyles.filter(s => !s.isDefault).map(s => s.name)} />}
      <div className="pb-3 border-b border-gray-700">
        <button onClick={() => setIsManagingStyles(!isManagingStyles)} className="w-full flex justify-between items-center text-left text-sm font-semibold text-gray-300 hover:text-white">Manage Style Blocks<svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-transform ${isManagingStyles ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></button>
        {isManagingStyles && (<div className="mt-3 space-y-2">
            <div className="max-h-40 overflow-y-auto pr-2 space-y-2">
                {customAiStyles.length === 0 && <p className="text-xs text-gray-500 italic text-center">No styles created yet.</p>}
                {customAiStyles.map(style => (<div key={style.id} className={`flex items-center justify-between p-2 rounded-md ${style.isDefault ? 'bg-gray-700/30' : 'bg-gray-700/80'}`}>
                  <div className="flex items-center gap-2">
                    {style.isDefault && <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" /></svg>}
                    <span className="text-sm truncate" title={style.name}>{style.name}</span>
                  </div>
                  {!style.isDefault && (<div className="flex gap-2">
                    <button onClick={() => { setEditingStyle(style); setShowStyleEditor(true); }} className="p-1 text-gray-400 hover:text-sky-400" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" /></svg></button>
                    <button onClick={() => { if (window.confirm(`Delete "${style.name}"? This removes it from saved personas.`)) onDeleteCustomStyle(style.id); }} className="p-1 text-gray-400 hover:text-red-400" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                  </div>)}
                </div>))}
            </div>
            <button onClick={() => { setEditingStyle(null); setShowStyleEditor(true); }} className="w-full p-2 bg-gray-600 hover:bg-sky-700 rounded-md text-sm transition-colors mt-2 font-semibold">Create New Custom Style</button>
        </div>)}
      </div>
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex-1 w-full space-y-2">
            <label htmlFor="persona-select" className="block text-xs font-semibold text-gray-400">Load Persona</label>
            <div className="flex gap-2">
              <select id="persona-select" value={selectedPersonaId || ''} onChange={e => onSelectPersona(e.target.value || null)} className="flex-1 p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"><option value="">✨ New Persona (Unsaved)</option>{personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              {selectedPersonaId && (<button onClick={() => handleDeletePersona(selectedPersonaId)} className="p-2 bg-red-600 rounded-md hover:bg-red-500" title="Delete persona"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>)}
            </div>
        </div>
        <div className="w-full sm:w-auto h-px sm:h-auto bg-gray-700 sm:w-px sm:h-10"></div>
        <div className="flex items-center justify-around w-full sm:w-auto gap-6">
            <div className="flex flex-col items-center"><label className="block text-xs font-semibold text-gray-400 mb-2">Web Search</label><button onClick={() => onWebSearchToggle(!useWebSearch)} className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-sky-500 ${useWebSearch ? 'bg-green-500' : 'bg-gray-600'}`}><span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${useWebSearch ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>
            <div className="flex flex-col items-center"><label className="block text-xs font-semibold text-gray-400 mb-2" title="Disables 'thinking' for gemini-2.5-flash for faster responses.">Low Latency</label><button onClick={() => onLowLatencyModeToggle(!lowLatencyMode)} className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-sky-500 ${lowLatencyMode ? 'bg-green-500' : 'bg-gray-600'}`}><span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${lowLatencyMode ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>
        </div>
      </div>
       {useWebSearch && <p className="text-center text-xs text-yellow-400/80 pt-2 border-t border-gray-700">Note: Web Search disables other tools like `runPython` for the query.</p>}
      <div className="pt-3 border-t border-gray-700 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300">Persona Composer</h3>
        <div><label className="block text-xs font-semibold text-gray-400 mb-1">Base Instructions</label><textarea placeholder="Enter core directives for the AI here..." value={activePersona.baseInstructions} onChange={e => updateActivePersona({ baseInstructions: e.target.value })} className="w-full h-24 p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-sky-500" /></div>
        <div><label className="block text-xs font-semibold text-gray-400 mb-1">Composed Styles (Primary is first)</label>
          <div className="space-y-2 p-2 bg-gray-900/50 rounded-md">
              {activePersona.composedStyles.map((style, index) => (<div key={index} className="flex items-center gap-2 bg-gray-700 p-2 rounded">
                  <div className="flex flex-col"><button onClick={() => handleMoveStyle(index, 'up')} disabled={index === 0} className="disabled:opacity-20 hover:text-sky-400">&#9650;</button><button onClick={() => handleMoveStyle(index, 'down')} disabled={index === activePersona.composedStyles.length - 1} className="disabled:opacity-20 hover:text-sky-400">&#9660;</button></div>
                  <span className="font-semibold text-sm flex-1 truncate" title={style.name}>{style.name}</span>
                  <input type="range" min="0" max="1" step="0.05" value={style.weight} onChange={e => handleUpdateComposedStyle(index, { weight: Number(e.target.value) })} className="w-20 accent-sky-500" />
                  <span className="text-xs w-8 text-center">{Math.round(style.weight * 100)}%</span>
                  <button onClick={() => handleRemoveComposedStyle(index)} className="text-gray-500 hover:text-red-400 font-bold p-1 text-lg">&times;</button>
              </div>))}
              {activePersona.composedStyles.length === 0 && <p className="text-center text-xs text-gray-500 italic py-2">No styles added. Add a style to begin composing.</p>}
          </div>
          <div className="flex gap-2 mt-2">
            <select value={styleToAdd} onChange={e => setStyleToAdd(e.target.value)} className="flex-1 p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-sky-500">{availableStyles.map(s => <option key={s} value={s}>{s}</option>)}</select>
            <button onClick={handleAddComposedStyle} className="px-4 py-2 bg-gray-600 rounded-md hover:bg-sky-700 text-sm">Add Style</button>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-gray-700">
            <button onClick={() => fileImportRef.current?.click()} className="px-3 py-1 bg-gray-600 text-gray-200 text-xs font-semibold rounded-md hover:bg-gray-500">Import</button><input type="file" ref={fileImportRef} onChange={handleFileImport} accept=".json" className="hidden" />
            <button onClick={handleExport} className="px-3 py-1 bg-gray-600 text-gray-200 text-xs font-semibold rounded-md hover:bg-gray-500">Export</button>
            <button onClick={handleSaveCurrentPersona} className="px-4 py-1.5 bg-sky-600 text-white text-sm font-semibold rounded-md hover:bg-sky-500">{selectedPersonaId ? 'Update Persona' : 'Save as New Persona'}</button>
        </div>
      </div>
    </div>
  );
};

export default AiControls;