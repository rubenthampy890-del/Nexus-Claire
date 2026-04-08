/**
 * Nexus Claire: Goal Manager
 * 
 * Tracks active objectives and allows the AI to pursue them autonomously.
 * Goals persist in memory and are checked against awareness events.
 */

export interface Goal {
    id: string;
    title: string;
    description: string;
    status: 'active' | 'completed' | 'paused';
    progress: number; // 0-100
    createdAt: number;
    updatedAt: number;
    steps: GoalStep[];
}

export interface GoalStep {
    description: string;
    completed: boolean;
}

export class GoalManager {
    private goals: Map<string, Goal> = new Map();
    private nextId = 1;

    constructor() {
        console.log('[GOALS] Goal Manager initialized.');
    }

    create(title: string, description: string, steps: string[] = []): Goal {
        const id = `goal_${this.nextId++}`;
        const goal: Goal = {
            id,
            title,
            description,
            status: 'active',
            progress: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            steps: steps.map(s => ({ description: s, completed: false })),
        };
        this.goals.set(id, goal);
        console.log(`[GOALS] Created: "${title}" (${id})`);
        return goal;
    }

    updateProgress(id: string, progress: number, stepIndex?: number): Goal | undefined {
        const goal = this.goals.get(id);
        if (!goal) return undefined;

        goal.progress = Math.min(100, Math.max(0, progress));
        goal.updatedAt = Date.now();

        if (stepIndex !== undefined && goal.steps[stepIndex]) {
            goal.steps[stepIndex].completed = true;
        }

        if (goal.progress >= 100) {
            goal.status = 'completed';
        }

        console.log(`[GOALS] Updated "${goal.title}": ${goal.progress}%`);
        return goal;
    }

    getActive(): Goal[] {
        return Array.from(this.goals.values()).filter(g => g.status === 'active');
    }

    getAll(): Goal[] {
        return Array.from(this.goals.values());
    }

    pause(id: string): void {
        const goal = this.goals.get(id);
        if (goal) {
            goal.status = 'paused';
            goal.updatedAt = Date.now();
        }
    }

    resume(id: string): void {
        const goal = this.goals.get(id);
        if (goal && goal.status === 'paused') {
            goal.status = 'active';
            goal.updatedAt = Date.now();
        }
    }

    /**
     * Get a summary string for the LLM system prompt.
     */
    getContextForLLM(): string {
        const active = this.getActive();
        if (active.length === 0) return 'No active goals.';
        return active.map(g =>
            `• [${g.progress}%] ${g.title}: ${g.description}` +
            (g.steps.length > 0 ? '\n  Steps: ' + g.steps.map(s => `${s.completed ? '✅' : '⬜'} ${s.description}`).join(', ') : '')
        ).join('\n');
    }
}
