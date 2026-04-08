
import { ToolDefinition } from "../../registry";

export const system_cpu_query: ToolDefinition = {
  name: "system_cpu_query",
  description: "Queries the current system CPU usage percentage.",
  category: "terminal",
  parameters: {},
  execute: async (params: Record<string, any>) => {
    import { execSync } from 'child_process';

export async function execute() {
  try {
    const output = execSync('top -l 1 | grep "CPU usage"').toString();
    return output.trim();
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}
  }
};
  