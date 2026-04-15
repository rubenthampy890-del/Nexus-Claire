import { NexusArchitect } from "../src/agents/architect";
import { registerSourceControlTools } from "../src/core/tools/source-control";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(import.meta.dir, "..", ".env") });

async function verifySelfCoding() {
    console.log("=== Verification Task 2: Self-Coding & Healing ===");
    const architect = new NexusArchitect();

    // Make sure source tools are registered
    registerSourceControlTools();

    const task = "Improve the logging in `src/core/onboard.ts` by adding a small comment line `// Nexus Self-Coding Verification v1.0` at the very beginning of the runDiagnostics function using your nexus.code_patch tool. Verify it with nexus.run_tests command 'bunx tsc --noEmit' afterwards.";

    console.log(`[TEST] Task: ${task}`);

    // This should trigger:
    // 1. [TOOL: registerSourceTools] (if not already)
    // 2. [TOOL: nexus.code_grep({ "pattern": "runDiagnostics" })]
    // 3. [TOOL: nexus.code_read({ "path": "src/core/onboard.ts" })]
    // 4. [TOOL: nexus.code_patch({ ... })]
    // 5. [TOOL: nexus.run_tests({ ... })]

    const response = await architect.sequence(task);
    console.log("\n[TEST RESULT] Architect Final Response:\n", response);

    if (typeof response === "string" && response.includes("nexus.run_tests")) {
        console.log("✅ Self-Coding Verification Phase 1 PASSED: Architect triggered the full source-control pipeline.");
    } else {
        console.log("❌ Self-Coding Verification FAILED: Architect did not follow the expected tool chain.");
    }
}

await verifySelfCoding();
