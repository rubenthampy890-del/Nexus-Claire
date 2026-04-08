import React from 'react';
import { Activity, Cpu, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface SystemTelemetry { cpu: number; memUsed: number; memTotal: number; memPct: number; activeApp: string; uptime: string; timestamp: string; }

export const AnalyticsView: React.FC<{ telemetry: SystemTelemetry | null }> = ({ telemetry }) => {
    return (
        <div className="flex-1 h-full p-8 view-container overflow-y-auto custom-scrollbar">
            <div className="max-w-5xl mx-auto">
                <div className="mb-10">
                    <h1 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-3">
                        <Activity className="w-6 h-6 text-[#ef4444]" />
                        System Analytics
                    </h1>
                    <p className="text-[var(--color-text-secondary)] mt-2 text-sm">Real-time performance and host telemetry.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="hifi-card p-8">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="p-4 bg-[var(--color-bg-base)] rounded-xl border border-[var(--color-border-subtle)]">
                                <Cpu className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">Core Compute</h3>
                                <div className="text-3xl font-light text-white mt-1">{telemetry?.cpu.toFixed(1) || 0}%</div>
                            </div>
                        </div>
                        <div className="h-2 w-full bg-[var(--color-bg-base)] rounded-full overflow-hidden border border-[var(--color-border-subtle)]">
                            <motion.div animate={{ width: `${telemetry?.cpu || 0}%` }} transition={{ duration: 0.5 }} className="h-full bg-white" />
                        </div>
                    </div>

                    <div className="hifi-card p-8">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="p-4 bg-[var(--color-bg-base)] rounded-xl border border-[var(--color-border-subtle)]">
                                <Zap className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">Memory Allocation</h3>
                                <div className="text-3xl font-light text-white mt-1">{telemetry?.memPct.toFixed(1) || 0}%</div>
                            </div>
                        </div>
                        <div className="h-2 w-full bg-[var(--color-bg-base)] rounded-full overflow-hidden border border-[var(--color-border-subtle)]">
                            <motion.div animate={{ width: `${telemetry?.memPct || 0}%` }} transition={{ duration: 0.5 }} className="h-full bg-white" />
                        </div>
                    </div>

                    <div className="hifi-card p-8 md:col-span-2 flex justify-between items-center bg-[var(--color-bg-base)]">
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">System Uptime</h3>
                            <div className="text-2xl font-data text-gray-200">{telemetry?.uptime || '00:00:00'}</div>
                        </div>
                        <div className="text-right">
                            <h3 className="text-sm font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">Active Process</h3>
                            <div className="text-xl text-gray-300">{telemetry?.activeApp || 'NEXUS COGNITION'}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
