import { toolRegistry, type ToolDefinition } from "../registry";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const execAsync = promisify(exec);

export const builtinTools: ToolDefinition[] = [
    {
        name: 'terminal.run',
        description: 'Execute a command in the terminal asynchronously.',
        category: 'terminal',
        parameters: {
            command: { type: 'string', description: 'The shell command to run.', required: true },
            cwd: { type: 'string', description: 'Working directory.', required: false },
        },
        execute: async (params) => {
            const { command, cwd = process.cwd() } = params as any;
            try {
                const { stdout, stderr } = await execAsync(command, { cwd });
                return `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
            } catch (err: any) {
                return `FAILED:\n${err.stdout || ''}\n\nERROR:\n${err.stderr || err.message}`;
            }
        }
    },
    {
        name: 'fs.read',
        description: 'Read the contents of a file.',
        category: 'file-ops',
        parameters: {
            path: { type: 'string', description: 'Absolute or relative path to the file.', required: true },
        },
        execute: async (params) => {
            const filePath = path.resolve(params.path as string);
            if (!existsSync(filePath)) return `Error: File not found: ${filePath}`;
            return readFileSync(filePath, 'utf-8');
        }
    },
    {
        name: 'fs.write',
        description: 'Write or overwrite a file with new content.',
        category: 'file-ops',
        parameters: {
            path: { type: 'string', description: 'Absolute or relative path to the file.', required: true },
            content: { type: 'string', description: 'The content to write.', required: true },
        },
        execute: async (params) => {
            const filePath = path.resolve(params.path as string);
            const dir = path.dirname(filePath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(filePath, params.content as string, 'utf-8');
            return `Success: File written to ${filePath}`;
        }
    },
    {
        name: 'fs.list',
        description: 'List the contents of a directory.',
        category: 'file-ops',
        parameters: {
            path: { type: 'string', description: 'Absolute or relative path to the directory.', required: true },
        },
        execute: async (params) => {
            const dirPath = path.resolve(params.path as string);
            if (!existsSync(dirPath)) return `Error: Directory not found: ${dirPath}`;
            const items = readdirSync(dirPath);
            return items.join('\n');
        }
    }
];

export function registerBuiltinTools(): void {
    for (const tool of builtinTools) {
        toolRegistry.register(tool);
    }
}
