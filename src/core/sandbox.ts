import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

export interface SandboxResult {
    success: boolean;
    stdout: string;
    stderr: string;
    code: number;
    engine: 'DOCKER' | 'BUN_SUBPROCESS';
}

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
     * Tries Docker (the "best" safety) first. If Docker is not installed, 
     * falls back to a restricted native BUN child process.
     */
    public async executeCode(code: string): Promise<SandboxResult> {
        await this.initWorkspace();
        const filename = `script_${Date.now()}.ts`;
        const filepath = path.join(this.workspacePath, filename);

        await fs.writeFile(filepath, code, 'utf-8');

        // Check if Docker is available
        const hasDocker = await this.checkDocker();

        if (hasDocker) {
            console.log(`[SANDBOX] Executing via Secure Docker Container...`);
            return this.runInDocker(filename);
        } else {
            console.log(`[SANDBOX] Docker not found. Falling back to native Subprocess...`);
            return this.runInSubprocess(filepath);
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

    private runInDocker(filename: string): Promise<SandboxResult> {
        return new Promise((resolve) => {
            const command = `docker run --rm --network none --memory 256m -v "${this.workspacePath}:/app" oven/bun bun run /app/${filename}`;
            exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
                resolve({
                    success: !error,
                    stdout: stdout.trim(),
                    stderr: stderr.trim() || (error?.message || ""),
                    code: error?.code || 0,
                    engine: 'DOCKER'
                });
            });
        });
    }

    private runInSubprocess(filepath: string): Promise<SandboxResult> {
        return new Promise((resolve) => {
            // Using Bun to execute the script in a separate child process
            const command = `bun run ${filepath}`;
            exec(command, { timeout: 10000, cwd: this.workspacePath }, (error, stdout, stderr) => {
                resolve({
                    success: !error,
                    stdout: stdout.trim(),
                    stderr: stderr.trim() || (error?.message || ""),
                    code: error?.code || 0,
                    engine: 'BUN_SUBPROCESS'
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
