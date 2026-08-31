import { useState, useEffect, useRef } from 'react';

export const useTTS = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const cancel = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    // State is reset by the onend handler
  };

  const speak = (text: string, messageId: string) => {
    if (!window.speechSynthesis) {
        console.warn("Text-to-speech is not supported in this browser.");
        return;
    }

    // Cancel any currently playing speech before starting a new one
    cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utteranceRef.current = utterance;

    utterance.onstart = () => {
      setIsPlaying(true);
      setCurrentlyPlayingId(messageId);
    };

    utterance.onend = () => {
      setIsPlaying(false);
      setCurrentlyPlayingId(null);
      utteranceRef.current = null;
    };
    
    utterance.onerror = (event) => {
      console.error('SpeechSynthesisUtterance.onerror', event);
      setIsPlaying(false);
      setCurrentlyPlayingId(null);
      utteranceRef.current = null;
    };

    window.speechSynthesis.speak(utterance);
  };

  // Cleanup effect to cancel speech synthesis on component unmount
  useEffect(() => {
    return () => {
      cancel();
    };
  }, []);

  return { speak, cancel, isPlaying, currentlyPlayingId };
};
