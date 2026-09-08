import React, { useState, useRef, useEffect, Suspense, lazy } from 'react';
import MessageItem from './MessageItem';
import ModeSelector from './ModeSelector';
/* Each of these three panes exists for a feature that ships disabled
   (`utils/features.ts`'s `FEATURES`) — the mode picker never offers them, so most
   sessions never render one. Lazy, same as `CodeEditor` in `IdeView.tsx`, so their
   code is not paid for on every chat load, only on the visit that actually reaches
   one. `useLiveChat`'s own `@google/genai` dependency is the load-bearing half of
   this fix — see that hook's own dynamic import — this half is the smaller,
   consistency win on top of it. */
const ImageEditorPane = lazy(() => import('./ImageEditorPane'));
const VideoGeneratorPane = lazy(() => import('./VideoGeneratorPane'));
const LiveChatPane = lazy(() => import('./LiveChatPane'));
import LoadingIndicator from './LoadingIndicator';
import ModelPicker from './ModelPicker';
import QuotaBadge from './QuotaBadge';
import { useChat } from '../hooks/useChat';
import { useTTS } from '../hooks/useTTS';
import { useLiveChat } from '../hooks/useLiveChat';
import { useAppContext } from '../context/AppContext';
import { ChatMode } from '../types/index';
import { composeBuilderBrief, hasBuilderBrief } from '../utils/builderBrief';

const ChatPanel: React.FC = () => {
    const {
      projects, selectedProjectIds, filesByProject, activePersona, useWebSearch, customAiStyles, lowLatencyMode, activeAgentId, selectedModel,
      aiCreateFile, aiUpdateFile, aiDeleteFile, bumpQuotaTick, startWebAppBuild, setSurface
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

    const { messages, isLoading, statusText, sendMessage, regenerate, resolvePendingTool } = useChat(selectedProjects, activePersona, useWebSearch, customAiStyles, lowLatencyMode, aiFileOperations, filesByProject, `gemini_messages_${activeAgentId ?? 'general'}`, selectedModel === 'auto' ? undefined : selectedModel);
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
            'plan': { prompt: codingPrompt, setPrompt: setCodingPrompt },
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
        void sendMessage(augmentedPrompt, currentChatMode, uploadedFile).finally(bumpQuotaTick);
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
        <main className="flex-1 flex flex-col bg-ground min-w-0 h-full">
            {/* The controls stay put; only the transcript scrolls. On a phone a
                header that scrolls away takes the model picker with it. */}
            {/* No overflow-x here: setting one axis to `auto` makes the other
                `auto` too, and it was cropping the mode pill's top edge. The
                selector scrolls inside itself instead. */}
            {/* The bands run edge to edge so their rules do; the content inside each is
                capped to a readable measure and centred. Chat is a full-screen
                destination at every width now, and a 1440px line of prose is not a
                feature of the extra room, it is what the extra room does if you let it. */}
            <div className="shrink-0 flex justify-center px-4 py-2 safe-t md:pt-2
                            shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]">
              <div className="w-full max-w-3xl flex items-center gap-2">
                <div className="flex-1 min-w-0">
                    {!activeAgentId && <ModeSelector currentMode={mode} onModeChange={setMode} isAgentActive={!!activeAgentId} />}
                </div>
                <QuotaBadge surface="chat" />
                <ModelPicker compact />
              </div>
            </div>
            <div className="flex-1 flex flex-col overflow-y-auto px-4 py-3 md:px-5">
                <div className="flex-1 w-full max-w-3xl mx-auto space-y-4">
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
                        <div className="my-4 p-4 rounded-card bg-surface hairline text-sm text-metal-300">
                            {!isListening && !liveError && <p className="text-center">Tap “Start Listening” to begin a conversation.</p>}
                            {isListening && (
                                <>
                                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-2">Live transcription</p>
                                    <p className="min-h-[1.5em] text-metal-100"><span className="meta text-xs">you</span> {liveTranscription.input}</p>
                                    <p className="min-h-[1.5em] text-metal-100"><span className="meta text-xs">model</span> {liveTranscription.output}</p>
                                </>
                            )}
                            {liveError && (
                                <p className="flex items-start gap-2 mt-2 text-metal-100">
                                    <span aria-hidden className="w-1.5 h-1.5 mt-1.5 rounded-full bg-accent shrink-0" />
                                    {liveError}
                                </p>
                            )}
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>
            {/* This carried `md:pr-32` — a 128px gutter reserving the bottom-right
                corner for the Memory panel's own floating trigger, which used to land on
                top of the send button. That trigger is gone; Memory is a dock item. A
                gutter held open for a control that no longer exists is just a hole. */}
            <div className="shrink-0 flex justify-center p-3 md:p-4 bg-ground shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
              <div className="w-full max-w-3xl">
                {/* The hand-off. Present only in `plan` mode, and only once there is
                    something to hand over — a button that is always there and usually
                    does nothing teaches you to ignore it.

                    It seeds and navigates; it does not build. The brief lands in the
                    wizard's textarea where it can be read and edited before any model
                    call, because a composer that quietly guessed wrong would otherwise
                    send a plausible-looking brief nobody checked. */}
                {mode === 'plan' && hasBuilderBrief(messages) && (
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-xs text-metal-300 min-w-0 truncate">
                            Ready to build? You can edit it first.
                        </p>
                        <button
                            type="button"
                            onClick={() => { startWebAppBuild(composeBuilderBrief(messages)); setSurface('build'); }}
                            className="tap shrink-0 px-4 rounded-xl bg-metal-700 text-metal-100 text-sm font-medium
                                       shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]
                                       transition-[background-color,transform] duration-200 ease-fluid
                                       md:hover:bg-[#33333a] active:scale-[0.98]"
                        >
                            Send to Builder
                        </button>
                    </div>
                )}
                {(mode === 'coding' || mode === 'chat' || mode === 'plan') && (
                    <form onSubmit={handleSubmit} className="flex items-center gap-2">
                        <input
                            type="text"
                            value={codingPrompt}
                            onChange={e => setCodingPrompt(e.target.value)}
                            placeholder={textInputPlaceholder}
                            disabled={isLoading}
                            className="tap flex-1 min-w-0 px-4 bg-raised rounded-xl text-metal-100
                                       placeholder:text-metal-400 hairline focus:outline-none disabled:opacity-35"
                        />
                        <button
                            type="submit"
                            disabled={isLoading || !codingPrompt.trim()}
                            aria-label="Send"
                            className="tap shrink-0 flex items-center justify-center rounded-xl
                                       bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]
                                       transition-[background-color,transform] duration-200 ease-fluid
                                       md:hover:bg-[#33333a] active:scale-[0.98]
                                       disabled:opacity-35 disabled:active:scale-100"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                        </button>
                    </form>
                )}
                {(mode === 'image-edit' || mode === 'video-gen' || mode === 'live') && (
                    <Suspense fallback={<div className="h-11" aria-hidden />}>
                        {mode === 'image-edit' && (
                            <ImageEditorPane prompt={imagePrompt} setPrompt={setImagePrompt} isLoading={isLoading} uploadedFile={uploadedFile} onFileSelect={setUploadedFile} externalPreviewUrl={externalPreviewUrl} onClearExternalPreview={() => setExternalPreviewUrl(null)} onSubmit={handleSubmit} />
                        )}
                        {mode === 'video-gen' && (
                            <VideoGeneratorPane prompt={videoPrompt} setPrompt={setVideoPrompt} isLoading={isLoading} uploadedFile={uploadedFile} onFileSelect={setUploadedFile} duration={duration} setDuration={setDuration} aspectRatio={aspectRatio} setAspectRatio={setAspectRatio} directorControls={directorControls} setDirectorControls={setDirectorControls} onSubmit={handleSubmit} />
                        )}
                        {mode === 'live' && <LiveChatPane isListening={isListening} startListening={startListening} stopListening={stopListening} />}
                    </Suspense>
                )}
              </div>
            </div>
        </main>
    );
};

export default ChatPanel;