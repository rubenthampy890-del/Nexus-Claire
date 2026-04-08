
import { ToolDefinition } from "../../registry";

export const system_command: ToolDefinition = {
  name: "system_command",
  description: "Runs a system command without using a shell",
  category: "system",
  parameters: {
  "command": {
    "type": "string",
    "description": "The system command to run",
    "required": true
  }
},
  execute: async (params: Record<string, any>) => {
    import subprocess; subprocess.run(command.split())
  }
};
  