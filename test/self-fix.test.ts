import { describe, it, expect } from "bun:test";
import { orchestrator } from "../src/core/orchestrator";
import { taskManager } from "../src/core/task-manager";
import { RoleDefinition } from "../src/core/types";
import { registerBuiltinTools } from "../src/core/tools/builtin";
import { writeFileSync, readFileSync, unlinkSync } from "fs";

// Initialize environment
registerBuiltinTools();

describe("Nexus Recursive Self-Fix", () => {
    it("should autonomously detect and fix a syntax error in a file", async () => {
        const testFile = "/tmp/nexus_broken_v1.ts";
        const brokenContent = "const x = ; // Syntax Error here";
        writeFileSync(testFile, brokenContent);

        const engineeringRole: RoleDefinition = {
            id: 'test-engineer-role',
            name: 'Test Engineer',
            description: 'Fixing broken code.',
            responsibilities: ['Fixing'],
            autonomous_actions: ['fs.write', 'fs.read'],
            approval_required: [],
            kpis: [],
            communication_style: { tone: 'professional', verbosity: 'concise', formality: 'formal' },
            heartbeat_instructions: '',
            sub_roles: [],
            tools: ['fs.read', 'fs.write'],
            authority_level: 9
        };

        const agent = orchestrator.spawnAgent(engineeringRole);

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                orchestrator.terminateAgent(agent.id);
                reject(new Error("Self-fix test timed out after 120s."));
            }, 120000); // 120s timeout

            taskManager.launch({
                agent,
                task: `FIX REQUIRED: The file ${testFile} has a syntax error: "${brokenContent}". 
                Use the 'fs.write' tool to overwrite it with the following EXACT content: "const x = \\"fixed\\";"
                Verify the fix by reading the file afterward.`,
                onComplete: (task) => {
                    clearTimeout(timeout);
                    try {
                        const fixedContent = readFileSync(testFile, 'utf-8');
                        console.log(`[TEST] Resulting content: ${fixedContent}`);
                        expect(fixedContent).toContain('const x = "fixed"');
                        expect(task.result?.success).toBe(true);
                        resolve();
                    } catch (e) {
                        reject(e);
                    } finally {
                        orchestrator.terminateAgent(agent.id);
                        unlinkSync(testFile);
                    }
                }
            });
        });
    });
});
