import React, { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, Activity as ActivityIcon } from 'lucide-react';
import { ChatBubble } from '../ChatBubble';

interface ChatMessage { role: string; text: string; id: string; }

interface TerminalViewProps {
    logs: string[];
    chatMessages: ChatMessage[];
    inputValue: string;
    setInputValue: (val: string) => void;
    onSendMessage: (e: React.FormEvent) => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ logs, chatMessages, inputValue, setInputValue, onSendMessage }) => {
    const logsEndRef = useRef<HTMLDivElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

    return (
        <div className="flex-1 h-full p-8 flex gap-8 view-container">
            {/* LEFT: Tactical Chat */}
            <div className="w-1/2 min-w-[400px] hifi-card flex flex-col p-8">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-lg font-semibold tracking-tight text-white flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full bg-[var(--color-brand-accent)]"></span>
                        Agent Uplink
                    </h1>
                </div>

                <div className="flex-1 overflow-y-auto flex flex-col gap-6 pr-4 mb-6 custom-scrollbar">
                    {chatMessages.length === 0 && (
                        <div className="flex-1 flex items-center justify-center text-[var(--color-text-tertiary)] text-sm">
                            Terminal awaiting input...
                        </div>
                    )}
                    {chatMessages.map((msg) => (
                        <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                            <ChatBubble role={msg.role} text={msg.text} variant="terminal" />
                        </motion.div>
                    ))}
                    <div ref={chatEndRef} />
                </div>

                <form onSubmit={onSendMessage} className="relative">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="Send a directive..."
                        className="w-full glass-input rounded-xl pl-5 pr-12 py-4 text-sm text-white placeholder-[var(--color-text-tertiary)]"
                    />
                    <button type="submit" className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-white transition-colors cursor-pointer p-1">
                        <Send className="w-4 h-4" />
                    </button>
                </form>
            </div>

            {/* RIGHT: Live Execution Feed */}
            <div className="flex-1 hifi-card flex flex-col p-8 bg-[var(--color-bg-base)]">
                <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-4 mb-4">
                    <h2 className="text-sm font-medium text-[var(--color-text-secondary)] flex items-center gap-2">
                        <ActivityIcon className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                        Execution Feed
                    </h2>
                    <span className="text-xs text-[var(--color-text-tertiary)] font-data">Status: Active</span>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar font-data text-[13px] leading-relaxed">
                    {logs.length === 0 && <span className="text-[var(--color-text-tertiary)]">Awaiting agent logs...</span>}
                    {logs.map((log, i) => (
                        <div key={i} className="py-2 border-b border-[rgba(255,255,255,0.02)] flex gap-4 hover:bg-[rgba(255,255,255,0.02)] transition-colors rounded px-2">
                            <span className="text-[var(--color-text-tertiary)] shrink-0">[{new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                            <span className={`text-opacity-90 ${log.includes('ERROR') ? 'text-red-400' : 'text-gray-300'}`}>{log}</span>
                        </div>
                    ))}
                    <div ref={logsEndRef} />
                </div>
            </div>
        </div>
    );
};
