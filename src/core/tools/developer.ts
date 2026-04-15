import { toolRegistry, type ToolDefinition, type ToolParameter } from "../tool-registry";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";

export interface DevelopToolParams {
    name: string;
    description: string;
    category: 'terminal' | 'file-ops' | 'browser' | 'general' | 'communication' | 'intelligence';
    parameters: Record<string, ToolParameter>;
    implementation: string; // TypeScript code for the tool execution
    test_cases: string; // Test code to verify the tool
}

export async function developNexusTool(params: DevelopToolParams): Promise<string> {
    const { name, description, category, parameters, implementation, test_cases } = params;

    console.log(`[DEVELOPER-TOOL] Developing new tool: ${name}...`);

    // Ensure tool directory exists
    const toolDir = "/Users/basilthampy/Music/antigravity/new automative ai/nexus tools";
    if (!existsSync(toolDir)) mkdirSync(toolDir, { recursive: true });

    const toolFilePath = path.join(toolDir, `${name}.ts`);

    const safeVarName = name.replace(/\./g, '_');

    // Format implementation (wrapping it for registration)
    const fullImplementation = `
import { ToolDefinition } from "../Nexus-Claire/src/core/tool-registry";

export const ${safeVarName}: ToolDefinition = {
  name: "${name}",
  description: "${description}",
  category: "${category}",
  parameters: ${JSON.stringify(parameters, null, 2)},
  execute: async (params: Record<string, any>) => {
    ${implementation}
  }
};
  `;

    try {
        await Bun.write(toolFilePath, fullImplementation);
        console.log(`[DEVELOPER-TOOL] Tool ${name} written to ${toolFilePath}`);

        // 1. Validation: Run TypeScript check
        console.log(`[DEVELOPER-TOOL] Validating type safety for ${name}...`);
        const tsc = Bun.spawnSync(["bun", "x", "tsc", "--noEmit", "--esModuleInterop", "--skipLibCheck", "--target", "ESNext", "--module", "ESNext", "--moduleResolution", "bundler", "--types", "node,bun", "--ignoreConfig", toolFilePath]);
        if (tsc.exitCode !== 0) {
            const error = tsc.stderr.toString() || tsc.stdout.toString();
            throw new Error(`Tool '${name}' failed type-check validation: \n${error}`);
        }

        // 2. Validation: Run Test Cases
        if (test_cases && test_cases.trim().length > 0) {
            console.log(`[DEVELOPER-TOOL] Running test cases for ${name}...`);
            const testFilePath = path.join(toolDir, `${name}.test.ts`);
            const testCode = `
import { expect, test, describe } from "bun:test";
import { ${safeVarName} } from "./${name}";

describe("${name} autonomous tests", () => {
    ${test_cases}
});
            `;
            await Bun.write(testFilePath, testCode);

            const testRun = Bun.spawnSync(["bun", "test", testFilePath]);
            if (testRun.exitCode !== 0) {
                const error = testRun.stderr.toString() || testRun.stdout.toString();
                throw new Error(`Tool '${name}' failed autonomous tests: \n${error}`);
            }
            console.log(`[DEVELOPER-TOOL] Tests passed for ${name}.`);
        }

        // Dynamic registration via import()
        try {
            // We use a timestamp to bypass module caching for development
            const modulePath = `${toolFilePath}?v=${Date.now()}`;
            const module = await import(modulePath);
            const dynamicTool: ToolDefinition = module[safeVarName];

            if (!dynamicTool) {
                throw new Error(`Export '${safeVarName}' not found in ${toolFilePath}`);
            }

            toolRegistry.register(dynamicTool);
            return `Success: Tool '${name}' developed, validated (TSC + Tests), and registered. Ready for use.`;
        } catch (err) {
            console.warn(`[DEVELOPER-TOOL] Dynamic import failed for ${name}:`, err);
            return `Warning: Tool '${name}' passed validation but dynamic registration failed: ${err instanceof Error ? err.message : String(err)}. You might need to restart the daemon for it to be active.`;
        }
    } catch (err) {
        console.error(`[DEVELOPER-TOOL] Development failed for ${name}:`, err);
        return `Error developing tool '${name}': ${err instanceof Error ? err.message : String(err)}`;
    }
}

/**
 * Scans the absolute "nexus tools" directory and hot-loads all .ts tools.
 */
export async function loadGeneratedTools(): Promise<void> {
    const toolDir = "/Users/basilthampy/Music/antigravity/new automative ai/nexus tools";
    if (!existsSync(toolDir)) return;

    console.log(`[DEVELOPER-TOOL] 📂 Loading autonomous tools from: ${toolDir}`);

    const { readdirSync } = await import("node:fs");
    const files = readdirSync(toolDir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"));

    for (const file of files) {
        try {
            const toolName = file.replace(".ts", "");
            const safeVarName = toolName.replace(/\./g, '_');
            const filePath = path.join(toolDir, file);

            // Use timestamp to bypass cache if needed, though for boot it's usually clean
            const module = await import(`${filePath}?v=${Date.now()}`);
            const dynamicTool = module[safeVarName];

            if (dynamicTool) {
                toolRegistry.register(dynamicTool);
                console.log(`[DEVELOPER-TOOL] ⚡ Auto-registered: ${toolName}`);
            }
        } catch (err: any) {
            console.error(`[DEVELOPER-TOOL] ❌ Failed to auto-load ${file}:`, err.message);
        }
    }
}

// Register the developer tool into the registry
export const developerTools: ToolDefinition[] = [
    {
        name: 'nexus.develop_tool',
        description: 'Develops a new autonomous tool for Nexus and registers it in the registry.',
        category: 'intelligence',
        parameters: {
            name: { type: 'string', description: 'Name of the tool in snake_case.', required: true },
            description: { type: 'string', description: 'What the tool does.', required: true },
            category: { type: 'string', description: 'Category (terminal, file-ops, etc).', required: true },
            parameters: { type: 'object', description: 'Parameter schema.', required: true },
            implementation: { type: 'string', description: 'TypeScript implementation of the execute function.', required: true },
            test_cases: { type: 'string', description: 'Test cases to verify the implementation.', required: true },
        },
        execute: async (params, context?) => await developNexusTool(params as any)
    }
];

export function registerDeveloperTools(): void {
    for (const tool of developerTools) {
        toolRegistry.register(tool);
    }
}
