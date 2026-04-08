import { orchestrator } from "../core/orchestrator";
import { taskManager } from "../core/task-manager";
import { type RoleDefinition } from "../core/types";
import { extractor } from "../core/extractor";
import { awareness } from "../core/awareness";
import { inference } from "../core/inference";

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
    public executeTask(taskDescription: string, context?: string, retryCount: number = 0): string {
        if (retryCount > 3) {
            console.error(`[ENGINEER] Task failed after 3 retries: ${taskDescription}`);
            return "FAILED_MAX_RETRIES";
        }

        console.log(`[ENGINEER] Dispatching autonomous task: ${taskDescription.slice(0, 50)}... (Attempt ${retryCount + 1})`);

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

                if (task.status === 'completed' && task.result?.success) {
                    await extractor.extractAndStore(resultResponse, taskDescription);
                    awareness.reportEvent({
                        type: 'success',
                        source: 'NexusEngineer',
                        message: `Successfully completed: ${taskDescription}`,
                        timestamp: Date.now()
                    });
                } else {
                    console.warn(`[ENGINEER] 🔴 Task failed. Initiating Self-Healing cycle...`);
                    awareness.reportEvent({
                        type: 'struggle',
                        source: 'NexusEngineer',
                        message: `Failed task: ${taskDescription}. Response: ${resultResponse}`,
                        timestamp: Date.now()
                    });

                    // TRIGGER REPAIR: Ask Architect to analyze and generate a patch
                    const repairPrompt = `
                    An autonomous engineering task failed.
                    DIRECTIVE: ${taskDescription}
                    CONTEXT: ${context || 'None'}
                    LAST OUTPUT: ${resultResponse}
                    
                    Analyze the failure and provide exactly ONE new [EXEC: ...] directive that fixes the issue and completes the goal.`;

                    try {
                        // Use the inference service directly as the agent doesn't have a .think method
                        agent.addMessage('user', repairPrompt);
                        const repairDirective = await inference.chat(agent.getMessages());
                        const match = repairDirective.match(/\[EXEC:(.*?)\]/is);

                        if (match && match[1]) {
                            console.log(`[ENGINEER] 🔧 Repair directive generated: ${match[1].trim()}`);
                            this.executeTask(match[1].trim(), context, retryCount + 1);
                        } else {
                            console.error(`[ENGINEER] Architect failed to produce a valid repair directive. Response: ${repairDirective}`);
                        }
                    } catch (e: any) {
                        console.error(`[ENGINEER] Repair cycle failed: ${e.message}`);
                    }
                }

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
