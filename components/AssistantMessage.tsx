import React from 'react';
import { Message } from '../types/index';
import VideoPlayer from './VideoPlayer';
import { renderTextWithCodeBlocks } from '../utils/ui';

interface AssistantMessageProps {
  message: Message;
  onRegenerate?: (messageId: string) => void;
  onContinueScene?: (messageId: string) => void;
  onUseImage?: (imageUrl: string) => void;
  onPlayAudio?: (messageId: string, text: string) => void;
  isPlaying?: boolean;
}

const PlayIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg> );
const StopIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg> );

const AssistantMessage: React.FC<AssistantMessageProps> = ({ message, onRegenerate, onContinueScene, onUseImage, onPlayAudio, isPlaying }) => {
    const canRegenerateVideo = message.regenerationData && onRegenerate;
    const canContinueScene = message.parts.some(p => p.videoUrl) && onContinueScene;
    const textContent = message.parts.map(p => p.text).filter(Boolean).join('\n');
    const canPlayAudio = textContent && onPlayAudio;

    return (
        <div className="p-4 rounded-2xl max-w-lg lg:max-w-2xl xl:max-w-4xl break-words bg-gray-700 rounded-bl-none">
          {message.parts.map((part, index) => (
            <div key={index}>
              {part.text && <div className="whitespace-pre-wrap">{renderTextWithCodeBlocks(part.text)}</div>}
              {part.imageUrl && (
                <div className="mt-2 relative">
                  {part.sourceImageUrl && (
                    <div className="absolute top-2 left-2 bg-black/60 p-1 rounded-lg flex items-center gap-2 text-xs">
                      <span className="text-gray-300">Based on:</span>
                      <img src={part.sourceImageUrl} alt="source" className="h-10 w-10 rounded-md object-cover border-2 border-gray-500" />
                    </div>
                  )}
                  <img src={part.imageUrl} alt="content" className="rounded-lg max-w-xs md:max-w-sm" />
                </div>
              )}
              {part.videoUrl && <VideoPlayer src={part.videoUrl} />}
            </div>
          ))}
          <div className="flex justify-end items-center flex-wrap gap-2 mt-2 pt-2 border-t border-gray-600/50">
                {canPlayAudio && (<button onClick={() => onPlayAudio(message.id, textContent)} className={`p-1.5 rounded-full transition-colors ${isPlaying ? 'text-white bg-sky-600' : 'text-gray-300 hover:bg-gray-600 hover:text-white'}`} aria-label={isPlaying ? "Stop" : "Read aloud"}>{isPlaying ? <StopIcon /> : <PlayIcon />}</button>)}
                {message.parts.some(p => p.imageUrl) && onUseImage && (<button onClick={() => onUseImage(message.parts.find(p => p.imageUrl)!.imageUrl!)} className="px-3 py-1 bg-gray-600 text-gray-200 text-xs font-semibold rounded-md hover:bg-sky-600 transition-colors flex items-center justify-center" aria-label="Use image for next edit"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}> <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" /> </svg>Use this image</button>)}
                {canContinueScene && (<button onClick={() => onContinueScene(message.id)} className="px-3 py-1 bg-gray-600 text-gray-200 text-xs font-semibold rounded-md hover:bg-sky-600 transition-colors flex items-center justify-center" aria-label="Continue video scene"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor"> <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /> <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.022 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /> </svg>Continue Scene</button>)}
                {canRegenerateVideo && (<button onClick={() => onRegenerate(message.id)} className="px-3 py-1 bg-gray-600 text-gray-200 text-xs font-semibold rounded-md hover:bg-sky-600 transition-colors flex items-center justify-center" aria-label="Regenerate video"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" /></svg>Regenerate</button>)}
          </div>
          {message.toolCall && (<div className="mt-2 p-3 bg-gray-800/50 border border-gray-600 rounded-lg text-sm text-gray-300">
              <div className="flex items-center gap-2 font-mono text-xs text-sky-400"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg><span>Tool Call: {message.toolCall.name}</span></div>
              <pre className="mt-1 p-2 bg-gray-900 rounded text-xs overflow-x-auto"><code>{JSON.stringify(message.toolCall.args, null, 2)}</code></pre>
          </div>)}
          {message.groundingMetadata && message.groundingMetadata.length > 0 && (<div className="mt-4 pt-3 border-t border-gray-600">
              <h4 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9V3m0 18a9 9 0 009-9m-9 9a9 9 0 00-9-9" /></svg>Sources from the web</h4>
              <ul className="space-y-1">{message.groundingMetadata.map((chunk, index) => (<li key={index} className="text-xs flex items-start gap-2"><span className="text-gray-400 mt-0.5">&bull;</span><a href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline break-all">{chunk.web.title || chunk.web.uri}</a></li>))}</ul>
          </div>)}
        </div>
    );
};

export default AssistantMessage;