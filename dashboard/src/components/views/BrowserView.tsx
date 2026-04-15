import React from 'react';
import { motion } from 'framer-motion';
import { Globe, Shield, RefreshCcw, Camera } from 'lucide-react';

interface BrowserViewProps {
    snapshot: string | null; // Base64 image
    currentUrl: string;
    browserLogs: string[];
}

export const BrowserView: React.FC<BrowserViewProps> = ({ snapshot, currentUrl, browserLogs }) => {
    return (
        <div className="flex-1 h-full p-8 flex flex-col gap-6 view-container">
            {/* TOP BAR: Navigation Status */}
            <div className="hifi-card p-4 flex items-center justify-between border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
                <div className="flex items-center gap-4 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-[var(--color-brand-primary)]/10 flex items-center justify-center">
                        <Globe className="w-5 h-5 text-[var(--color-brand-primary)]" />
                    </div>
                    <div className="flex-1">
                        <div className="text-[10px] text-[var(--color-text-tertiary)] uppercase font-bold tracking-widest">Active URL</div>
                        <div className="text-sm font-data text-white truncate max-w-[600px]">{currentUrl || 'Waiting for navigation...'}</div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#10b981]/10 border border-[#10b981]/20">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                        <span className="text-[10px] font-bold text-[#10b981] uppercase">Live-Sync</span>
                    </div>
                    <button className="p-2 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] hover:border-white transition-colors">
                        <RefreshCcw className="w-4 h-4 text-[var(--color-text-secondary)]" />
                    </button>
                </div>
            </div>

            <div className="flex-1 flex gap-6 overflow-hidden">
                {/* LEFT: Live Screenshot */}
                <div className="flex-1 hifi-card p-1 bg-[#0a0a0f] border border-[var(--color-border-subtle)] relative group overflow-hidden">
                    {snapshot ? (
                        <motion.img
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            src={`data:image/png;base64,${snapshot}`}
                            className="w-full h-full object-contain rounded-lg shadow-2xl"
                            alt="Browser Viewport"
                        />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-[var(--color-text-tertiary)] bg-[var(--color-bg-base)] rounded-lg">
                            <Camera className="w-12 h-12 opacity-20" />
                            <p className="text-xs uppercase tracking-widest font-semibold opacity-40">Awaiting Browser Activity</p>
                        </div>
                    )}

                    <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-md border border-white/10 text-[10px] text-white/80 font-data">
                        VIEWPORT: 1280x720
                    </div>
                </div>

                {/* RIGHT: Tactical Browser Logs */}
                <div className="w-[380px] hifi-card flex flex-col p-6 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)]">
                    <div className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] pb-4 mb-4">
                        <Shield className="w-4 h-4 text-[var(--color-brand-primary)]" />
                        <h2 className="text-xs font-bold tracking-wider text-[var(--color-text-secondary)] uppercase">Agent Actions</h2>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
                        {browserLogs.length === 0 && (
                            <div className="text-center py-10 opacity-30">
                                <p className="text-xs font-data">No active sessions.</p>
                            </div>
                        )}
                        {browserLogs.map((log, i) => (
                            <div key={i} className="p-3 rounded-lg border border-white/5 bg-white/[0.02] space-y-1">
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-bold text-[var(--color-brand-primary)] uppercase">EXEC</span>
                                    <span className="text-[9px] text-[var(--color-text-tertiary)] font-data">{new Date().toLocaleTimeString()}</span>
                                </div>
                                <p className="text-[11px] text-gray-300 leading-relaxed font-data">{log}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
