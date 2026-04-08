import { roleLoader } from "./src/core/role-loader";
import { orchestrator } from "./src/core/orchestrator";
import { toolRegistry } from "./src/core/registry";
import { Tools } from "./src/core/tools";
import { runNexusAgent } from "./src/core/agent-runner";

console.log("🚀 NEXUS CLAIRE 4.0: LIVE SWARM DEMO 🚀");
console.log("========================================\n");

// 1. Initialize Registry
Object.entries(Tools).forEach(([name, tool]) => {
    toolRegistry.register({
        name,
        description: tool.description,
        category: (name.startsWith('fs.') ? 'file-ops' : name.startsWith('terminal.') ? 'terminal' : 'general') as any,
        parameters: tool.parameters,
        execute: tool.execute
    });
});

async function runDemo() {
    // 2. Load Role
    const engineerRole = roleLoader.loadRole('engineer');

    // 3. Spawn Primary Agent
    const nexusPrime = orchestrator.spawnAgent(engineerRole);
    console.log(`[DEMO] Primary Agent '${nexusPrime.id}' initialized with '${engineerRole.name}' role.`);

    // 4. Task Description
    const task = `
        1. List the files in the roles/ directory.
        2. Create a temporary file called 'swarm-test.txt' with the text 'Nexus 4.0 Swarm Active'.
        3. Delegation: Delegate a sub-agent (using the engineer role) to audit the contents of 'swarm-test.txt' and verify it contains the correct text.
        4. Authority Test: Try to delete 'swarm-test.txt' (This should trigger a security gate).
    `;

    console.log("\n[DEMO] Starting Autonomous Task Loop...");

    const result = await runNexusAgent({
        agent: nexusPrime,
        task,
        maxIterations: 20,
        onProgress: (p) => console.log(`[PRIME] ${p}`)
    });

    console.log("\n[DEMO] Final Response from Prime:");
    console.log(result.response);

    console.log("\n[DEMO] Swarm Statistics:");
    console.log(`Total Tools Used: ${result.toolsUsed.join(", ")}`);

    process.exit(0);
}

runDemo().catch(console.error);
