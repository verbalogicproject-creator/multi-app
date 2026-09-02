import React from 'react';

interface LiveChatPaneProps {
    isListening: boolean;
    startListening: () => void;
    stopListening: () => void;
}

/**
 * A hot microphone is one of the few things in this app that genuinely needs
 * you to know about it, so it is the accent — and it stops being the accent the
 * instant you stop listening. Starting is an ordinary action and stays metal.
 */
const VoiceVisualizer: React.FC = () => (
    <div className="relative w-24 h-24 flex items-center justify-center" role="status" aria-label="Listening">
        <div aria-hidden className="absolute w-16 h-16 bg-accent-strong rounded-full opacity-70" />
        <div aria-hidden className="absolute w-16 h-16 bg-accent rounded-full animate-ping" />
        <svg xmlns="http://www.w3.org/2000/svg" aria-hidden className="h-8 w-8 text-metal-100 z-10" viewBox="0 0 20 20" fill="currentColor">
            <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
            <path fillRule="evenodd" d="M5.5 10.5A.5.5 0 016 10h8a.5.5 0 010 1H6a.5.5 0 01-.5-.5z" clipRule="evenodd" />
            <path d="M3 10a5 5 0 1010 0v-6a5 5 0 10-10 0v6z" />
        </svg>
    </div>
);

const LiveChatPane: React.FC<LiveChatPaneProps> = ({ isListening, startListening, stopListening }) => {
    return (
        <div className="flex flex-col justify-center items-center gap-4">
            {isListening && <VoiceVisualizer />}
            {!isListening ? (
                <button onClick={startListening}
                    className="tap px-6 rounded-xl bg-metal-700 text-metal-100 font-medium flex items-center gap-2
                               shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]
                               transition-[background-color,transform] duration-200 ease-fluid
                               md:hover:bg-[#33333a] active:scale-[0.98]">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" /><path fillRule="evenodd" d="M5.5 10.5A.5.5 0 016 10h8a.5.5 0 010 1H6a.5.5 0 01-.5-.5z" clipRule="evenodd" /><path d="M3 10a5 5 0 1010 0v-6a5 5 0 10-10 0v6z" /></svg>
                    Start listening
                </button>
            ) : (
                <button onClick={stopListening}
                    className="tap px-6 rounded-xl bg-metal-700 text-metal-100 font-medium flex items-center gap-2
                               shadow-[inset_0_0_0_1px_rgb(234_88_12/0.5)]
                               transition-[background-color,transform] duration-200 ease-fluid
                               md:hover:bg-[#33333a] active:scale-[0.98]">
                    <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                    Stop listening
                </button>
            )}
        </div>
    );
};

export default LiveChatPane;
