import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Mic, MicOff } from 'lucide-react';
import { PlexusOrb } from './PlexusOrb';

interface OrbViewProps {
    audioContext: AudioContext | null;
    sourceNode: MediaElementAudioSourceNode | null;
    isSpeaking: boolean;
    userSpeaking?: boolean;
    micActive: boolean;
    onToggleMic: () => void;
}

export const OrbView: React.FC<OrbViewProps> = ({ audioContext, sourceNode, isSpeaking, userSpeaking, micActive, onToggleMic }) => {
    const isVisualizing = isSpeaking || !!userSpeaking;

    return (
        <div className="flex-1 flex flex-col items-center justify-center relative bg-[#010101] h-full overflow-hidden">
            {/* Background Atmosphere */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-[120px] pointer-events-none" />

            <div className={`relative w-[600px] h-[600px] flex items-center justify-center transition-all duration-700 ${userSpeaking ? 'scale-105' : 'scale-100'}`}>
                <PlexusOrb audioContext={audioContext} sourceNode={sourceNode} isPlaying={isVisualizing} />
            </div>

            <AnimatePresence>
                {isVisualizing && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="absolute bottom-[20%] flex flex-col items-center gap-2"
                    >
                        <div className="text-cyan-400 font-bold text-[10px] tracking-[0.5em] uppercase flex items-center gap-3 drop-shadow-[0_0_15px_rgba(34,211,238,0.6)]">
                            <Zap className={`w-3 h-3 ${isSpeaking ? 'animate-pulse' : 'animate-bounce'}`} />
                            {userSpeaking ? "Neural Processing" : "Synthesizing Response"}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="absolute bottom-12 flex flex-col items-center justify-center gap-6 z-50">
                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={onToggleMic}
                    className={`group relative flex items-center gap-4 px-12 py-5 rounded-full font-bold tracking-[0.2em] uppercase transition-all duration-300 border ${micActive
                            ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 shadow-[0_0_50px_rgba(6,182,212,0.2)]'
                            : 'bg-white/5 text-zinc-500 border-white/10 hover:border-white/20'
                        }`}
                >
                    {micActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                    <span>{micActive ? 'Active' : 'Offline'}</span>

                    {micActive && (
                        <div className="absolute -inset-1 bg-cyan-500/20 rounded-full blur-xl animate-pulse -z-10" />
                    )}
                </motion.button>

                <span className={`text-[9px] uppercase font-bold tracking-[0.3em] transition-colors duration-300 ${micActive ? 'text-cyan-500' : 'text-zinc-700'}`}>
                    {micActive ? 'Autonomous Matrix Engaged' : 'System Standby'}
                </span>
            </div>
        </div>
    );
};
