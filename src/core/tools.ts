import { spawnSync, spawn } from "bun";
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir, hostname, platform, arch, cpus } from "os";
import { getReport } from "./sys-monitor";
import { delegateTask } from "./tools/delegation";

/**
 * Skills Registry: Enhanced Toolkit for the Architect Persona.
 * Ported from Jarvis builtin.ts + macos.ts + desktop.ts patterns.
 */
export const Tools: Record<string, {
    description: string;
    parameters: any;
    execute: (args: any, context: { agentId: string }) => Promise<string>;
}> = {
    // ─── Recursive Hierarchy Tools ───
    delegate_task: {
        description: "Spawns a specialized sub-agent (e.g., 'engineer', 'researcher') to handle a complex sub-task. Returns the sub-agent's result.",
        parameters: {
            type: "object",
            properties: {
                role_id: { type: "string", description: "The ID of the role to spawn (e.g., 'engineer')." },
                task: { type: "string", description: "The specific objective for the sub-agent." },
                context: { type: "string", description: "Any background data the sub-agent needs." }
            },
            required: ["role_id", "task"]
        },
        execute: async (args: { role_id: string, task: string, context?: string }, context) => {
            return await delegateTask(args, context.agentId);
        }
    },

    // ─── Core File System Tools ───
    "terminal.run": {
        description: "Executes a shell command natively on the macOS system.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "The bash command to run." },
                timeout: { type: "number", description: "Timeout in milliseconds (default 30000)." }
            },
            required: ["command"]
        },
        execute: async (args: { command: string, timeout?: number }) => {
            console.log(`[SYS] Executing: ${args.command}`);
            const result = spawnSync(["sh", "-c", args.command], {
                timeout: args.timeout || 30000,
            });
            const stdout = result.stdout.toString();
            const stderr = result.stderr.toString();
            return stdout + (stderr ? `\n[STDERR] ${stderr}` : "");
        }
    },
    "fs.read": {
        description: "Reads the content of a file from the disk.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file." }
            },
            required: ["path"]
        },
        execute: async (args: { path: string }) => {
            try { return readFileSync(args.path, "utf-8"); }
            catch (e: any) { return `Error: ${e.message}`; }
        }
    },
    "fs.write": {
        description: "Writes content to a file on disk. Creates or overwrites.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file." },
                content: { type: "string", description: "Content to write." }
            },
            required: ["path", "content"]
        },
        execute: async (args: { path: string, content: string }) => {
            try { writeFileSync(args.path, args.content); return "Successfully wrote file."; }
            catch (e: any) { return `Error: ${e.message}`; }
        }
    },
    "fs.list": {
        description: "Lists the contents of a directory.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the directory." }
            },
            required: ["path"]
        },
        execute: async (args: { path: string }) => {
            try { return readdirSync(args.path).join("\n"); }
            catch (e: any) { return `Error: ${e.message}`; }
        }
    },
    "fs.delete": {
        description: "Deletes a file from the disk.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file." }
            },
            required: ["path"]
        },
        execute: async (args: { path: string }) => {
            try { unlinkSync(args.path); return "Successfully deleted file."; }
            catch (e: any) { return `Error: ${e.message}`; }
        }
    },

    // ─── macOS Desktop Automation (ported from Jarvis macos.ts) ───
    "system.active_window": {
        description: "Gets information about the currently active macOS window (app name, PID, title, position, size).",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => {
            try {
                const script = `
                    tell application "System Events"
                        set frontApp to name of first application process whose frontmost is true
                        set frontAppId to unix id of first application process whose frontmost is true
                        tell process frontApp
                            set winTitle to name of front window
                            set winPos to position of front window
                            set winSize to size of front window
                        end tell
                        return frontApp & "|" & frontAppId & "|" & winTitle & "|" & (item 1 of winPos) & "," & (item 2 of winPos) & "|" & (item 1 of winSize) & "," & (item 2 of winSize)
                    end tell
                `;
                const result = spawnSync(["osascript", "-e", script]);
                const output = result.stdout.toString().trim();
                const [name, pid, title, pos, size] = output.split('|');
                return JSON.stringify({ name, pid: Number(pid), title, position: pos, size });
            } catch (e: any) { return `Error: ${e.message}`; }
        }
    },
    "system.get_clipboard": {
        description: "Reads the current macOS clipboard contents.",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => {
            try {
                const result = spawnSync(["pbpaste"]);
                return result.stdout.toString() || "(clipboard empty)";
            } catch (e: any) { return `Error: ${e.message}`; }
        }
    },
    "system.set_clipboard": {
        description: "Writes text to the macOS clipboard.",
        parameters: {
            type: "object",
            properties: {
                content: { type: "string", description: "Text to put on the clipboard." }
            },
            required: ["content"]
        },
        execute: async (args: { content: string }) => {
            try {
                const proc = spawn(["pbcopy"], { stdin: "pipe" });
                proc.stdin.write(args.content);
                proc.stdin.end();
                return "Clipboard updated.";
            } catch (e: any) { return `Error: ${e.message}`; }
        }
    },
    "system.capture_screen": {
        description: "Takes a screenshot of the current screen and saves it to a temp file. Returns the file path.",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => {
            const tmpPath = join(tmpdir(), `nexus-capture-${Date.now()}.png`);
            try {
                spawnSync(["screencapture", "-x", "-C", tmpPath]);
                return tmpPath;
            } catch (e: any) {
                if (existsSync(tmpPath)) unlinkSync(tmpPath);
                return `Error: ${e.message}`;
            }
        }
    },
    "system.info": {
        description: "Get system information (hostname, OS, architecture, CPU count).",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => {
            return JSON.stringify({
                hostname: hostname(),
                platform: platform(),
                arch: arch(),
                cpus: cpus().length,
                uptime: `${(process.uptime() / 60).toFixed(1)} minutes`,
            });
        }
    },
    "system.open_app": {
        description: "Opens a macOS application by name (e.g., 'Safari', 'Finder', 'Terminal').",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Name of the macOS application to open." }
            },
            required: ["name"]
        },
        execute: async (args: { name: string }) => {
            try {
                spawnSync(["open", "-a", args.name]);
                return `Opened application: ${args.name}`;
            } catch (e: any) { return `Error: ${e.message}`; }
        }
    },
    "system.cpu_usage": {
        description: "Returns the current CPU usage percentage of the system.",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => {
            try {
                return await getReport();
            } catch (e: any) {
                return `Error: ${e.message}`;
            }
        }
    }
};

/**
 * Registry mapping for Google GenAI tool format
 */
export const ToolDefinitions = Object.entries(Tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.parameters
}));
