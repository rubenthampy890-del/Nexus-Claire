import React from 'react';
import { Target, Plus, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Goal { id: string; title: string; description: string; status: string; progress: number; }

interface DirectivesViewProps {
    goals: Goal[];
    goalTitle: string;
    setGoalTitle: (val: string) => void;
    showGoalForm: boolean;
    setShowGoalForm: (val: boolean) => void;
    handleCreateGoal: (e: React.FormEvent) => void;
}

export const DirectivesView: React.FC<DirectivesViewProps> = ({ goals, goalTitle, setGoalTitle, showGoalForm, setShowGoalForm, handleCreateGoal }) => {
    return (
        <div className="flex-1 h-full p-8 view-container overflow-y-auto custom-scrollbar">
            <div className="max-w-5xl mx-auto">
                <div className="flex justify-between items-center mb-10">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-3">
                            <Target className="w-6 h-6 text-[#10b981]" />
                            Directives
                        </h1>
                        <p className="text-[var(--color-text-secondary)] mt-2 text-sm">Manage agent goals and track autonomous task progress.</p>
                    </div>
                    <button
                        onClick={() => setShowGoalForm(!showGoalForm)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-gray-200 transition-colors"
                    >
                        {showGoalForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        {showGoalForm ? 'Cancel' : 'New Directive'}
                    </button>
                </div>

                <AnimatePresence>
                    {showGoalForm && (
                        <motion.form
                            initial={{ height: 0, opacity: 0, marginBottom: 0 }}
                            animate={{ height: 'auto', opacity: 1, marginBottom: 32 }}
                            exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                            onSubmit={handleCreateGoal}
                            className="overflow-hidden"
                        >
                            <div className="hifi-card p-6 flex gap-4">
                                <input
                                    type="text"
                                    value={goalTitle}
                                    onChange={(e) => setGoalTitle(e.target.value)}
                                    placeholder="What should the agent accomplish?"
                                    className="flex-1 glass-input p-4 rounded-lg text-sm text-white"
                                    autoFocus
                                />
                                <button type="submit" className="px-8 bg-[var(--color-brand-accent)] text-white font-semibold rounded-lg hover:bg-indigo-600 transition-colors">
                                    Assign
                                </button>
                            </div>
                        </motion.form>
                    )}
                </AnimatePresence>

                <div className="space-y-4">
                    {goals.length === 0 && !showGoalForm && (
                        <div className="hifi-card p-12 text-center border-dashed">
                            <p className="text-sm text-[var(--color-text-tertiary)]">No active directives. Assign a new task to begin.</p>
                        </div>
                    )}
                    {goals.map(goal => (
                        <div key={goal.id} className="hifi-card p-6 flex flex-col gap-4 group">
                            <div className="flex justify-between items-center">
                                <h3 className="text-lg font-medium text-white">{goal.title}</h3>
                                <span className="text-xs px-3 py-1 rounded-md bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] uppercase font-semibold">
                                    {goal.status}
                                </span>
                            </div>
                            <div className="h-2 w-full bg-[var(--color-bg-base)] rounded-full overflow-hidden border border-[var(--color-border-subtle)]">
                                <motion.div initial={{ width: 0 }} animate={{ width: `${goal.progress}%` }} className="h-full bg-[var(--color-brand-accent)] relative">
                                    <div className="absolute top-0 right-0 bottom-0 left-0 bg-white/20" style={{ backgroundImage: 'linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent)', backgroundSize: '1rem 1rem' }} />
                                </motion.div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
