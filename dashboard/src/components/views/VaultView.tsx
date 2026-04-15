import { Database, Trash2, Edit3 } from 'lucide-react';

interface VaultFact { id: number; entity: string; fact: string; timestamp: string; }

interface VaultViewProps {
    vaultFacts: VaultFact[];
    onDelete?: (id: number) => void;
    onUpdate?: (id: number, fact: string) => void;
}

export const VaultView: React.FC<VaultViewProps> = ({ vaultFacts, onDelete, onUpdate }) => {
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
                <div className="mb-10 flex justify-between items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-3">
                            <Database className="w-6 h-6 text-[var(--color-brand-accent)]" />
                            Memory Vault
                        </h1>
                        <p className="text-[var(--color-text-secondary)] mt-2 text-sm">Persistent knowledge and entities collected by the agent.</p>
                    </div>
                    <div className="text-[10px] font-bold text-[var(--color-text-tertiary)] uppercase tracking-widest border border-white/5 px-3 py-1.5 rounded-md">
                        RECORDS: {vaultFacts.length}
                    </div>
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
                            <div key={i} className="hifi-card p-6 flex flex-col group relative">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="px-3 py-1 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-full text-xs font-semibold text-[var(--color-brand-secondary)] uppercase tracking-wider group-hover:border-[var(--color-brand-secondary)] transition-colors">
                                        {f.entity || 'Unknown'}
                                    </div>
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => onUpdate?.(f.id, f.fact)}
                                            className="p-1.5 rounded-md bg-white/5 hover:bg-[var(--color-brand-primary)]/20 text-[var(--color-text-tertiary)] hover:text-white transition-all"
                                        >
                                            <Edit3 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={() => onDelete?.(f.id)}
                                            className="p-1.5 rounded-md bg-white/5 hover:bg-red-500/20 text-[var(--color-text-tertiary)] hover:text-red-400 transition-all"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <p className="text-sm text-gray-300 leading-relaxed">{f.fact || 'Empty memory record.'}</p>
                                <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center">
                                    <span className="text-[10px] text-[var(--color-text-tertiary)] font-data uppercase">Entity Ref</span>
                                    <span className="text-[10px] text-[var(--color-text-tertiary)] font-data">
                                        {f.timestamp ? (f.timestamp.includes(' ') ? f.timestamp.split(' ')[1] : f.timestamp) : 'recent'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
