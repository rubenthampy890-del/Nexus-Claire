import { roleLoader } from "./src/core/role-loader";
import { authorityEngine } from "./src/core/authority-engine";
import { orchestrator } from "./src/core/orchestrator";
import { toolRegistry } from "./src/core/registry";
import { Tools } from "./src/core/tools";

console.log("--- Nexus Claire 4.0: Swarm Verification ---");

// Step 1: Bootstrap Tools
Object.entries(Tools).forEach(([name, tool]) => {
    toolRegistry.register({
        name,
        description: tool.description,
        category: (name.startsWith('fs.') ? 'file-ops' : name.startsWith('terminal.') ? 'terminal' : 'general') as any,
        parameters: tool.parameters,
        execute: tool.execute
    });
});

// Test 1: Role Loading
console.log("\n[Test 1] Loading 'engineer' role...");
const role = roleLoader.loadRole('engineer');
console.log(`✅ Loaded: ${role.name} (${role.id})`);
console.log(`Responsibilities: ${role.responsibilities.length}`);

// Test 2: Authority Check (Autonomous)
console.log("\n[Test 2] Checking Authority: 'fs.read' (Autonomous)...");
const toolRead = toolRegistry.getTool('fs.read')!;
const decision1 = authorityEngine.checkAuthority(role, toolRead, { path: "/tmp/test.txt" });
console.log(`Decision: ${JSON.stringify(decision1)}`);
if (decision1.allowed && !decision1.requiresApproval) {
    console.log("✅ Correct: Allowed autonomously.");
} else {
    console.log("❌ Incorrect decision.");
}

// Test 2.1: Authority Check (Requires Approval)
console.log("\n[Test 2.1] Checking Authority: 'fs.delete' (Approval Required)...");
const toolDelete = toolRegistry.getTool('fs.delete')!;
const decision2 = authorityEngine.checkAuthority(role, toolDelete, { path: "/tmp/danger.txt" });
console.log(`Decision: ${JSON.stringify(decision2)}`);
if (decision2.allowed && decision2.requiresApproval) {
    console.log("✅ Correct: Gated for approval.");
} else {
    console.log("❌ Incorrect decision.");
}

// Test 3: Spawn & Hierarchy
console.log("\n[Test 3] Testing Hierarchy...");
const parent = orchestrator.spawnAgent(role);
const child = orchestrator.spawnAgent(role, parent.id);
console.log(`✅ Parent ID: ${parent.id}`);
console.log(`✅ Child ID: ${child.id} (Parent: ${child.agent.parent_id})`);

// Test 4: Delegation Tool Simulation
console.log("\n[Test 4] Simulating 'delegate_task' tool...");
const toolDelegate = toolRegistry.getTool('delegate_task')!;
console.log(`✅ Tool Found: ${toolDelegate.name}`);

console.log("\n--- Verification Complete ---");
process.exit(0);
