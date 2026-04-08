import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap } from 'lucide-react';
import { AudioVisualizer } from './AudioVisualizer';

interface OrbViewProps {
    audioContext: AudioContext | null;
    sourceNode: MediaElementAudioSourceNode | null;
    isSpeaking: boolean;
    userSpeaking?: boolean;
    micActive: boolean;
}

export const OrbView: React.FC<OrbViewProps> = ({ audioContext, sourceNode, isSpeaking, userSpeaking, micActive }) => {
    const isVisualizing = isSpeaking || !!userSpeaking;

    return (
        <div className="flex-1 flex flex-col items-center justify-center relative bg-[var(--color-bg-base)] h-full overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] jarvis-orb rounded-full opacity-30 pointer-events-none" />
            <div className={`w-[500px] h-[500px] scale-110 transition-shadow duration-300 rounded-full ${userSpeaking ? 'shadow-[0_0_80px_rgba(16,185,129,0.15)]' : ''}`}>
                <AudioVisualizer audioContext={audioContext} sourceNode={sourceNode} isPlaying={isVisualizing} />
            </div>

            <AnimatePresence>
                {isVisualizing && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute bottom-[25%] text-[var(--color-brand-accent)] font-bold text-xs tracking-[0.4em] uppercase flex items-center gap-3 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]">
                        <Zap className="w-4 h-4 animate-spin" /> {userSpeaking ? "Listening..." : "Transmitting"}
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="absolute bottom-12 flex flex-col items-center justify-center gap-4">
                <span className={`text-[10px] uppercase font-bold tracking-widest ${micActive ? 'text-red-500 drop-shadow-[0_0_5px_rgba(239,68,68,0.5)]' : 'text-[var(--color-text-tertiary)]'}`}>
                    {micActive ? 'Listening Active' : 'Listening Offline'}
                </span>
            </div>
        </div>
    );
};
