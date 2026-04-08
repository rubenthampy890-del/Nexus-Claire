
import { ToolDefinition } from "../../registry";

export const system_cpu_query: ToolDefinition = {
  name: "system.cpu_query",
  description: "Retrieves the current CPU usage string from the system using 'top'.",
  category: "terminal",
  parameters: {},
  execute: async (params: Record<string, any>) => {
    async function execute() {
  // Note: In a real environment, we would call the terminal.run tool.
  // Since we are implementing this as a new tool, we assume access to the underlying system runner.
  const { run } = require('terminal');
  const result = await run('top -l 1 | grep "CPU usage"');
  if (result.error) {
    throw new Error(result.error);
  }
  return result.stdout.trim();
}
  }
};
  