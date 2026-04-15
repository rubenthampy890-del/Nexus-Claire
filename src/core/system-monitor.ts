import { spawnSync } from "bun";
import { cpus, freemem, totalmem, uptime } from "os";
import { PlatformUtils } from "./platform";

export interface SystemTelemetry {
    cpu: number;       // % usage approximation
    memUsed: number;   // MB
    memTotal: number;  // MB
    memPct: number;    // %
    gpuName: string;   // e.g. "Apple M2 Max"
    activeApp: string;
    uptime: string;
    timestamp: string;
}

function getCpuUsage(): number {
    return PlatformUtils.getCPUUsageSync();
}

function getActiveApp(): string {
    try {
        const script = `tell application "System Events" to get name of first application process whose frontmost is true`;
        const result = spawnSync(["osascript", "-e", script]);
        return result.stdout.toString().trim() || "Unknown";
    } catch {
        return "Unknown";
    }
}

export function getSystemTelemetry(): SystemTelemetry {
    const totalMb = Math.round(totalmem() / 1024 / 1024);
    const freeMb = Math.round(freemem() / 1024 / 1024);
    const usedMb = totalMb - freeMb;
    const memPct = Math.round((usedMb / totalMb) * 100);
    const uptimeMins = Math.round(uptime() / 60);

    const hours = Math.floor(uptimeMins / 60);
    const mins = uptimeMins % 60;
    const uptimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    let gpuName = "Generic GPU";
    try {
        if (process.platform === 'darwin') {
            const res = spawnSync(["system_profiler", "SPDisplaysDataType"]);
            const output = res.stdout.toString();
            const match = output.match(/Chipset Model: (.*)/);
            if (match && match[1]) gpuName = match[1].trim();
        }
    } catch { }

    return {
        cpu: getCpuUsage(),
        memUsed: usedMb,
        memTotal: totalMb,
        memPct,
        gpuName,
        activeApp: getActiveApp(),
        uptime: uptimeStr,
        timestamp: new Date().toLocaleTimeString()
    };
}
