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
  /* The bridge to the builder. It reaches the server, so the assistant knows it is
     shaping something buildable rather than just talking about one. */
  { id: 'plan', label: 'Plan', description: 'Shape an idea, then send it to the builder.', enabled: true },
  { id: 'image-edit', label: 'Image Editor', description: 'Edit images with text prompts.', enabled: FEATURES.imageEdit },
  { id: 'video-gen', label: 'Video Generator', description: 'Create video clips from text or images.', enabled: FEATURES.videoGen },
  { id: 'live', label: 'Live Conversation', description: 'Talk with Gemini in real-time.', enabled: FEATURES.liveAudio },
];

const modes = allModes.filter(m => m.enabled);

const ModeSelector: React.FC<ModeSelectorProps> = ({ currentMode, onModeChange }) => {
  return (
    /* Scrolls inside itself. It used to carry `mb-4` and wrap, which was right
       when it sat above the transcript and wrong once it moved into a header
       row — the margin pushed it past the row's box and the row clipped it. */
    <div className="flex items-center gap-1 p-1 rounded-lg bg-black/20 overflow-x-auto max-w-full">
      {modes.map(mode => {
        return (
          <button
            key={mode.id}
            onClick={() => onModeChange(mode.id)}
            aria-pressed={currentMode === mode.id}
            className={`tap px-4 rounded-md text-sm font-medium
              transition-[background-color,color,transform] duration-200 ease-fluid active:scale-[0.98]
              ${currentMode === mode.id
                ? 'bg-raised text-metal-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]'
                : 'text-metal-300 md:hover:bg-metal-700 md:hover:text-metal-100'}
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