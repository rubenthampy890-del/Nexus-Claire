
import { ToolDefinition } from "../../registry";

export const make_executable: ToolDefinition = {
  name: "make_executable",
  description: "Makes a file executable",
  category: "file-ops",
  parameters: {
  "path": {
    "type": "string",
    "description": "The path to the file",
    "required": true
  }
},
  execute: async (params: Record<string, any>) => {
    import os; os.chmod(path, 0o755)
  }
};
  