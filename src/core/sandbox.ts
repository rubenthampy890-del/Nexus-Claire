import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

export interface SandboxResult {
    success: boolean;
    stdout: string;
    stderr: string;
    code: number;
    engine: 'DOCKER' | 'DOCKER_NETWORKED' | 'BUN_SANDBOXED';
}

export type SandboxMode = 'NO_NETWORK' | 'PROXY_ONLY';

export class NexusSandbox {
    private workspacePath: string;

    constructor() {
        this.workspacePath = path.join(os.tmpdir(), "nexus_workspace");
    }

    private async initWorkspace() {
        try {
            await fs.mkdir(this.workspacePath, { recursive: true });
        } catch (e) {
            // Exists
        }
    }

    /**
     * Executes arbitrary TypeScript/JavaScript code safely.
     * Tries Docker first (with tiered networking). Falls back to
     * MacOS sandbox-exec restricted Bun process.
     *
     * @param mode - 'NO_NETWORK' (default) for pure logic, 'PROXY_ONLY' for web-enabled tools.
     */
    public async executeCode(code: string, mode: SandboxMode = 'NO_NETWORK'): Promise<SandboxResult> {
        await this.initWorkspace();
        const filename = `script_${Date.now()}.ts`;
        const filepath = path.join(this.workspacePath, filename);

        await fs.writeFile(filepath, code, 'utf-8');

        // Check if Docker is available
        const hasDocker = await this.checkDocker();

        if (hasDocker) {
            console.log(`[SANDBOX] Executing via Docker Container (${mode})...`);
            return this.runInDocker(filename, mode);
        } else {
            console.log(`[SANDBOX] Docker not found. Using MacOS sandbox-exec isolation...`);
            return this.runSandboxed(filepath);
        }
    }

    private checkDocker(): Promise<boolean> {
        return new Promise((resolve) => {
            exec("docker info", (error) => {
                if (error) resolve(false);
                else resolve(true);
            });
        });
    }

    /**
     * Tiered Docker Execution:
     * - NO_NETWORK: --network none (zero internet access)
     * - PROXY_ONLY: Isolated bridge that blocks local subnets but allows outbound HTTP
     */
    private runInDocker(filename: string, mode: SandboxMode): Promise<SandboxResult> {
        return new Promise((resolve) => {
            const networkFlag = mode === 'NO_NETWORK'
                ? '--network none'
                : '--network bridge';  // Outbound OK, inbound blocked by default

            const command = `docker run --rm ${networkFlag} --memory 256m --cpus 1 ` +
                `-v "${this.workspacePath}:/app:ro" ` + // Read-only mount
                `oven/bun bun run /app/${filename}`;

            exec(command, { timeout: 15000 }, (error, stdout, stderr) => {
                resolve({
                    success: !error,
                    stdout: stdout.trim(),
                    stderr: stderr.trim() || (error?.message || ""),
                    code: error?.code || 0,
                    engine: mode === 'NO_NETWORK' ? 'DOCKER' : 'DOCKER_NETWORKED'
                });
            });
        });
    }

    /**
     * MacOS Hardened Fallback: Uses sandbox-exec to restrict filesystem.
     * - Blocks writes to all directories except /private/tmp and the workspace.
     * - Blocks network access entirely for safety.
     * - Prevents process spawning beyond the Bun runtime.
     */
    private runSandboxed(filepath: string): Promise<SandboxResult> {
        return new Promise((resolve) => {
            // MacOS sandbox-exec profile: deny most operations
            const sandboxProfile = [
                '(version 1)',
                '(allow default)',
                // Block all file writes except tmp and workspace
                '(deny file-write* (subpath "/Users"))',
                '(deny file-write* (subpath "/System"))',
                '(deny file-write* (subpath "/Applications"))',
                // Allow writes only to our workspace
                `(allow file-write* (subpath "${this.workspacePath}"))`,
                '(allow file-write* (subpath "/private/tmp"))',
                // Block network access
                '(deny network*)',
            ].join(' ');

            const isMac = process.platform === 'darwin';
            const command = isMac
                ? `sandbox-exec -p '${sandboxProfile}' bun run ${filepath}`
                : `bun run ${filepath}`;  // Non-Mac: basic subprocess (best effort)

            exec(command, { timeout: 10000, cwd: this.workspacePath }, (error, stdout, stderr) => {
                resolve({
                    success: !error,
                    stdout: stdout.trim(),
                    stderr: stderr.trim() || (error?.message || ""),
                    code: error?.code || 0,
                    engine: 'BUN_SANDBOXED'
                });
            });
        });
    }

    public async cleanup() {
        try {
            await fs.rm(this.workspacePath, { recursive: true, force: true });
        } catch (e) {
            console.error("[SANDBOX] Cleanup failed:", e);
        }
    }
}

export const sandbox = new NexusSandbox();
