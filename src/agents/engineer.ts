import { orchestrator } from "../core/orchestrator";
import { taskManager } from "../core/task-manager";
import { type RoleDefinition } from "../core/types";
import { extractor } from "../core/extractor";
import { awareness } from "../core/awareness";

export class NexusEngineer {
    private defaultRole: RoleDefinition = {
        id: 'nexus-engineer-prime',
        name: 'Nexus Engineer',
        description: 'The primary autonomous engineering agent of Nexus Claire. Can read, write, and execute code to build features.',
        responsibilities: [
            'Architecting and implementing new features',
            'Refactoring and optimizing existing code',
            'Debugging complex system issues',
            'Running shell commands to install packages and test code'
        ],
        autonomous_actions: ['fs.write', 'fs.read', 'terminal.run', 'fs.list'],
        approval_required: ['fs.delete'],
        kpis: [],
        communication_style: { tone: 'professional', verbosity: 'detailed', formality: 'formal' },
        heartbeat_instructions: 'Execute the engineering task with high precision and safe authority gating.',
        sub_roles: [],
        tools: ['terminal.run', 'fs.read', 'fs.write', 'fs.list', 'delegate_task', 'nexus.develop_tool'],
        authority_level: 9
    };

    /**
     * Dispatches an engineering task to the autonomous engine.
     * This is the entry point for [EXEC] tags.
     */
    public executeTask(taskDescription: string, context?: string): string {
        console.log(`[ENGINEER] Dispatching autonomous task: ${taskDescription.slice(0, 50)}...`);

        const agent = orchestrator.spawnAgent(this.defaultRole);

        return taskManager.launch({
            agent,
            task: taskDescription,
            context,
            onProgress: (progress) => {
                console.log(`[ENGINEER-PULSE] ${progress}`);
            },
            onComplete: async (task) => {
                console.log(`[ENGINEER] Task ${task.id} finished with status: ${task.status}`);
                const resultResponse = task.result?.response || "No response received.";
                await extractor.extractAndStore(resultResponse, taskDescription);
                awareness.reportEvent({
                    type: task.result?.success ? 'success' : 'struggle',
                    source: 'NexusEngineer',
                    message: resultResponse,
                    timestamp: Date.now()
                });
                orchestrator.terminateAgent(agent.id);
            }
        });
    }

    /**
     * Legacy wrapper for backward compatibility with brain.ts
     */
    public async buildAndRunTool(goalDescription: string): Promise<string> {
        return this.executeTask(goalDescription);
    }
}

export const engineer = new NexusEngineer();
