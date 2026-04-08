import { toolRegistry, type ToolDefinition, type ToolParameter } from "../registry";
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
    const toolDir = path.join(process.cwd(), 'src/core/tools/generated');
    if (!existsSync(toolDir)) mkdirSync(toolDir, { recursive: true });

    const toolFilePath = path.join(toolDir, `${name}.ts`);

    const safeVarName = name.replace(/\./g, '_');

    // Format implementation (wrapping it for registration)
    const fullImplementation = `
import { ToolDefinition } from "../../registry";

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
            return `Success: Tool '${name}' developed, written to ${toolFilePath}, and dynamically registered. Ready for use.`;
        } catch (err) {
            console.warn(`[DEVELOPER-TOOL] Dynamic import failed for ${name}:`, err);
            return `Warning: Tool '${name}' written to disk but dynamic registration failed: ${err instanceof Error ? err.message : String(err)}. You might need to restart the daemon for it to be active.`;
        }
        return `Success: Tool '${name}' developed and registered. Tests skipped.`;
    } catch (err) {
        console.error(`[DEVELOPER-TOOL] Development failed for ${name}:`, err);
        return `Error developing tool '${name}': ${err instanceof Error ? err.message : String(err)}`;
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
