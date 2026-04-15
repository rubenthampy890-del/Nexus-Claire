import { NexusArchitect } from "../src/agents/architect";
import { registerWebTools } from "../src/core/tools/web";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(import.meta.dir, "..", ".env") });

async function verifyWebAutonomy() {
    console.log("=== Verification Task 1: Web Autonomy ===");
    const architect = new NexusArchitect();

    // Make sure tools are registered
    registerWebTools();

    console.log("[TEST] Sending exact query: 'Look up the current stock price of Apple (AAPL)'");

    // This should trigger [TOOL: web.search({"query": "Apple stock price AAPL"})]
    const response = await architect.sequence("Look up the current stock price of Apple (AAPL)");
    console.log("\n[TEST RESULT] Architect Output:\n", response);

    if (typeof response === "string" && response.includes("[TOOL: web.search")) {
        console.log("✅ Web Autonomy Verification PASSED: Architect successfully utilized the web.search tool autonomously.");
    } else {
        console.log("❌ Web Autonomy Verification FAILED: Architect did not trigger web.search.");
    }
}

await verifyWebAutonomy();
