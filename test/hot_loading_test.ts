import { runNexusAgent } from "../src/core/agent-runner";
import { orchestrator } from "../src/core/orchestrator";
import { toolRegistry } from "../src/core/tool-registry";
import { registerDeveloperTools } from "../src/core/tools/developer";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(import.meta.dir, "..", ".env") });

async function verifyHotLoading() {
    console.log("=== Verification Task 3: Hot-Loading via Absolute Path ===");

    // 1. Initial tools
    registerDeveloperTools();
    const initialCount = toolRegistry.getToolNames().length;
    console.log(`[TEST] Initial Tool Count: ${initialCount}`);

    // 2. Spawn Agent to develop a new tool
    const role = {
        id: 'tester',
        name: 'Tester',
        description: 'Testing tool development',
        responsibilities: ['Create tools'],
        tools: ['nexus.develop_tool'],
        authority_level: 10
    };
    const agent = orchestrator.spawnAgent(role as any);

    const task = "Develop a new tool named 'utility.btc_price' that fetches the current price of Bitcoin in USD from 'https://api.coindesk.com/v1/bpi/currentprice.json'. It should return a string like 'Price: $X,XXX'. Use nexus.develop_tool.";

    console.log(`[TEST] Task: ${task}`);

    const result = await runNexusAgent({
        agent,
        task,
        maxIterations: 5,
        onProgress: (p) => console.log(`[AGENT-PROGRESS] ${p}`)
    });

    console.log("\n[TEST RESULT] Agent Response:\n", result.response);

    // 3. Verify Hot-Loading
    const newCount = toolRegistry.getToolNames().length;
    console.log(`[TEST] New Tool Count: ${newCount}`);

    const btcTool = toolRegistry.getTool('utility.btc_price');
    if (btcTool) {
        console.log("✅ Hot-Loading Verification PASSED: New tool 'utility.btc_price' is live in the registry!");
        // Optional: Run it
        try {
            const price = await (btcTool as any).execute({});
            console.log(`[TEST] BTC Tool output: ${price}`);
        } catch (e) {
            console.warn(`[TEST] Tool execution failed but registration worked: ${e}`);
        }
    } else {
        console.log("❌ Hot-Loading Verification FAILED: Tool not found in registry.");
    }
}

await verifyHotLoading();
