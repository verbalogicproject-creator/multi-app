import React from 'react';
import ImageUpload from './ImageUpload';
import { DirectorControls } from '../types/index';

interface VideoGeneratorPaneProps {
  prompt: string;
  setPrompt: (prompt: string) => void;
  isLoading: boolean;
  uploadedFile: File | null;
  onFileSelect: (file: File | null) => void;
  duration: number;
  setDuration: (duration: number) => void;
  aspectRatio: string;
  setAspectRatio: (ratio: string) => void;
  directorControls: DirectorControls;
  setDirectorControls: (controls: DirectorControls) => void;
  onSubmit: (e: React.FormEvent) => void;
}

const aspectRatios = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const shotTypes = ['none', 'Close-up', 'Wide Shot', 'Drone Shot', 'First-person view'];
const cameraMovements = ['none', 'Static', 'Pan Left', 'Pan Right', 'Dolly Zoom', 'Tilt Up'];
const styles = ['none', 'Cinematic', 'Documentary', 'Anime', 'Hyperrealistic', 'Vintage Film'];

const VideoDirectorControls: React.FC<{ controls: DirectorControls; setControls: (controls: DirectorControls) => void; disabled: boolean; }> = ({ controls, setControls, disabled }) => {
    const handleChange = (field: keyof DirectorControls, value: string) => setControls({ ...controls, [field]: value });
    return (
        <details className="w-full md:w-auto text-sm bg-gray-900/50 rounded-lg">
            <summary className="cursor-pointer font-semibold p-2 text-gray-300 hover:text-white">Director Mode (Optional)</summary>
            <div className="p-3 border-t border-gray-700 flex flex-col md:flex-row gap-4">
                <div><label htmlFor="shotType" className="block text-xs text-gray-400 mb-1">Shot Type</label><select id="shotType" value={controls.shotType} onChange={e => handleChange('shotType', e.target.value)} className="bg-gray-700 rounded p-1 text-xs" disabled={disabled}>{shotTypes.map(st => <option key={st} value={st}>{st}</option>)}</select></div>
                <div><label htmlFor="cameraMovement" className="block text-xs text-gray-400 mb-1">Camera Movement</label><select id="cameraMovement" value={controls.cameraMovement} onChange={e => handleChange('cameraMovement', e.target.value)} className="bg-gray-700 rounded p-1 text-xs" disabled={disabled}>{cameraMovements.map(cm => <option key={cm} value={cm}>{cm}</option>)}</select></div>
                <div><label htmlFor="style" className="block text-xs text-gray-400 mb-1">Artistic Style</label><select id="style" value={controls.style} onChange={e => handleChange('style', e.target.value)} className="bg-gray-700 rounded p-1 text-xs" disabled={disabled}>{styles.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            </div>
        </details>
    );
};

const VideoGeneratorPane: React.FC<VideoGeneratorPaneProps> = (props) => {
  const { prompt, setPrompt, isLoading, onFileSelect, duration, setDuration, aspectRatio, setAspectRatio, directorControls, setDirectorControls, onSubmit } = props;
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-center gap-4">
        <div className="w-full flex items-center justify-center gap-4 text-sm flex-wrap">
            <label htmlFor="duration" className="text-gray-400">Duration: {duration}s</label>
            <input type="range" id="duration" min="1" max="15" value={duration} onChange={e => setDuration(Number(e.target.value))} className="w-48 accent-metal-300" disabled={isLoading} />
            <label htmlFor="aspectRatio" className="text-gray-400">Aspect Ratio:</label>
            <select id="aspectRatio" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} className="bg-gray-700 rounded p-1" disabled={isLoading}>{aspectRatios.map(ar => <option key={ar} value={ar}>{ar}</option>)}</select>
        </div>
        <div className="w-full flex justify-center"><VideoDirectorControls controls={directorControls} setControls={setDirectorControls} disabled={isLoading} /></div>
         <div className="w-full flex flex-col md:flex-row items-center gap-4">
            <div className="w-full md:w-auto"><ImageUpload onFileSelect={onFileSelect} label="Optional starting image"/></div>
            <div className="flex-1 w-full flex items-center gap-2">
                <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the video scene..." className="w-full p-3 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" disabled={isLoading} />
                <button type="submit" disabled={isLoading || !prompt.trim()} className="bg-sky-600 text-white p-3 rounded-lg hover:bg-sky-500 disabled:bg-gray-600 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
            </div>
        </div>
    </form>
  );
};

export default VideoGeneratorPane;