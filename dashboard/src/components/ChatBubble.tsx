import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { motion } from 'framer-motion';

interface ChatBubbleProps {
    role: string;
    text: string;
    variant?: 'terminal' | 'dashboard';
    isStreaming?: boolean;
    imageBase64?: string;
}

/**
 * ChatBubble: Renders chat messages with:
 * - Markdown-like code block detection (```...```)
 * - One-click clipboard copy for code blocks
 * - Inline code highlighting (`...`)
 * - Streaming cursor indicator
 * - Stable rendering to prevent ghost text
 */
export const ChatBubble: React.FC<ChatBubbleProps> = ({ role, text, variant = 'terminal', isStreaming, imageBase64 }) => {
    return (
        <div className={`flex flex-col max-w-[90%] ${role === 'USER' ? 'self-end items-end' : 'self-start items-start'}`}>
            <span className={`text-[10px] uppercase tracking-wider mb-1 font-semibold ${role === 'USER' ? 'text-[var(--color-text-tertiary)]' : variant === 'dashboard' ? 'text-[var(--color-brand-primary)]' : 'text-[#818cf8]'}`}>
                {role === 'USER' ? 'Operator' : 'Nexus'}
            </span>
            <div className={`p-4 text-sm leading-relaxed rounded-xl relative ${role === 'USER'
                ? 'bg-[#1f1f2e] border border-[var(--color-border-subtle)] rounded-tr-none text-[#f8fafc]'
                : variant === 'dashboard'
                    ? 'bg-[var(--color-brand-primary)]/10 border border-[var(--color-brand-primary)]/20 rounded-tl-none text-[#f8fafc]'
                    : 'bg-[#1e1b4b] border border-[#3730a3] rounded-tl-sm text-gray-100'
                }`}>
                {imageBase64 && (
                    <img src={`data:image/png;base64,${imageBase64}`} alt="Shared" className="max-h-48 rounded-lg mb-3 border border-white/10 object-contain" />
                )}
                <RichText text={text} />
                {isStreaming && (
                    <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ repeat: Infinity, duration: 0.8, ease: "easeInOut" }}
                        className="inline-block w-2 h-4 bg-[var(--color-brand-primary)] ml-1 align-middle"
                    />
                )}
            </div>
        </div>
    );
};

/**
 * RichText: Parses text for code blocks and inline code, renders them with copy buttons.
 */
const RichText: React.FC<{ text: string }> = ({ text }) => {
    // Split on triple-backtick code blocks
    const parts = text.split(/(```[\s\S]*?```)/g);

    return (
        <>
            {parts.map((part, i) => {
                if (part.startsWith('```') && part.endsWith('```')) {
                    // Extract language and code
                    const inner = part.slice(3, -3);
                    const newlineIdx = inner.indexOf('\n');
                    const lang = newlineIdx > 0 ? inner.slice(0, newlineIdx).trim() : '';
                    const code = newlineIdx > 0 ? inner.slice(newlineIdx + 1) : inner;
                    return <CodeBlock key={i} code={code} language={lang} />;
                }
                // Handle inline code and plain text
                return <InlineText key={i} text={part} />;
            })}
        </>
    );
};

/**
 * CodeBlock: Fenced code block with syntax label and clipboard copy button.
 */
const CodeBlock: React.FC<{ code: string; language: string }> = ({ code, language }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback for non-HTTPS contexts
            const textarea = document.createElement('textarea');
            textarea.value = code;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="my-3 rounded-lg overflow-hidden border border-[rgba(255,255,255,0.08)] bg-[#0d0d14]">
            {/* Header bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-[rgba(255,255,255,0.03)] border-b border-[rgba(255,255,255,0.06)]">
                <span className="text-[10px] uppercase tracking-wider text-[#64748b] font-semibold">
                    {language || 'code'}
                </span>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 text-[10px] text-[#64748b] hover:text-white transition-colors cursor-pointer py-0.5 px-2 rounded hover:bg-[rgba(255,255,255,0.06)]"
                >
                    {copied ? (
                        <><Check className="w-3 h-3 text-green-400" /> Copied!</>
                    ) : (
                        <><Copy className="w-3 h-3" /> Copy</>
                    )}
                </button>
            </div>
            {/* Code content */}
            <pre className="p-4 overflow-x-auto text-xs leading-relaxed text-[#e2e8f0] font-mono whitespace-pre-wrap">
                {code}
            </pre>
        </div>
    );
};

/**
 * InlineText: Handles `inline code` within regular text.
 */
const InlineText: React.FC<{ text: string }> = ({ text }) => {
    const parts = text.split(/(`[^`]+`)/g);

    return (
        <>
            {parts.map((part, i) => {
                if (part.startsWith('`') && part.endsWith('`')) {
                    const code = part.slice(1, -1);
                    return (
                        <code key={i} className="px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] text-[#a78bfa] text-xs font-mono">
                            {code}
                        </code>
                    );
                }
                // Preserve line breaks
                return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
            })}
        </>
    );
};
