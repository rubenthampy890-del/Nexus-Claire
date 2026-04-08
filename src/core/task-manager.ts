import { runNexusAgent, type RunAgentResult } from "./agent-runner";
import { AgentInstance } from "./orchestrator";

export type TaskStatus = 'running' | 'completed' | 'failed';

export type NexusTask = {
    id: string;
    agentId: string;
    agentName: string;
    task: string;
    status: TaskStatus;
    startedAt: number;
    completedAt: number | null;
    result: RunAgentResult | null;
};

export type LaunchOptions = {
    agent: AgentInstance;
    task: string;
    context?: string;
    onProgress?: (progress: string) => void;
    onComplete?: (task: NexusTask) => void;
};

export class NexusTaskManager {
    private tasks = new Map<string, NexusTask>();

    public launch(opts: LaunchOptions): string {
        const { agent, task, context, onProgress, onComplete } = opts;
        const taskId = crypto.randomUUID();

        const nexusTask: NexusTask = {
            id: taskId,
            agentId: agent.id,
            agentName: agent.agent.role.name,
            task,
            status: 'running',
            startedAt: Date.now(),
            completedAt: null,
            result: null,
        };

        this.tasks.set(taskId, nexusTask);

        console.log(`[TASK-MANAGER] Launched task ${taskId} for agent ${agent.agent.role.name}`);

        // Run in background
        runNexusAgent({
            agent,
            task,
            context,
            onProgress
        }).then((result) => {
            nexusTask.status = 'completed';
            nexusTask.completedAt = Date.now();
            nexusTask.result = result;
            console.log(`[TASK-MANAGER] Task ${taskId} completed.`);
            onComplete?.(nexusTask);
        }).catch((err) => {
            nexusTask.status = 'failed';
            nexusTask.completedAt = Date.now();
            nexusTask.result = {
                success: false,
                response: `Task failed: ${err instanceof Error ? err.message : String(err)}`,
                toolsUsed: []
            };
            console.error(`[TASK-MANAGER] Task ${taskId} failed:`, err);
            onComplete?.(nexusTask);
        });

        return taskId;
    }

    public getTask(id: string): NexusTask | undefined {
        return this.tasks.get(id);
    }

    public listTasks(): NexusTask[] {
        return Array.from(this.tasks.values());
    }

    public cleanup(maxAgeMs = 15 * 60_000): void {
        const now = Date.now();
        for (const [id, task] of this.tasks) {
            if (task.status !== 'running' && task.completedAt && now - task.completedAt > maxAgeMs) {
                this.tasks.delete(id);
            }
        }
    }
}

export const taskManager = new NexusTaskManager();
