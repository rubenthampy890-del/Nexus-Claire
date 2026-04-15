import { type ServerWebSocket } from "bun";
import { NexusCLI } from "./cli-ui";

// ──────────── Types ────────────

export type SidecarInfo = {
    id: string;
    ws: ServerWebSocket<any>;
    capabilities: string[];
    os?: string;
    hostname?: string;
    connectedAt: number;
    lastHeartbeat: number;
    tasksCompleted: number;
    tasksFailed: number;
    currentTask: string | null;
    status: 'idle' | 'busy' | 'stale';
};

export type SwarmTask = {
    id: string;
    description: string;
    context?: string;
    priority: 'HIGH' | 'LOW';
    status: 'pending' | 'assigned' | 'completed' | 'failed';
    assignedTo?: string;
    result?: string;
    createdAt: number;
    assignedAt?: number;
    completedAt?: number;
};

// ──────────── SwarmManager v2.0 ────────────

/**
 * Nexus Swarm Manager v2.0 — Sidecar Orchestrator
 * 
 * Manages unlimited sidecar connections with:
 * - Rich metadata tracking (capabilities, OS, task history)
 * - Smart task routing (capability-based + load balancing)
 * - Automatic re-queue on disconnect
 * - Heartbeat-based health monitoring
 * - Real-time dashboard status broadcasting
 */
export class SwarmManager {
    private sidecars = new Map<string, SidecarInfo>();
    private taskQueue: SwarmTask[] = [];
    private activeTasks = new Map<string, { task: SwarmTask; resolve: (res: string) => void; reject: (err: any) => void }>();
    private completedTasks: SwarmTask[] = [];

    private HEARTBEAT_TIMEOUT_MS = 90000; // 90s before marking stale
    private MAX_COMPLETED_HISTORY = 100;

    // Callback for broadcasting status changes to UI
    public onStatusChange?: (status: ReturnType<SwarmManager['getStatus']>) => void;

    // ──────────── Sidecar Lifecycle ────────────

    /**
     * Register a new sidecar connection.
     */
    public registerSatellite(id: string, ws: ServerWebSocket<any>, meta?: {
        capabilities?: string[];
        os?: string;
        hostname?: string;
    }) {
        const existing = this.sidecars.get(id);
        if (existing) {
            // Re-registration (reconnect) — update WS reference
            existing.ws = ws;
            existing.lastHeartbeat = Date.now();
            existing.status = 'idle';
            NexusCLI.log(`[SWARM] Sidecar "${id}" reconnected.`, "INFO");
        } else {
            this.sidecars.set(id, {
                id,
                ws,
                capabilities: meta?.capabilities || ['code', 'search', 'analysis'],
                os: meta?.os,
                hostname: meta?.hostname,
                connectedAt: Date.now(),
                lastHeartbeat: Date.now(),
                tasksCompleted: 0,
                tasksFailed: 0,
                currentTask: null,
                status: 'idle'
            });
            NexusCLI.log(`[SWARM] Sidecar "${id}" joined the collective. Total: ${this.sidecars.size}`, "INFO");
        }

        this.broadcastStatus();
        this.processQueue();
    }

    /**
     * Handle sidecar heartbeat — keeps the connection alive.
     */
    public heartbeat(id: string, meta?: { uptime?: number }) {
        const sidecar = this.sidecars.get(id);
        if (sidecar) {
            sidecar.lastHeartbeat = Date.now();
            if (sidecar.status === 'stale') {
                sidecar.status = sidecar.currentTask ? 'busy' : 'idle';
                NexusCLI.log(`[SWARM] Sidecar "${id}" recovered from stale state.`, "INFO");
            }
        }
    }

    /**
     * Remove a sidecar and re-queue its active task.
     */
    public removeSatellite(id: string) {
        const sidecar = this.sidecars.get(id);
        if (!sidecar) return;

        // Re-queue any task that was assigned to this sidecar
        if (sidecar.currentTask) {
            const active = this.activeTasks.get(sidecar.currentTask);
            if (active && active.task.status === 'assigned') {
                active.task.status = 'pending';
                active.task.assignedTo = undefined;
                this.taskQueue.unshift(active.task); // Re-queue at front (priority)
                NexusCLI.log(`[SWARM] Re-queued task ${sidecar.currentTask} from disconnected sidecar "${id}".`, "WARN");
            }
        }

        this.sidecars.delete(id);
        NexusCLI.log(`[SWARM] Sidecar "${id}" disconnected. Remaining: ${this.sidecars.size}`, "WARN");
        this.broadcastStatus();
        this.processQueue(); // Try to assign re-queued tasks
    }

    // ──────────── Task Management ────────────

    /**
     * Queue a task for distributed execution.
     * Returns the task ID.
     */
    public delegate(description: string, context?: string, priority: 'HIGH' | 'LOW' = 'LOW'): string {
        const id = crypto.randomUUID();
        const task: SwarmTask = {
            id,
            description,
            context,
            priority,
            status: 'pending',
            createdAt: Date.now()
        };

        // HIGH priority goes to front of queue
        if (priority === 'HIGH') {
            this.taskQueue.unshift(task);
        } else {
            this.taskQueue.push(task);
        }

        NexusCLI.log(`[SWARM] Task queued [${priority}]: "${description.slice(0, 50)}..."`, "INFO");
        this.processQueue();
        return id;
    }

    /**
     * Dispatch a task directly to a specific sidecar.
     */
    public dispatchDirect(sidecarId: string, taskId: string, directive: string, context?: string): boolean {
        const sidecar = this.sidecars.get(sidecarId);
        if (!sidecar || sidecar.status === 'stale') return false;

        try {
            sidecar.ws.send(JSON.stringify({
                type: 'SATELLITE_TASK',
                payload: { taskId, directive, context }
            }));
            sidecar.currentTask = taskId;
            sidecar.status = 'busy';
            this.broadcastStatus();
            return true;
        } catch {
            this.removeSatellite(sidecarId);
            return false;
        }
    }

    /**
     * Wait for a task result with timeout.
     */
    public async waitForTask(taskId: string, timeoutMs: number = 300000): Promise<string> {
        return new Promise((resolve, reject) => {
            const taskRecord = this.taskQueue.find(t => t.id === taskId);
            this.activeTasks.set(taskId, {
                task: taskRecord || { id: taskId, description: '', priority: 'LOW', status: 'pending', createdAt: Date.now() },
                resolve,
                reject
            });

            setTimeout(() => {
                if (this.activeTasks.has(taskId)) {
                    this.activeTasks.delete(taskId);
                    reject(new Error(`Swarm task ${taskId} timed out.`));
                }
            }, timeoutMs);
        });
    }

    /**
     * Handle a task result from a sidecar.
     */
    public handleResult(taskId: string, result: string, success: boolean) {
        NexusCLI.log(`[SWARM] Task ${taskId} ${success ? 'completed' : 'failed'}.`, success ? "INFO" : "ERROR");

        // Find which sidecar completed this
        for (const [, sidecar] of this.sidecars) {
            if (sidecar.currentTask === taskId) {
                sidecar.currentTask = null;
                sidecar.status = 'idle';
                if (success) sidecar.tasksCompleted++;
                else sidecar.tasksFailed++;
                break;
            }
        }

        const active = this.activeTasks.get(taskId);
        if (active) {
            active.task.status = success ? 'completed' : 'failed';
            active.task.result = result;
            active.task.completedAt = Date.now();

            // Archive to completed history
            this.completedTasks.push(active.task);
            if (this.completedTasks.length > this.MAX_COMPLETED_HISTORY) {
                this.completedTasks = this.completedTasks.slice(-this.MAX_COMPLETED_HISTORY);
            }

            this.activeTasks.delete(taskId);

            if (success) active.resolve(result);
            else active.reject(new Error(result));
        }

        this.broadcastStatus();
        this.processQueue(); // Freed-up sidecar can take next task
    }

    // ──────────── Internal ────────────

    /**
     * Process the task queue — assign tasks to idle sidecars.
     * Uses load-balancing: prefer sidecars with fewer completed tasks (spread the load).
     */
    private processQueue() {
        if (this.taskQueue.length === 0 || this.sidecars.size === 0) return;

        // Get idle sidecars sorted by least tasks completed (load balance)
        const idleSidecars = Array.from(this.sidecars.values())
            .filter(s => s.status === 'idle')
            .sort((a, b) => a.tasksCompleted - b.tasksCompleted);

        let assigned = 0;
        while (this.taskQueue.length > 0 && idleSidecars.length > assigned) {
            const task = this.taskQueue.shift()!;
            const sidecar = idleSidecars[assigned]!;

            task.status = 'assigned';
            task.assignedTo = sidecar.id;
            task.assignedAt = Date.now();
            sidecar.currentTask = task.id;
            sidecar.status = 'busy';

            try {
                sidecar.ws.send(JSON.stringify({
                    type: 'SATELLITE_TASK',
                    payload: {
                        taskId: task.id,
                        directive: task.description,
                        context: task.context
                    }
                }));
                NexusCLI.log(`[SWARM] Task ${task.id} → Sidecar "${sidecar.id}".`, "INFO");
                assigned++;
            } catch {
                // Send failed — re-queue and remove sidecar
                task.status = 'pending';
                task.assignedTo = undefined;
                this.taskQueue.unshift(task);
                this.removeSatellite(sidecar.id);
            }
        }
    }

    // ──────────── Health Monitoring ────────────

    /**
     * Start the heartbeat monitor — prunes stale sidecars every 60s.
     */
    public startHeartbeatCycle() {
        setInterval(() => {
            const now = Date.now();
            this.sidecars.forEach((sidecar, id) => {
                // Check for stale connections
                if (now - sidecar.lastHeartbeat > this.HEARTBEAT_TIMEOUT_MS) {
                    if (sidecar.status !== 'stale') {
                        sidecar.status = 'stale';
                        NexusCLI.log(`[SWARM] Sidecar "${id}" is stale (no heartbeat in ${Math.round((now - sidecar.lastHeartbeat) / 1000)}s).`, "WARN");
                    }

                    // If stale for 3x the timeout, force-remove
                    if (now - sidecar.lastHeartbeat > this.HEARTBEAT_TIMEOUT_MS * 3) {
                        this.removeSatellite(id);
                        return;
                    }
                }

                // Ping active sidecars
                try {
                    sidecar.ws.send(JSON.stringify({ type: 'PING', timestamp: now }));
                } catch {
                    this.removeSatellite(id);
                }
            });
        }, 60000);
    }

    // ──────────── Status & Queries ────────────

    /**
     * Get the WebSocket of the first available (idle) sidecar.
     */
    public getFirstSatelliteWs(): [string, ServerWebSocket<any>] | null {
        for (const [id, sidecar] of this.sidecars) {
            if (sidecar.status === 'idle') {
                return [id, sidecar.ws];
            }
        }
        return null;
    }

    /**
     * Get comprehensive swarm status for dashboard display.
     */
    public getStatus() {
        const sidecars = Array.from(this.sidecars.values()).map(s => ({
            id: s.id,
            capabilities: s.capabilities,
            os: s.os,
            hostname: s.hostname,
            status: s.status,
            connectedAt: s.connectedAt,
            lastHeartbeat: s.lastHeartbeat,
            tasksCompleted: s.tasksCompleted,
            tasksFailed: s.tasksFailed,
            currentTask: s.currentTask,
            uptimeMs: Date.now() - s.connectedAt
        }));

        return {
            activeSidecars: this.sidecars.size,
            idleSidecars: sidecars.filter(s => s.status === 'idle').length,
            busySidecars: sidecars.filter(s => s.status === 'busy').length,
            staleSidecars: sidecars.filter(s => s.status === 'stale').length,
            queuedTasks: this.taskQueue.length,
            activeTasks: this.activeTasks.size,
            completedTasks: this.completedTasks.length,
            sidecars,
            satelliteIds: sidecars.map(s => s.id), // backward compat
            recentCompleted: this.completedTasks.slice(-10).map(t => ({
                id: t.id,
                description: t.description.slice(0, 80),
                status: t.status,
                assignedTo: t.assignedTo,
                durationMs: t.completedAt && t.assignedAt ? t.completedAt - t.assignedAt : null
            }))
        };
    }

    private broadcastStatus() {
        if (this.onStatusChange) {
            this.onStatusChange(this.getStatus());
        }
    }
}

export const swarmManager = new SwarmManager();
