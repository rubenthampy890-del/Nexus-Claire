import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Target, Database, Cpu, Zap, Activity as ActivityIcon, Plus, X } from 'lucide-react';
import { ChatBubble } from './ChatBubble';

interface ChatMessage { role: string; text: string; id: string; }
interface Goal { id: string; title: string; description: string; status: string; progress: number; }
interface SystemTelemetry { cpu: number; memUsed: number; memTotal: number; memPct: number; activeApp: string; uptime: string; timestamp: string; }
interface VaultFact { id: number; entity: string; fact: string; timestamp: string; }

interface DashboardViewProps {
    telemetry: SystemTelemetry | null;
    logs: string[];
    chatMessages: ChatMessage[];
    vaultFacts: VaultFact[];
    goals: Goal[];
    inputValue: string;
    setInputValue: (val: string) => void;
    onSendMessage: (e: React.FormEvent) => void;
    goalTitle: string;
    setGoalTitle: (val: string) => void;
    showGoalForm: boolean;
    setShowGoalForm: (val: boolean) => void;
    handleCreateGoal: (e: React.FormEvent) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
    telemetry, logs, chatMessages, vaultFacts, goals,
    inputValue, setInputValue, onSendMessage,
    goalTitle, setGoalTitle, showGoalForm, setShowGoalForm, handleCreateGoal
}) => {
    const logsEndRef = useRef<HTMLDivElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

    return (
        <div className="flex-1 h-full p-6 flex gap-6 font-sans">

            {/* LEFT: Tactical Chat Panel */}
            <div className="w-[380px] bento-card flex flex-col p-6 shadow-sm">
                <div className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] pb-4 mb-4">
                    <ActivityIcon className="text-[var(--color-brand-primary)] w-5 h-5" />
                    <h1 className="text-sm font-semibold tracking-wide text-white">NEXUS TERMINAL</h1>
                </div>

                <div className="flex-1 overflow-y-auto flex flex-col gap-5 pr-2 mb-4 custom-scrollbar">
                    {chatMessages.length === 0 && (
                        <div className="flex-1 flex items-center justify-center text-[var(--color-text-tertiary)] text-xs">
                            Waiting for input...
                        </div>
                    )}
                    {chatMessages.map((msg) => (
                        <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                            <ChatBubble role={msg.role} text={msg.text} variant="dashboard" />
                        </motion.div>
                    ))}
                    <div ref={chatEndRef} />
                </div>

                <form onSubmit={onSendMessage} className="relative pt-4 border-t border-[var(--color-border-subtle)]">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="Type a message..."
                        className="w-full bg-[#13131a] border border-[var(--color-border-subtle)] rounded-xl pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-[var(--color-brand-primary)] text-white transition-colors placeholder:text-[#64748b]"
                    />
                    <button type="submit" className="absolute right-3 top-1/2 -translate-y-[-2px] text-[#64748b] hover:text-[var(--color-brand-accent)] transition-colors cursor-pointer p-1">
                        <Send className="w-4 h-4" />
                    </button>
                </form>
            </div>

            {/* MIDDLE: Intelligence Core & Telemetry */}
            <div className="flex-1 flex flex-col gap-6">
                {/* Telemetry Bar */}
                <div className="bento-card h-[100px] flex items-center px-8 gap-8 shadow-sm">
                    <div className="flex-1 flex items-center gap-4">
                        <div className="p-3 bg-[var(--color-brand-accent)]/10 rounded-lg">
                            <Cpu className="w-5 h-5 text-[var(--color-brand-accent)]" />
                        </div>
                        <div className="flex-1">
                            <div className="flex justify-between text-xs font-semibold mb-2 text-[#94a3b8]">
                                <span>CORE LOAD</span>
                                <span className="text-[var(--color-brand-accent)]">{telemetry?.cpu.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 bg-[#1f1f2e] rounded-full overflow-hidden">
                                <motion.div animate={{ width: `${telemetry?.cpu || 0}%` }} transition={{ duration: 0.5 }} className="h-full bg-[var(--color-brand-accent)] shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
                            </div>
                        </div>
                    </div>

                    <div className="w-[1px] h-12 bg-[var(--color-border-subtle)]" />

                    <div className="flex-1 flex items-center gap-4">
                        <div className="p-3 bg-[var(--color-brand-secondary)]/10 rounded-lg">
                            <Zap className="w-5 h-5 text-[var(--color-brand-secondary)]" />
                        </div>
                        <div className="flex-1">
                            <div className="flex justify-between text-xs font-semibold mb-2 text-[#94a3b8]">
                                <span>MEMORY</span>
                                <span className="text-[var(--color-brand-secondary)]">{telemetry?.memPct.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 bg-[#1f1f2e] rounded-full overflow-hidden">
                                <motion.div animate={{ width: `${telemetry?.memPct || 0}%` }} transition={{ duration: 0.5 }} className="h-full bg-[var(--color-brand-secondary)] shadow-[0_0_8px_rgba(168,85,247,0.6)]" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Live Logs */}
                <div className="flex-1 bento-card flex flex-col p-6 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] pb-4 mb-4">
                        <ActivityIcon className="text-[#94a3b8] w-4 h-4" />
                        <h2 className="text-xs font-semibold tracking-wider text-[#94a3b8] uppercase">Live Execution Feed</h2>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar font-data text-xs">
                        {logs.length === 0 && <span className="text-[#64748b]">Awaiting agent logs...</span>}
                        {logs.map((log, i) => (
                            <div key={i} className="py-1.5 border-b border-[rgba(255,255,255,0.02)] flex gap-4 hover:bg-[rgba(255,255,255,0.02)] transition-colors px-2 rounded">
                                <span className="text-[var(--color-text-tertiary)] w-24 shrink-0">[{new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                                <span className={`text-[13px] ${log.includes('ERROR') ? 'text-red-400' : 'text-[#e2e8f0]'}`}>{log}</span>
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </div>
            </div>

            {/* RIGHT: Data & Directives */}
            <div className="w-[360px] flex flex-col gap-6">
                {/* VAULT PANEL */}
                <div className="flex-1 bento-card flex flex-col p-6 shadow-sm">
                    <h2 className="text-xs font-semibold tracking-wider text-[#f8fafc] uppercase flex items-center gap-2 mb-4">
                        <Database className="w-4 h-4 text-[var(--color-brand-accent)]" /> Nexus Vault
                    </h2>
                    <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-1">
                        {vaultFacts.length === 0 && <p className="text-xs text-center text-[#64748b] mt-10">Memory Core Empty</p>}
                        {vaultFacts.map((f, i) => (
                            <div key={i} className="p-3 rounded-lg border border-[var(--color-border-subtle)] bg-[#0a0a0f] space-y-2 group hover:border-[var(--color-border-hover)] transition-colors">
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-semibold text-[var(--color-brand-primary)] uppercase tracking-wider">{f.entity}</span>
                                    <span className="text-[10px] text-[#64748b] font-data">{f.timestamp.split(' ')[1]}</span>
                                </div>
                                <p className="text-xs text-[#cbd5e1] leading-relaxed capitalize">{f.fact}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* DIRECTIVES PANEL */}
                <div className="h-[320px] bento-card flex flex-col p-6 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xs font-semibold tracking-wider text-[#f8fafc] uppercase flex items-center gap-2">
                            <Target className="w-4 h-4 text-[var(--color-brand-secondary)]" /> Directives
                        </h2>
                        <button onClick={() => setShowGoalForm(!showGoalForm)} className="w-6 h-6 rounded-md bg-[#1f1f2e] border border-[var(--color-border-subtle)] flex items-center justify-center hover:bg-[var(--color-brand-primary)] hover:border-[var(--color-brand-primary)] transition-all text-[#94a3b8] hover:text-white shadow-sm">
                            {showGoalForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                        </button>
                    </div>

                    <AnimatePresence>
                        {showGoalForm && (
                            <motion.form initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} onSubmit={handleCreateGoal} className="flex flex-col gap-2 mb-4 overflow-hidden">
                                <input type="text" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder="Enter new directive..." className="bg-[#0a0a0f] border border-[var(--color-border-subtle)] p-2.5 rounded-lg text-xs text-white focus:outline-none focus:border-[var(--color-brand-primary)]" />
                                <button className="bg-[var(--color-brand-primary)] text-white py-2 rounded-lg text-xs font-semibold hover:bg-[var(--color-brand-primary)]/90 transition-colors shadow-sm">Engage</button>
                            </motion.form>
                        )}
                    </AnimatePresence>

                    <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-1">
                        {goals.length === 0 && <p className="text-xs text-center text-[#64748b] mt-10">No active directives</p>}
                        {goals.map(goal => (
                            <div key={goal.id} className="p-3 rounded-lg border border-[var(--color-border-subtle)] bg-[#0a0a0f]">
                                <div className="flex justify-between mb-2">
                                    <span className="text-xs font-semibold text-[#f8fafc]">{goal.title}</span>
                                    <span className="text-[9px] px-2 py-0.5 rounded-md bg-[#1f1f2e] border border-[var(--color-border-subtle)] text-[#94a3b8] uppercase font-semibold">{goal.status}</span>
                                </div>
                                <div className="h-1.5 bg-[#1f1f2e] rounded-full overflow-hidden">
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${goal.progress}%` }} className="h-full bg-[var(--color-brand-primary)]" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
