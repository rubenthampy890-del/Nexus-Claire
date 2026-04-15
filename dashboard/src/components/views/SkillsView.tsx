import React from 'react';
import { motion } from 'framer-motion';
import { Zap, Terminal, Globe, Code, Box } from 'lucide-react';

interface ToolDefinition {
    name: string;
    description: string;
    category: string;
    parameters: any;
}

interface SkillsViewProps {
    tools: ToolDefinition[];
}

export const SkillsView: React.FC<SkillsViewProps> = ({ tools }) => {
    // Group tools by broad category for nicer UI
    const getIcon = (category: string) => {
        switch (category.toLowerCase()) {
            case 'terminal': return <Terminal className="w-4 h-4" />;
            case 'browser': case 'intelligence': return <Globe className="w-4 h-4" />;
            case 'file-ops': return <Code className="w-4 h-4" />;
            default: return <Box className="w-4 h-4" />;
        }
    };

    return (
        <div className="flex-1 h-full p-8 flex flex-col font-sans overflow-y-auto custom-scrollbar">
            <div className="mb-8">
                <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
                    <Zap className="w-6 h-6 text-[var(--color-brand-secondary)]" />
                    Autonomous Skills Matrix
                </h1>
                <p className="text-[#94a3b8] mt-2 text-sm max-w-2xl">
                    Live registry of tools and capabilities that Nexus has natively built, imported, or discovered. The system can hot-load these capabilities instantly.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {tools.length === 0 && (
                    <div className="col-span-full py-10 flex flex-col items-center justify-center text-[#64748b]">
                        <Zap className="w-10 h-10 opacity-20 mb-4 animate-pulse" />
                        <p>No tools received from main registry. Awaiting connection...</p>
                    </div>
                )}
                {tools.map((tool, idx) => (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="bento-card p-5 shadow-sm group hover:border-[var(--color-brand-primary)] hover:shadow-lg transition-all"
                    >
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-md bg-[#1f1f2e] border border-[var(--color-border-subtle)] text-[var(--color-brand-primary)] group-hover:bg-[var(--color-brand-primary)]/10">
                                    {getIcon(tool.category || 'general')}
                                </div>
                                <h3 className="font-semibold text-white tracking-wide text-sm">{tool.name}</h3>
                            </div>
                            <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#13131a] border border-[#333] text-[#94a3b8] uppercase font-bold tracking-wider">
                                {tool.category || 'General'}
                            </span>
                        </div>
                        <p className="text-xs text-[#cbd5e1] leading-relaxed mb-4 line-clamp-3">
                            {tool.description}
                        </p>

                        {tool.parameters && Object.keys(tool.parameters).length > 0 && (
                            <div className="pt-3 border-t border-[rgba(255,255,255,0.05)]">
                                <div className="flex gap-2 flex-wrap text-[#64748b] text-[10px] font-data">
                                    {Object.keys(tool.parameters).map((paramName) => (
                                        <span key={paramName} className="bg-[#13131a] px-2 py-1 rounded">
                                            {paramName} ({tool.parameters[paramName].type})
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </motion.div>
                ))}
            </div>
        </div>
    );
};
