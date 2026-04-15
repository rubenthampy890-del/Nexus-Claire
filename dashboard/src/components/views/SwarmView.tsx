import React from 'react';
import { Layers, Shield, User, ChevronRight, Zap, Target, Activity } from 'lucide-react';
import { motion } from 'framer-motion';

interface AgentNode {
    id: string;
    name: string;
    role: string;
    status: 'ACTIVE' | 'IDLE' | 'TERMINATED';
    authority: number;
    parent_id: string | null;
    children: AgentNode[];
}

interface SwarmStats {
    activeSidecars?: number;
    queuedTasks?: number;
    completedTasks?: number;
    hierarchy?: AgentNode;
}

interface SwarmViewProps {
    data: SwarmStats | null;
}

const AgentCard: React.FC<{ agent: AgentNode; depth: number }> = ({ agent, depth }) => {
    return (
        <div className="flex flex-col items-center">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: depth * 0.1 }}
                className={`hifi-card p-6 w-[300px] relative group transition-all ${agent.status === 'ACTIVE'
                        ? 'border-[#6366f1]/30 shadow-[0_0_20px_rgba(99,102,241,0.1)]'
                        : agent.status === 'TERMINATED'
                            ? 'opacity-30 border-red-500/20'
                            : 'opacity-60'
                    }`}
            >
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${agent.authority >= 8 ? 'bg-[#a855f7]/20' : 'bg-[#6366f1]/20'
                            } border border-white/10`}>
                            <User className={`w-4 h-4 ${agent.authority >= 8 ? 'text-[#a855f7]' : 'text-[#6366f1]'
                                }`} />
                        </div>
                        <div>
                            <h3 className="text-white font-medium text-sm tracking-tight">{agent.name}</h3>
                            <p className="text-[var(--color-text-tertiary)] text-[10px] uppercase tracking-widest mt-0.5 max-w-[180px] truncate">
                                {agent.role}
                            </p>
                        </div>
                    </div>
                    <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${agent.status === 'ACTIVE'
                            ? 'text-[#10b981] border-[#10b981]/30 bg-[#10b981]/10'
                            : agent.status === 'TERMINATED'
                                ? 'text-red-400 border-red-500/30 bg-red-900/10'
                                : 'text-gray-400 border-gray-700 bg-gray-800/50'
                        }`}>
                        {agent.status}
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex justify-between items-center text-[11px]">
                        <span className="text-[var(--color-text-tertiary)] flex items-center gap-1.5 uppercase tracking-wider">
                            <Shield className="w-3 h-3" /> Authority
                        </span>
                        <span className="text-white font-data">Lvl {agent.authority}</span>
                    </div>
                    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${agent.authority * 10}%` }}
                            className={`h-full ${agent.authority >= 8
                                    ? 'bg-gradient-to-r from-[#6366f1] to-[#a855f7]'
                                    : 'bg-[#6366f1]'
                                }`}
                        />
                    </div>
                </div>

                {agent.children.length > 0 && (
                    <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 p-1.5 bg-[#111] border border-white/10 rounded-full shadow-lg z-10 group-hover:scale-110 transition-transform">
                        <ChevronRight className="w-3 h-3 text-[var(--color-text-tertiary)] rotate-90" />
                    </div>
                )}
            </motion.div>

            {agent.children.length > 0 && (
                <div className="mt-12 flex gap-8 relative">
                    {agent.children.length > 1 && (
                        <div className="absolute top-0 left-[150px] right-[150px] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                    )}
                    {agent.children.map((child: AgentNode) => (
                        <div key={child.id} className="relative">
                            <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-px h-12 bg-white/10" />
                            <AgentCard agent={child} depth={depth + 1} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export const SwarmView: React.FC<SwarmViewProps> = ({ data }) => {
    const hierarchy = data?.hierarchy || {
        id: 'nexus-prime',
        name: 'Nexus Prime',
        role: 'Orchestrator',
        status: 'ACTIVE' as const,
        authority: 10,
        parent_id: null,
        children: []
    };

    const activeSidecars = data?.activeSidecars || 0;
    const queuedTasks = data?.queuedTasks || 0;
    const completedTasks = data?.completedTasks || 0;

    return (
        <div className="flex-1 h-full p-8 view-container overflow-auto custom-scrollbar bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.05),transparent_50%)]">
            <div className="max-w-7xl mx-auto min-h-full flex flex-col">
                <div className="mb-12 flex justify-between items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-3">
                            <Layers className="w-6 h-6 text-[#6366f1]" />
                            Agent Hierarchy
                        </h1>
                        <p className="text-[var(--color-text-secondary)] mt-2 text-sm">
                            Live visualization of autonomous agent swarm.
                        </p>
                    </div>
                    <div className="flex gap-4">
                        <div className="hifi-card px-4 py-2 flex items-center gap-3 bg-[var(--color-bg-base)]">
                            <Zap className="w-4 h-4 text-[#a855f7]" />
                            <div className="text-xs">
                                <span className="text-[var(--color-text-tertiary)] mr-2 uppercase tracking-widest text-[9px]">Satellites</span>
                                <span className="text-white font-data">{activeSidecars}</span>
                            </div>
                        </div>
                        <div className="hifi-card px-4 py-2 flex items-center gap-3 bg-[var(--color-bg-base)]">
                            <Activity className="w-4 h-4 text-[#f59e0b]" />
                            <div className="text-xs">
                                <span className="text-[var(--color-text-tertiary)] mr-2 uppercase tracking-widest text-[9px]">Queued</span>
                                <span className="text-white font-data">{queuedTasks}</span>
                            </div>
                        </div>
                        <div className="hifi-card px-4 py-2 flex items-center gap-3 bg-[var(--color-bg-base)]">
                            <Target className="w-4 h-4 text-[#10b981]" />
                            <div className="text-xs">
                                <span className="text-[var(--color-text-tertiary)] mr-2 uppercase tracking-widest text-[9px]">Completed</span>
                                <span className="text-white font-data">{completedTasks}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex justify-center py-10">
                    <AgentCard agent={hierarchy} depth={0} />
                </div>
            </div>
        </div>
    );
};
