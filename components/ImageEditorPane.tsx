import React from 'react';
import ImageUpload from './ImageUpload';

interface ImageEditorPaneProps {
  prompt: string;
  setPrompt: (prompt: string) => void;
  isLoading: boolean;
  uploadedFile: File | null;
  onFileSelect: (file: File | null) => void;
  externalPreviewUrl: string | null;
  onClearExternalPreview: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

const stylePresets = [
    { name: 'Cinematic', prompt: ', cinematic lighting, dramatic, high detail' },
    { name: 'Watercolor', prompt: ', in the style of a watercolor painting' },
    { name: 'Cyberpunk', prompt: ', cyberpunk style, neon lights, futuristic' },
    { name: 'Vintage', prompt: ', vintage photo, grainy, sepia tone' },
    { name: '3D Render', prompt: ', 3d render, octane render, photorealistic' },
];

const ImageEditorPane: React.FC<ImageEditorPaneProps> = (props) => {
  const {
    prompt,
    setPrompt,
    isLoading,
    uploadedFile,
    onFileSelect,
    externalPreviewUrl,
    onClearExternalPreview,
    onSubmit,
  } = props;

  const applyStyle = (stylePrompt: string) => {
    setPrompt(prompt.endsWith(stylePrompt) ? prompt : prompt + stylePrompt);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col items-center gap-4">
      <div className="text-sm text-gray-400">
        Style Presets:
        <div className="flex flex-wrap gap-2 mt-1">
          {stylePresets.map(style => (
            <button
              key={style.name}
              type="button"
              onClick={() => applyStyle(style.prompt)}
              className="px-3 py-1 bg-gray-700 text-gray-300 rounded-md text-xs hover:bg-sky-600 transition-colors"
            >
              {style.name}
            </button>
          ))}
        </div>
      </div>
      <div className="w-full flex flex-col md:flex-row items-center gap-4">
        <div className="w-full md:w-auto">
          <ImageUpload
            onFileSelect={onFileSelect}
            label="Image to Edit"
            externalPreviewUrl={externalPreviewUrl}
            onClearExternalPreview={onClearExternalPreview}
          />
        </div>
        <div className="flex-1 w-full flex items-center gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your edits..."
            className="w-full p-3 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !prompt.trim() || !(uploadedFile || externalPreviewUrl)}
            className="bg-sky-600 text-white p-3 rounded-lg hover:bg-sky-500 disabled:bg-gray-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>
    </form>
  );
};

export default ImageEditorPane;
