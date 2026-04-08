import { roleLoader } from "../role-loader";
import { orchestrator } from "../orchestrator";
import { taskManager } from "../task-manager";
import { runNexusAgent } from "../agent-runner";

/**
 * delegate_task — Allows an agent to spawn a specialized sub-agent for a complex sub-task.
 * This implements Phase 3: Recursive Hierarchy.
 */
export async function delegateTask(params: { role_id: string; task: string; context?: string }, parentId: string): Promise<string> {
    const { role_id, task, context } = params;

    try {
        console.log(`[DELEGATION] Agent ${parentId} is delegating '${role_id}' for task: ${task.slice(0, 50)}...`);

        // 1. Load the requested role
        const role = roleLoader.loadRole(role_id);

        // 2. Spawn the sub-agent
        const subAgent = orchestrator.spawnAgent(role, parentId);

        // 3. Launch the agent asynchronously
        // We return the sub-agent ID immediately so the parent can continue or wait.
        // The actual run happens via runNexusAgent.
        const runPromise = runNexusAgent({
            agent: subAgent,
            task,
            context: `Delegated by parent ${parentId}. \nParent Context: ${context || 'None'}`,
            onProgress: (p) => console.log(`[DELEGATION][${subAgent.id}] ${p}`)
        });

        // For now, we wait for completion to provide a clean tool result to the parent.
        const result = await runPromise;

        return `Sub-agent ${subAgent.id} (${role.name}) completed the task. 
        Result Success: ${result.success}
        Response: ${result.response}`;

    } catch (error) {
        console.error(`[DELEGATION] Failed to delegate task:`, error);
        return `Error delegating task: ${error instanceof Error ? error.message : String(error)}`;
    }
}
