import { useState, useRef, useEffect, useCallback } from 'react';
import type { Session as LiveSession, LiveServerMessage } from '@google/genai';
import { createBlob, decode, decodeAudioData } from '../utils/audio';

/* `@google/genai` is an 11MB package and this hook is the only thing in the client
   bundle that needs it — for a feature (`FEATURES.liveAudio`) that ships disabled.
   A static import here made it dead weight in every user's initial download anyway:
   measured at 385KB minified / 69KB gzipped of the largest chunk, gone once this
   became a dynamic import instead. `import type` above costs nothing at runtime;
   the value import happens here, the one place it is actually used. */
const loadGenAI = () => import('@google/genai');

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const BUFFER_SIZE = 4096;

export const useLiveChat = () => {
    const [isListening, setIsListening] = useState(false);
    const [liveError, setLiveError] = useState<string | null>(null);
    const [liveTranscription, setLiveTranscription] = useState<{ input: string, output: string, modelAudio: boolean }>({ input: '', output: '', modelAudio: false });
    
    const sessionPromise = useRef<Promise<LiveSession> | null>(null);
    const inputAudioContext = useRef<AudioContext | null>(null);
    const outputAudioContext = useRef<AudioContext | null>(null);
    const microphoneStream = useRef<MediaStream | null>(null);
    const scriptProcessor = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSource = useRef<MediaStreamAudioSourceNode | null>(null);
    
    const nextStartTime = useRef(0);
    const audioPlaybackSources = useRef(new Set<AudioBufferSourceNode>());

    const cleanupAudio = useCallback(() => {
        // Stop all ongoing audio playback
        if (outputAudioContext.current) {
            for (const source of audioPlaybackSources.current.values()) {
                source.stop();
            }
            audioPlaybackSources.current.clear();
        }
        nextStartTime.current = 0;

        // Disconnect microphone processing nodes
        if (scriptProcessor.current) {
            scriptProcessor.current.onaudioprocess = null;
            scriptProcessor.current.disconnect();
            scriptProcessor.current = null;
        }
        if (mediaStreamSource.current) {
            mediaStreamSource.current.disconnect();
            mediaStreamSource.current = null;
        }

        // Close audio contexts
        if (inputAudioContext.current && inputAudioContext.current.state !== 'closed') {
            inputAudioContext.current.close();
            inputAudioContext.current = null;
        }
        if (outputAudioContext.current && outputAudioContext.current.state !== 'closed') {
            outputAudioContext.current.close();
            outputAudioContext.current = null;
        }

        // Stop microphone stream
        if (microphoneStream.current) {
            microphoneStream.current.getTracks().forEach(track => track.stop());
            microphoneStream.current = null;
        }
    }, []);
    
    const stopListening = useCallback(() => {
        if (sessionPromise.current) {
            sessionPromise.current.then(session => session.close());
            sessionPromise.current = null;
        }
        cleanupAudio();
        setIsListening(false);
        setLiveTranscription({ input: '', output: '', modelAudio: false });
    }, [cleanupAudio]);

    const startListening = async () => {
        if (isListening) return;

        setLiveError(null);
        setIsListening(true);
        setLiveTranscription({ input: '', output: '', modelAudio: false });

        try {
            if (!process.env.API_KEY) {
                throw new Error("API_KEY environment variable not configured.");
            }
            const { GoogleGenAI, Modality } = await loadGenAI();
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

            microphoneStream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            inputAudioContext.current = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
            outputAudioContext.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });

            let currentInputTranscription = '';
            let currentOutputTranscription = '';

            sessionPromise.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        if (!microphoneStream.current || !inputAudioContext.current) return;
                        mediaStreamSource.current = inputAudioContext.current.createMediaStreamSource(microphoneStream.current);
                        scriptProcessor.current = inputAudioContext.current.createScriptProcessor(BUFFER_SIZE, 1, 1);
                        
                        scriptProcessor.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            if (sessionPromise.current) {
                                sessionPromise.current.then((session) => {
                                    session.sendRealtimeInput({ media: pcmBlob });
                                });
                            }
                        };
                        
                        mediaStreamSource.current.connect(scriptProcessor.current);
                        scriptProcessor.current.connect(inputAudioContext.current.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        // Handle transcription
                        if (message.serverContent?.inputTranscription) {
                            currentInputTranscription += message.serverContent.inputTranscription.text;
                        }
                         if (message.serverContent?.outputTranscription) {
                            currentOutputTranscription += message.serverContent.outputTranscription.text;
                        }
                        if (message.serverContent?.turnComplete) {
                            currentInputTranscription = '';
                            currentOutputTranscription = '';
                        }
                        setLiveTranscription({ input: currentInputTranscription, output: currentOutputTranscription, modelAudio: !!message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data });

                        // Handle audio playback
                        const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (base64Audio && outputAudioContext.current) {
                            const oac = outputAudioContext.current;
                            nextStartTime.current = Math.max(nextStartTime.current, oac.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), oac, OUTPUT_SAMPLE_RATE, 1);
                            
                            const source = oac.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(oac.destination);
                            
                            source.addEventListener('ended', () => {
                                audioPlaybackSources.current.delete(source);
                            });
                            
                            source.start(nextStartTime.current);
                            nextStartTime.current += audioBuffer.duration;
                            audioPlaybackSources.current.add(source);
                        }

                        // Handle interruption
                        if (message.serverContent?.interrupted) {
                            for (const source of audioPlaybackSources.current.values()) {
                                source.stop();
                            }
                            audioPlaybackSources.current.clear();
                            nextStartTime.current = 0;
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Live session error:', e);
                        setLiveError("An error occurred during the live session.");
                        stopListening();
                    },
                    onclose: (e: CloseEvent) => {
                        stopListening();
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                },
            });
        } catch (error: any) {
            console.error('Failed to start listening:', error);
            setLiveError(error.message || "Failed to start live chat. Please check microphone permissions.");
            stopListening();
        }
    };
    
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopListening();
        };
    }, [stopListening]);

    return { isListening, liveTranscription, liveError, startListening, stopListening };
};