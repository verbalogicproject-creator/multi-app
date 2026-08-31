import React from 'react';

interface LiveChatPaneProps {
    isListening: boolean;
    startListening: () => void;
    stopListening: () => void;
}

const VoiceVisualizer: React.FC = () => (
    <div className="relative w-24 h-24 flex items-center justify-center">
        {/* Base Circle */}
        <div className="absolute w-16 h-16 bg-sky-500 rounded-full opacity-70"></div>
        {/* Pulsing Animation */}
        <div className="absolute w-16 h-16 bg-sky-400 rounded-full animate-ping"></div>
        {/* Icon */}
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white z-10" viewBox="0 0 20 20" fill="currentColor">
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
                <button onClick={startListening} className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" /><path fillRule="evenodd" d="M5.5 10.5A.5.5 0 016 10h8a.5.5 0 010 1H6a.5.5 0 01-.5-.5z" clipRule="evenodd" /><path d="M3 10a5 5 0 1010 0v-6a5 5 0 10-10 0v6z" /></svg>
                    Start Listening
                </button>
            ) : (
                <button onClick={stopListening} className="px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                    Stop Listening
                </button>
            )}
        </div>
    );
};

export default LiveChatPane;
