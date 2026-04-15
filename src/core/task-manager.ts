import { runNexusAgent, type RunAgentResult } from "./agent-runner";
import { AgentInstance } from "./orchestrator";
import { Database } from "bun:sqlite";

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
    private db: Database;

    constructor(dbPath: string = "tasks.db") {
        this.db = new Database(dbPath);
        this.initDb();
        this.loadTasks();
    }

    private initDb() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                agentId TEXT,
                agentName TEXT,
                task TEXT,
                status TEXT,
                startedAt INTEGER,
                completedAt INTEGER,
                result TEXT
            )
        `);
    }

    private loadTasks() {
        const rows = this.db.query("SELECT * FROM tasks WHERE status = 'running'").all() as any[];
        for (const row of rows) {
            this.tasks.set(row.id, {
                ...row,
                result: row.result ? JSON.parse(row.result) : null
            });
        }
        console.log(`[TASK-MANAGER] Recovered ${this.tasks.size} active tasks from disk.`);
    }

    private saveTask(task: NexusTask) {
        this.db.run(
            "INSERT OR REPLACE INTO tasks (id, agentId, agentName, task, status, startedAt, completedAt, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [task.id, task.agentId, task.agentName, task.task, task.status, task.startedAt, task.completedAt, task.result ? JSON.stringify(task.result) : null]
        );
    }

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
        this.saveTask(nexusTask);

        console.log(`[TASK-MANAGER] Launched task ${taskId} for agent ${agent.agent.role.name}`);

        runNexusAgent({
            agent,
            task,
            context,
            onProgress
        }).then((result) => {
            nexusTask.status = 'completed';
            nexusTask.completedAt = Date.now();
            nexusTask.result = result;
            this.saveTask(nexusTask);
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
            this.saveTask(nexusTask);
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
                this.db.run("DELETE FROM tasks WHERE id = ?", [id]);
            }
        }
    }
}

export const taskManager = new NexusTaskManager();
