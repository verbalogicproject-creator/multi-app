import React from 'react';
import { useAppContext } from '../context/AppContext';

const MODEL_OPTIONS: { id: string; label: string; hint: string }[] = [
    { id: 'auto', label: 'Auto', hint: 'Recommended: 3.5-flash for chat, 3.7-flash for the builder' },
    { id: 'gemini-3.5-flash-lite', label: '3.5 Flash-Lite', hint: 'Fastest and cheapest; light tasks' },
    { id: 'gemini-3.7-flash', label: '3.7 Flash', hint: 'Strong coding and agentic work (low free-tier quota)' },
    { id: 'gemini-3.1-pro-preview', label: '3.1 Pro (preview)', hint: 'Deepest reasoning; slowest' },
];

const ModelPicker: React.FC<{ compact?: boolean }> = ({ compact }) => {
    const { selectedModel, setSelectedModel } = useAppContext();
    const current = MODEL_OPTIONS.find(o => o.id === selectedModel) ?? MODEL_OPTIONS[0];

    return (
        <label className={`flex items-center gap-2 ${compact ? '' : 'justify-center'}`} title={current.hint}>
            <span className="text-xs text-gray-400 whitespace-nowrap">Model</span>
            <select
                value={current.id}
                onChange={e => setSelectedModel(e.target.value)}
                className="bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
                {MODEL_OPTIONS.map(option => (
                    <option key={option.id} value={option.id} title={option.hint}>{option.label}</option>
                ))}
            </select>
        </label>
    );
};

export default ModelPicker;
