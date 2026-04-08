import React from 'react';
import { Database } from 'lucide-react';

interface VaultFact { id: number; entity: string; fact: string; timestamp: string; }

export const VaultView: React.FC<{ vaultFacts: VaultFact[] }> = ({ vaultFacts }) => {
    if (!Array.isArray(vaultFacts)) {
        return (
            <div className="flex-1 h-full p-8 flex items-center justify-center text-[var(--color-text-tertiary)]">
                Syncing Memory Vault... (Data Reset Needed)
            </div>
        );
    }

    return (
        <div className="flex-1 h-full p-8 view-container overflow-y-auto custom-scrollbar">
            <div className="max-w-6xl mx-auto">
                <div className="mb-10">
                    <h1 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-3">
                        <Database className="w-6 h-6 text-[var(--color-brand-accent)]" />
                        Memory Vault
                    </h1>
                    <p className="text-[var(--color-text-secondary)] mt-2 text-sm">Persistent knowledge and entities collected by the agent.</p>
                </div>

                {vaultFacts.length === 0 ? (
                    <div className="hifi-card p-12 text-center flex flex-col items-center justify-center border-dashed">
                        <Database className="w-12 h-12 text-[var(--color-text-tertiary)] mb-4 opacity-50" />
                        <h3 className="text-lg font-medium text-white mb-2">Memory Core Empty</h3>
                        <p className="text-sm text-[var(--color-text-tertiary)]">The agent has not stored any permanent facts yet.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {vaultFacts.filter(f => f && typeof f === 'object').map((f, i) => (
                            <div key={i} className="hifi-card p-6 flex flex-col group">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="px-3 py-1 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-full text-xs font-semibold text-[var(--color-brand-secondary)] uppercase tracking-wider group-hover:border-[var(--color-brand-secondary)] transition-colors">
                                        {f.entity || 'Unknown'}
                                    </div>
                                    <span className="text-xs text-[var(--color-text-tertiary)] font-data">
                                        {f.timestamp ? (f.timestamp.includes(' ') ? f.timestamp.split(' ')[1] : f.timestamp) : 'recent'}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-300 leading-relaxed">{f.fact || 'Empty memory record.'}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
