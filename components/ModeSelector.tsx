import React from 'react';
import { ChatMode } from '../types/index';
import { FEATURES } from '../utils/features';

interface ModeSelectorProps {
  currentMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  isAgentActive: boolean;
}

const allModes: { id: ChatMode; label: string; description: string; enabled: boolean }[] = [
  { id: 'chat', label: 'Chat', description: 'Have a general conversation.', enabled: true },
  { id: 'image-edit', label: 'Image Editor', description: 'Edit images with text prompts.', enabled: FEATURES.imageEdit },
  { id: 'video-gen', label: 'Video Generator', description: 'Create video clips from text or images.', enabled: FEATURES.videoGen },
  { id: 'live', label: 'Live Conversation', description: 'Talk with Gemini in real-time.', enabled: FEATURES.liveAudio },
];

const modes = allModes.filter(m => m.enabled);

const ModeSelector: React.FC<ModeSelectorProps> = ({ currentMode, onModeChange }) => {
  return (
    <div className="flex justify-center items-center p-2 rounded-lg bg-gray-900/50 mb-4 flex-wrap">
      {modes.map(mode => {
        return (
          <button
            key={mode.id}
            onClick={() => onModeChange(mode.id)}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-sky-500
              ${currentMode === mode.id ? 'bg-sky-600 text-white' : 'text-gray-300 hover:bg-gray-700'}
            `}
            title={mode.description}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
};

export default ModeSelector;