
import { developNexusTool } from "../src/core/tools/developer";
import { expect, test, describe } from "bun:test";

describe("Architect's Forge Verification", () => {
    test("Should REJECT a tool with syntax errors (Forge TSC check)", async () => {
        const result = await developNexusTool({
            name: "broken_syntax_tool",
            description: "A tool that should fail registration due to syntax errors.",
            category: "general",
            parameters: {},
            implementation: "this is not valid typescript code; !!!",
            test_cases: ""
        });

        console.log(`[VERIFY] Broken Syntax Result: ${result}`);
        expect(result).toContain("Error: Tool 'broken_syntax_tool' failed type-check validation");
    });

    test("Should REJECT a tool with failing tests (Forge Test check)", async () => {
        const result = await developNexusTool({
            name: "test_failure_tool",
            description: "A tool that should fail registration due to failing tests.",
            category: "general",
            parameters: {
                val: { type: "number", description: "A value", required: true }
            },
            implementation: "return params.val * 2;",
            test_cases: `
                test("failing test", () => {
                    expect(2 + 2).toBe(5); // This will fail
                });
            `
        });

        console.log(`[VERIFY] Test Failure Result: ${result}`);
        expect(result).toContain("Error: Tool 'test_failure_tool' failed autonomous tests");
    });

    test("Should ACCEPT a valid tool with passing tests", async () => {
        const result = await developNexusTool({
            name: "success_forge_tool",
            description: "A valid tool that should pass forge validation.",
            category: "general",
            parameters: {
                num: { type: "number", description: "A number", required: true }
            },
            implementation: "return params.num + 1;",
            test_cases: `
                test("addition works", () => {
                    // Note: In the generated test file, we import the tool as success_forge_tool
                    // Here we are testing the logic
                    expect(1 + 1).toBe(2);
                });
            `
        });

        console.log(`[VERIFY] Success Result: ${result}`);
        expect(result).toContain("Success: Tool 'success_forge_tool' developed, validated (TSC + Tests), and registered.");
    });
});
