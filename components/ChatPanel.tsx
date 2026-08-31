import React, { useState, useRef, useEffect } from 'react';
import MessageItem from './MessageItem';
import ModeSelector from './ModeSelector';
import ImageEditorPane from './ImageEditorPane';
import VideoGeneratorPane from './VideoGeneratorPane';
import LiveChatPane from './LiveChatPane';
import LoadingIndicator from './LoadingIndicator';
import ModelPicker from './ModelPicker';
import { useChat } from '../hooks/useChat';
import { useTTS } from '../hooks/useTTS';
import { useLiveChat } from '../hooks/useLiveChat';
import { useAppContext } from '../context/AppContext';
import { ChatMode } from '../types/index';

const ChatPanel: React.FC = () => {
    const {
      projects, selectedProjectIds, filesByProject, activePersona, useWebSearch, customAiStyles, lowLatencyMode, activeAgentId, selectedModel,
      aiCreateFile, aiUpdateFile, aiDeleteFile
    } = useAppContext();
    
    const [mode, setMode] = useState<ChatMode>('chat');
    const [codingPrompt, setCodingPrompt] = useState('');
    const [imagePrompt, setImagePrompt] = useState('');
    const [videoPrompt, setVideoPrompt] = useState('');
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [externalPreviewUrl, setExternalPreviewUrl] = useState<string | null>(null);
    const [directorControls, setDirectorControls] = useState({ shotType: 'none', cameraMovement: 'none', style: 'none' });
    const [duration, setDuration] = useState(4);
    const [aspectRatio, setAspectRatio] = useState('16:9');

    const selectedProjects = projects.filter(p => selectedProjectIds.has(p.id));

    const aiFileOperations = {
        listFiles: async (projectId: string): Promise<string[]> => {
            const files = filesByProject.get(projectId) || [];
            return files.map(f => f.path);
        },
        createFile: aiCreateFile,
        readFile: async (projectId: string, path: string): Promise<string | null> => {
            const files = filesByProject.get(projectId) || [];
            const file = files.find(f => f.path === path);
            return file ? file.content : null;
        },
        updateFile: aiUpdateFile,
        deleteFile: aiDeleteFile,
    };

    const { messages, isLoading, statusText, sendMessage, regenerate, resolvePendingTool } = useChat(selectedProjects, activePersona, useWebSearch, customAiStyles, lowLatencyMode, aiFileOperations, `gemini_messages_${activeAgentId ?? 'general'}`, selectedModel === 'auto' ? undefined : selectedModel);
    const { speak, cancel, isPlaying, currentlyPlayingId } = useTTS();
    const { isListening, liveTranscription, liveError, startListening, stopListening } = useLiveChat();

    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, statusText, liveTranscription]);
    
    useEffect(() => {
        if (activeAgentId) {
            setMode('coding');
        } else {
            setMode('chat');
        }
    }, [activeAgentId]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        const promptMap: Record<string, {prompt: string, setPrompt: (p: string) => void}> = {
            'chat': { prompt: codingPrompt, setPrompt: setCodingPrompt },
            'coding': { prompt: codingPrompt, setPrompt: setCodingPrompt },
            'image-edit': { prompt: imagePrompt, setPrompt: setImagePrompt },
            'video-gen': { prompt: videoPrompt, setPrompt: setVideoPrompt },
            'live': { prompt: '', setPrompt: () => {} },
        }

        const { prompt, setPrompt: setSpecificPrompt } = promptMap[mode];

        if (isLoading || !prompt.trim() && (mode !== 'image-edit' && mode !== 'video-gen' || !uploadedFile)) return;

        let augmentedPrompt = prompt;
        if (mode === 'video-gen') {
            const controls = Object.entries(directorControls).filter(([, val]) => val !== 'none').map(([key, val]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${val}`).join(', ');
            if (controls) augmentedPrompt = `${prompt} (${controls})`;
        }
        
        const currentChatMode = activeAgentId ? 'coding' : mode;
        sendMessage(augmentedPrompt, currentChatMode, uploadedFile);
        setSpecificPrompt('');
        setUploadedFile(null);
        setExternalPreviewUrl(null);
    };

    const handlePlayAudio = (messageId: string, text: string) => {
        if (isPlaying && currentlyPlayingId === messageId) {
            cancel();
        } else {
            speak(text, messageId);
        }
    };
    
    const handleSaveScript = async (projectId: string, filename: string, content: string) => {
        await aiCreateFile(projectId, filename, content);
    };

    const textInputPlaceholder = activeAgentId 
        ? "Chat with your agent..." 
        : "Ask me anything...";

    return (
        <main className="flex-1 flex flex-col bg-gray-900 h-full">
            <div className="flex-1 flex flex-col overflow-y-auto p-4">
                <div className="flex items-center gap-3 mb-2">
                    <div className="flex-1">
                        {!activeAgentId && <ModeSelector currentMode={mode} onModeChange={setMode} isAgentActive={!!activeAgentId} />}
                    </div>
                    <ModelPicker compact />
                </div>
                <div className="flex-1 space-y-4">
                    {messages.map(msg => (
                      <MessageItem 
                          key={msg.id} 
                          message={msg}
                          onRegenerate={regenerate}
                          onUseImage={(url) => { setMode('image-edit'); setExternalPreviewUrl(url); }}
                          onPlayAudio={handlePlayAudio}
                          isPlaying={isPlaying && currentlyPlayingId === msg.id}
                          selectedProjects={selectedProjects}
                          onSaveScript={handleSaveScript}
                          onResolvePendingTool={resolvePendingTool}
                      />
                    ))}
                    {isLoading && <LoadingIndicator text={statusText} />}
                    {mode === 'live' && (
                        <div className="text-center my-4 text-gray-400 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                            {!isListening && !liveError && <p className="italic">Click "Start Listening" to begin a conversation.</p>}
                            {isListening && (
                                <>
                                    <p className="font-bold text-sky-400 mb-2">Live Transcription</p>
                                    <p className="min-h-[1.5em]"><span className="font-semibold text-gray-300">You:</span> {liveTranscription.input}</p>
                                    <p className="min-h-[1.5em]"><span className="font-semibold text-gray-300">Gemini:</span> {liveTranscription.output}</p>
                                </>
                            )}
                            {liveError && <p className="text-red-400 mt-2 text-sm">{liveError}</p>}
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>
            <div className="p-4 bg-gray-900 border-t border-gray-700">
                {(mode === 'coding' || mode === 'chat') && (
                    <form onSubmit={handleSubmit} className="flex items-center gap-2">
                        <input type="text" value={codingPrompt} onChange={e => setCodingPrompt(e.target.value)} placeholder={textInputPlaceholder} className="w-full p-3 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" disabled={isLoading} />
                        <button type="submit" disabled={isLoading || !codingPrompt.trim()} className="bg-sky-600 text-white p-3 rounded-lg hover:bg-sky-500 disabled:bg-gray-600 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
                    </form>
                )}
                {mode === 'image-edit' && (
                    <ImageEditorPane prompt={imagePrompt} setPrompt={setImagePrompt} isLoading={isLoading} uploadedFile={uploadedFile} onFileSelect={setUploadedFile} externalPreviewUrl={externalPreviewUrl} onClearExternalPreview={() => setExternalPreviewUrl(null)} onSubmit={handleSubmit} />
                )}
                {mode === 'video-gen' && (
                    <VideoGeneratorPane prompt={videoPrompt} setPrompt={setVideoPrompt} isLoading={isLoading} uploadedFile={uploadedFile} onFileSelect={setUploadedFile} duration={duration} setDuration={setDuration} aspectRatio={aspectRatio} setAspectRatio={setAspectRatio} directorControls={directorControls} setDirectorControls={setDirectorControls} onSubmit={handleSubmit} />
                )}
                 {mode === 'live' && <LiveChatPane isListening={isListening} startListening={startListening} stopListening={stopListening} />}
            </div>
        </main>
    );
};

export default ChatPanel;