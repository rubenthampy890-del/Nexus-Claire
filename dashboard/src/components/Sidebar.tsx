import React from 'react';
import { Terminal, Database, Target, Activity, Zap, Command, Shield } from 'lucide-react';

export type ViewType = 'TERMINAL' | 'VAULT' | 'DIRECTIVES' | 'ANALYTICS' | 'ORB' | 'SWARM' | 'SANDBOX';

interface SidebarProps {
    currentView: ViewType;
    onViewChange: (view: ViewType) => void;
    bridgeStatus: string;
    micActive: boolean;
    micError: string | null;
    onToggleMic: () => void;
    isExecuting: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange, bridgeStatus, micActive, micError, onToggleMic, isExecuting }) => {
    const navItems = [
        { id: 'TERMINAL', icon: Terminal, label: 'Terminal' },
        { id: 'SWARM', icon: Command, label: 'Swarm' }, // Reusing Command or adding Layers
        { id: 'VAULT', icon: Database, label: 'Vault' },
        { id: 'DIRECTIVES', icon: Target, label: 'Directives' },
        { id: 'ANALYTICS', icon: Activity, label: 'Analytics' },
        { id: 'SANDBOX', icon: Shield, label: 'Sandbox' },
    ];

    return (
        <div className="w-[72px] h-full flex flex-col items-center py-6 border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] z-50">

            {/* Brand / Orb Mode Toggle */}
            <div className="mb-10 cursor-pointer group" onClick={() => onViewChange('ORB')}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${currentView === 'ORB'
                    ? 'bg-gradient-to-br from-[#6366f1] to-[#a855f7] shadow-[0_0_20px_rgba(99,102,241,0.3)]'
                    : 'bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] hover:border-[#6366f1] hover:shadow-[0_0_15px_rgba(99,102,241,0.1)]'
                    }`}>
                    <Zap className={`w-5 h-5 ${currentView === 'ORB' ? 'text-white' : 'text-[#6366f1]'}`} />
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex flex-col gap-4 w-full items-center">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentView === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onViewChange(item.id as ViewType)}
                            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all relative group ${isActive
                                ? 'bg-[var(--color-bg-card)] text-white border border-[var(--color-border-default)]'
                                : 'text-[var(--color-text-tertiary)] hover:text-white hover:bg-[var(--color-bg-card)]'
                                } ${item.id === 'SWARM' && isExecuting ? 'animate-pulse text-[var(--color-brand-accent)]' : ''}`}
                            title={item.label}
                        >
                            <Icon className="w-5 h-5" />
                            {isActive && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-r-md" />
                            )}
                        </button>
                    );
                })}
            </nav>

            <div className="mt-auto flex flex-col items-center gap-6">
                <div className="relative">
                    <Command className="w-5 h-5 text-[var(--color-text-tertiary)]" />
                </div>
                <div className={`w-2.5 h-2.5 rounded-full ${bridgeStatus === 'ACTIVE' ? 'bg-[#10b981]' : 'bg-[#ef4444]'}`} title={`Bridge: ${bridgeStatus}`} />

                {/* Voice Status & Sync */}
                <button
                    onClick={onToggleMic}
                    className={`flex flex-col items-center gap-1 group transition-all ${micError ? 'text-[#ef4444]' : micActive ? 'text-[#10b981]' : 'text-[var(--color-text-tertiary)]'}`}
                    title={micError || (micActive ? 'Mic Active' : 'Mic Off')}
                >
                    <Zap className={`w-5 h-5 ${micActive ? 'fill-current' : ''} ${micError ? 'animate-pulse' : ''}`} />
                    {micError && <span className="text-[10px] whitespace-nowrap font-bold uppercase">{micError}</span>}
                </button>
            </div>
        </div>
    );
};
