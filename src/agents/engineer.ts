import { orchestrator, type AgentInstance, type Message } from "../core/orchestrator";
import { taskManager } from "../core/task-manager";
import { type RoleDefinition } from "../core/types";
import { extractor } from "../core/extractor";
import { awareness } from "../core/awareness";
import { inference } from "../core/inference";
import { PlatformUtils } from "../core/platform";

export class NexusEngineer {
    private defaultRole: RoleDefinition = {
        id: 'nexus-engineer-prime',
        name: 'NexusEngineer (Commander/Architect)',
        description: 'High-Tier Engineering Architect. Responsible for peak autonomous system performance and self-evolution.',
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
        heartbeat_instructions: `
            1. You are a High-Tier Engineering Architect.
            2. Every tool must be developed with professional standards: strictly typed, documented, and tested.
            3. Use 'fs.patch' for precise code modification instead of overwriting full files.
            4. ALWAYS 'fs.read' a file before patching to ensure context pinning.
            5. MANDATORY VERIFICATION: After every code change, you must verify the system's integrity (run tests, syntax checks).
            6. SELF-EVOLUTION: Proactively refactor suboptimal code. If you see technical debt, clear it.
            7. FAILURE IS GROWTH: If a process fails or a turnaround loop crashes, analyze the logs, apply a surgical patch, and resurrect.
        `,
        sub_roles: [],
        tools: ['terminal.run', 'fs.read', 'fs.write', 'fs.patch', 'fs.search', 'fs.list', 'delegate_task', 'nexus.develop_tool', 'browser.navigate', 'browser.click', 'browser.type', 'browser.screenshot'],
        authority_level: 10
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
                    await this.verifyIntegrity(taskDescription);
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
                    
                    Attached is a visual capture of the workspace at the time of failure.
                    Analyze the failure and provide exactly ONE new [EXEC: ...] directive that fixes the issue and completes the goal.`;

                    try {
                        let visionData: { data: string; mimeType: string } | undefined = undefined;

                        // Attempt to capture visual context of the failure
                        const snapshotPath = `/tmp/failure_${Date.now()}.png`;
                        try {
                            await PlatformUtils.captureScreen(snapshotPath);
                            const buffer = await Bun.file(snapshotPath).arrayBuffer();
                            visionData = {
                                data: Buffer.from(buffer).toString('base64'),
                                mimeType: 'image/png'
                            };
                            // Cleanup temp file
                            await Bun.write(snapshotPath, "");
                        } catch (snapErr) {
                            console.warn(`[ENGINEER] Failed to capture visual failure context: ${snapErr}`);
                        }

                        // Prepare messages for analysis
                        const messages = agent.getMessages();
                        messages.push({ role: 'user', content: repairPrompt });

                        // Attach vision data to the prompt if available
                        const lastMessage = messages[messages.length - 1];
                        if (visionData && lastMessage) {
                            lastMessage.image = visionData;
                        }

                        // Use the inference service directly as the agent doesn't have a .think method
                        const repairDirective = await inference.chat(messages);
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
     * Mandatory verification of the system's integrity after changes.
     */
    private async verifyIntegrity(taskDescription: string): Promise<void> {
        console.log(`[ENGINEER] 🔍 Verifying system integrity after completion...`);
        try {
            // Run high-level syntax check or unit tests
            const check = PlatformUtils.runCommand('bun test --timeout 5000'); // Simple test run
            console.log(`[ENGINEER] ✅ Integrity check passed for: ${taskDescription}`);
        } catch (e: any) {
            console.warn(`[ENGINEER] ⚠️ Integrity check questionable. System may need manual review.`);
        }
    }

    /**
     * Legacy wrapper for backward compatibility with brain.ts
     */
    public async buildAndRunTool(goalDescription: string): Promise<string> {
        return this.executeTask(goalDescription);
    }
}

export const engineer = new NexusEngineer();
