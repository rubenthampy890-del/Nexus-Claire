import React, { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Activity as ActivityIcon, Paperclip, X, Image as ImageIcon } from 'lucide-react';
import { ChatBubble } from '../ChatBubble';

interface ChatMessage { role: string; text: string; id: string; imageBase64?: string; }

interface TerminalViewProps {
    logs: string[];
    chatMessages: ChatMessage[];
    inputValue: string;
    setInputValue: (val: string) => void;
    onSendMessage: (e: React.FormEvent, imageData?: { base64: string; mimeType: string }) => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ logs, chatMessages, inputValue, setInputValue, onSendMessage }) => {
    const logsEndRef = useRef<HTMLDivElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [pendingImage, setPendingImage] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);

    useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(',')[1] || '';
            setPendingImage({ base64, mimeType: file.type, preview: dataUrl });
        };
        reader.readAsDataURL(file);
        // Reset input so same file can be re-selected
        e.target.value = '';
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim() && !pendingImage) return;
        onSendMessage(e, pendingImage ? { base64: pendingImage.base64, mimeType: pendingImage.mimeType } : undefined);
        setPendingImage(null);
    };

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
                            <ChatBubble role={msg.role} text={msg.text} variant="terminal" isStreaming={(msg as any).isStreaming} imageBase64={(msg as any).imageBase64} />
                        </motion.div>
                    ))}
                    <div ref={chatEndRef} />
                </div>

                {/* Image Preview */}
                {pendingImage && (
                    <div className="mb-3 relative inline-block">
                        <img src={pendingImage.preview} alt="Attached" className="h-20 rounded-lg border border-white/10 object-cover" />
                        <button onClick={() => setPendingImage(null)} className="absolute -top-2 -right-2 bg-red-500 rounded-full p-0.5 cursor-pointer hover:bg-red-400 transition-colors">
                            <X className="w-3 h-3 text-white" />
                        </button>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
                    <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleFileSelect} />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 rounded-xl border border-white/10 text-[var(--color-text-tertiary)] hover:text-white hover:border-white/30 transition-all cursor-pointer shrink-0">
                        {pendingImage ? <ImageIcon className="w-4 h-4 text-[#6366f1]" /> : <Paperclip className="w-4 h-4" />}
                    </button>
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={pendingImage ? "Describe or ask about this image..." : "Send a directive..."}
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
