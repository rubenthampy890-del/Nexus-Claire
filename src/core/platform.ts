/**
 * Nexus Claire 4.0 — Cross-Platform OS Abstraction
 * Replaces hardcoded macOS shell commands to support Linux and Windows seamlessly.
 */

import { spawn } from "bun";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const platform = process.platform; // 'darwin', 'linux', 'win32'

export const PlatformUtils = {
    /**
     * Captures the screen to a file path using the correct OS utility.
     */
    async captureScreen(outputPath: string): Promise<void> {
        let cmd = "";

        switch (platform) {
            case "darwin":
                cmd = `screencapture -x ${outputPath}`;
                break;
            case "linux":
                cmd = `scrot ${outputPath} || import -window root ${outputPath}`;
                break;
            case "win32":
                // Basic PowerShell screen capture fallback
                cmd = `powershell -c "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $b.Save('${outputPath}')"`;
                break;
            default:
                throw new Error(`Screen capture not supported on platform: ${platform}`);
        }

        await execAsync(cmd);
    },

    /**
     * Gets CPU Load Percentage (0-100)
     */
    async getCPUUsage(): Promise<number> {
        try {
            let cmd = "";
            switch (platform) {
                case "darwin":
                    cmd = `top -l 1 | grep "CPU usage" | awk '{print $3}' | sed 's/%//'`;
                    break;
                case "linux":
                    cmd = `top -bn1 | grep "Cpu(s)" | awk '{print $2 + $4}'`;
                    break;
                case "win32":
                    cmd = `wmic cpu get loadpercentage | findstr /V "LoadPercentage"`;
                    break;
            }

            const { stdout } = await execAsync(cmd);
            const val = parseFloat(stdout.trim());
            return isNaN(val) ? 0 : val;
        } catch {
            return 0; // Fallback gracefully if monitoring tool fails
        }
    },

    /**
     * Synchronous variant for legacy monitors.
     */
    getCPUUsageSync(): number {
        try {
            let cmd = "";
            switch (platform) {
                case "darwin":
                    cmd = `top -l 1 | grep "CPU usage" | awk '{print $3}' | sed 's/%//'`;
                    break;
                case "linux":
                    cmd = `top -bn1 | grep "Cpu(s)" | awk '{print $2 + $4}'`;
                    break;
                case "win32":
                    cmd = `wmic cpu get loadpercentage | findstr /V "LoadPercentage"`;
                    break;
            }

            const { execSync } = require("child_process");
            const val = parseFloat(execSync(cmd, { encoding: "utf-8" }).trim());
            return isNaN(val) ? 0 : val;
        } catch {
            return 0;
        }
    },

    /**
     * Returns an OS-specific tuple for shell execution via Spawn.
     */
    getShellCommand(rawCommand: string): [string, string, string] {
        return platform === "win32"
            ? ["cmd", "/c", rawCommand]
            : ["sh", "-c", rawCommand];
    }
};
