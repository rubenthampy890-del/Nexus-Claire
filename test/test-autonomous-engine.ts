import { orchestrator } from "./src/core/orchestrator";
import { taskManager } from "./src/core/task-manager";
import { type RoleDefinition } from "./src/core/types";
import { registerBuiltinTools } from "./src/core/tools/builtin";

// Initialize
registerBuiltinTools();

const testRole: RoleDefinition = {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'An agent for testing the recursive loop.',
    responsibilities: ['Testing'],
    autonomous_actions: ['terminal.run'],
    approval_required: [],
    kpis: [],
    communication_style: { tone: 'formal', verbosity: 'concise', formality: 'formal' },
    heartbeat_instructions: 'Test the system.',
    sub_roles: [],
    tools: ['terminal.run'],
    authority_level: 1
};

const agent = orchestrator.spawnAgent(testRole);

console.log("Launching test task...");

taskManager.launch({
    agent,
    task: "Use the terminal to echo 'Nexus Autonomous Engine Active' and confirm you can read the output.",
    onComplete: (task) => {
        console.log("Test Task Result:");
        console.log(JSON.stringify(task.result, null, 2));
        process.exit(task.result?.success ? 0 : 1);
    }
});
