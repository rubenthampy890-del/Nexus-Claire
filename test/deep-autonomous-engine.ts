import { orchestrator } from "./src/core/orchestrator";
import { taskManager } from "./src/core/task-manager";
import { type RoleDefinition } from "./src/core/types";
import { registerBuiltinTools } from "./src/core/tools/builtin";
import { registerDeveloperTools } from "./src/core/tools/developer";

// 1. Initialize Registry with all capabilities
registerBuiltinTools();
registerDeveloperTools();

// 2. Define the Engineer Role with high authority
const engineerRole: RoleDefinition = {
    id: 'nexus-engineer-test',
    name: 'Nexus Engineer',
    description: 'The primary autonomous engineering agent of Nexus Claire.',
    responsibilities: [
        'Architecting and implementing new features',
        'Refactoring and optimizing existing code',
        'Debugging complex system issues',
        'Generating and registering new autonomous tools'
    ],
    autonomous_actions: ['fs.write', 'terminal.run', 'nexus.develop_tool'],
    approval_required: [],
    kpis: [],
    communication_style: { tone: 'professional', verbosity: 'detailed', formality: 'formal' },
    heartbeat_instructions: 'Execute the engineering task with high precision and safe authority gating.',
    sub_roles: [],
    tools: ['terminal.run', 'fs.read', 'fs.write', 'fs.list', 'nexus.develop_tool'],
    authority_level: 9
};

// 3. Spawn the Agent
const agent = orchestrator.spawnAgent(engineerRole);

console.log("🚀 [DEEP-TEST] Launching Deep Autonomous Logic Test...");

/**
 * THE TASK:
 * We want a system status report that includes CPU usage.
 * But we don't have a 'system.cpu_load' tool.
 * The agent must:
 * 1. Realize it needs CPU data.
 * 2. Create the 'system.cpu_load' tool via 'nexus.develop_tool'.
 * 3. Test the new tool.
 * 4. Write a new file `src/core/sys-monitor.ts` that uses it.
 */
const deepTask = `DEEP TEST CHALLENGE:
We need a new system monitoring module. 
Goal: Implement a file at 'src/core/sys-monitor.ts' that exports a function 'getReport()' which returns a string containing the current CPU usage.

CRITICAL: We do not currently have a dedicated tool for CPU usage. 
You MUST:
1. Use 'nexus.develop_tool' to create a new tool named 'system.cpu_query'. 
   - Implementation should use 'top -l 1 | grep "CPU usage"' on macOS to get the string.
2. Use this new 'system.cpu_query' tool to get the data.
3. Write the implementation to 'src/core/sys-monitor.ts'.
4. Confirm everything works by catting the final file.`;

taskManager.launch({
    agent,
    task: deepTask,
    onProgress: (progress) => {
        console.log(`[DEEP-TEST-PULSE] ${progress}`);
    },
    onComplete: (task) => {
        console.log("\n✅ [DEEP-TEST] Task Completed!");
        console.log("Result Summary:");
        console.log(task.result?.response?.slice(0, 500) + "...");

        if (task.result?.success) {
            console.log("\n[DEEP-TEST] SUCCESS: Nexus evolved its own toolset and applied it to the codebase.");
        } else {
            console.log("\n[DEEP-TEST] FAILURE: The autonomous loop failed to achieve the goal.");
        }

        process.exit(task.result?.success ? 0 : 1);
    }
});
