#!/usr/bin/env bun
/**
 * ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗
 * ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝
 * ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗
 * ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║
 * ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║
 * ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
 *
 * Nexus Claire — Unified Boot Sequence
 * Boots all services in parallel: Brain + Dashboard
 */

import { spawn } from "bun";
import { join } from "path";
import { existsSync } from "fs";
import { z } from "zod";
import { tunnelManager } from "./src/core/tunnel";
import { onboardManager } from "./src/core/onboard";
import { NexusCLI } from "./src/core/cli-ui";
import { config } from "dotenv";

const ROOT = import.meta.dir;
config({ path: join(ROOT, ".env") });

const DASHBOARD_DIR = join(ROOT, "dashboard");

// ────────── PORT CLEANUP ──────────

async function cleanupStalePorts() {
    const ports = [18790, 18791];
    for (const port of ports) {
        try {
            const proc = spawn({
                cmd: ["lsof", "-ti", `:${port}`],
                stdout: "pipe",
                stderr: "pipe",
            });
            const output = await new Response(proc.stdout).text();
            const pids = output.trim().split('\n').filter(Boolean);
            if (pids.length > 0) {
                NexusCLI.log(`Killing stale process(es) on port ${port}: PIDs ${pids.join(', ')}`, "WARN");
                for (const pid of pids) {
                    try {
                        process.kill(Number(pid), 'SIGTERM');
                    } catch { }
                }
                // Brief wait for ports to release
                await new Promise(r => setTimeout(r, 500));
            }
        } catch {
            // No process on port — expected case
        }
    }
}

// ────────── BOOT LOGIC ──────────

async function bootBrain() {
    NexusCLI.log("Starting Neural Core (ws://0.0.0.0:18790)...", "INFO");
    const proc = spawn({
        cmd: ["bun", "run", join(ROOT, "src/core/brain.ts")],
        stdout: "inherit",
        stderr: "inherit",
        env: { ...Bun.env },
    });
    return proc;
}

async function bootDashboard() {
    NexusCLI.log("Booting Dashboard (http://localhost:5173)...", "INFO");
    const proc = spawn({
        cmd: ["npm", "run", "dev"],
        cwd: DASHBOARD_DIR,
        stdout: "inherit",
        stderr: "inherit",
        env: { ...Bun.env },
    });
    return proc;
}

async function bootVoiceAgent() {
    NexusCLI.log("Starting Stark Voice Agent (LiveKit)...", "INFO");
    const proc = spawn({
        cmd: ["python3", "src/core/voice_agent.py", "dev"],
        cwd: ROOT,
        stdout: "inherit",
        stderr: "inherit",
        env: { ...Bun.env },
    });
    return proc;
}

function setupSignalHandlers(procs: any[]) {
    const shutdown = () => {
        NexusCLI.log("Shutting down all services...", "WARN");
        tunnelManager.stop();
        for (const p of procs) {
            try { p.kill(); } catch (_) { }
        }
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

import { inference } from "./src/core/inference";

// ────────── CLI COMMANDS ──────────

const args = process.argv.slice(2);

if (args.includes("--stats")) {
    NexusCLI.showBanner();
    const stats = inference.getRotationStats();
    NexusCLI.showSection("Inference Statistics");
    console.log(`     ○ Total Calls....... ${stats.totalCalls}`);
    console.log(`     ○ Rate Limits....... ${stats.rateLimitHits}`);
    console.log(`     ○ Key Rotations..... ${stats.rotations}`);
    console.log(`     ○ Last Active....... Account ${stats.lastSuccessfulAccount + 1}`);

    NexusCLI.showSection("Account Usage");
    Object.entries(stats.accountUsage).forEach(([acc, count]) => {
        console.log(`     ○ ${acc.replace('_', ' ').toUpperCase()}...... ${count} calls`);
    });

    if (stats.errors.length > 0) {
        NexusCLI.showSection("Recent Errors");
        stats.errors.slice(-5).forEach(err => {
            console.log(`     [${new Date(err.timestamp).toLocaleTimeString()}] (Acc ${err.account}) ${err.error.substring(0, 60)}...`);
        });
    }
    process.exit(0);
}

if (args.includes("--doctor")) {
    NexusCLI.showBanner();
    await onboardManager.runDiagnostics();
    process.exit(0);
}

// ────────── MAIN BOOT SEQUENCE ──────────
NexusCLI.showBanner();

// Run Professional Onboarding
const ready = await onboardManager.runDiagnostics();

if (!ready) {
    NexusCLI.log("System diagnostics failed. Forcing manual verification...", "WARN");
    // We let it continue but warn the user
}

NexusCLI.showSection("Booting Services");

// Kill any stale processes from previous runs
await cleanupStalePorts();

// Boot all services in parallel
let brainProc: any;
let dashProc: any;
let voiceProc: any;

[brainProc, dashProc, voiceProc] = await Promise.all([
    bootBrain(),
    bootDashboard(),
    bootVoiceAgent(),
]);

setupSignalHandlers([brainProc, dashProc, voiceProc]);

// Wait a bit for services to bind ports
await Bun.sleep(5000);

// Attempt Cloudflare Tunnel
const tunnelUrl = await tunnelManager.start(18790);

NexusCLI.showSection("System Links");
NexusCLI.showStatus("Dashboard", "http://localhost:5173", "#00F0FF");
NexusCLI.showStatus("Neural Core", "ws://localhost:18790", "#00F0FF");
if (tunnelUrl) {
    NexusCLI.showStatus("Bridge Link", tunnelUrl, "#00F0FF");
} else {
    NexusCLI.showStatus("Bridge Link", "OFFLINE", "#FF3366");
}

const RESET = "\x1b[0m";

// Keep the process alive watching for child exits
setInterval(async () => {
    if (brainProc.exitCode !== null) {
        NexusCLI.log(`Neural Core exited unexpectedly (code ${brainProc.exitCode}). Restarting in 2s...`, "ERROR");
        await Bun.sleep(2000);
        brainProc = await bootBrain();
        setupSignalHandlers([brainProc, dashProc]);
    }

    if (dashProc.exitCode !== null) {
        NexusCLI.log(`Dashboard exited unexpectedly (code ${dashProc.exitCode}). Restarting in 2s...`, "ERROR");
        await Bun.sleep(2000);
        dashProc = await bootDashboard();
        setupSignalHandlers([brainProc, dashProc, voiceProc]);
    }

    if (voiceProc.exitCode !== null) {
        NexusCLI.log(`Stark Voice Agent exited unexpectedly (code ${voiceProc.exitCode}). Restarting in 2s...`, "ERROR");
        await Bun.sleep(2000);
        voiceProc = await bootVoiceAgent();
        setupSignalHandlers([brainProc, dashProc, voiceProc]);
    }
}, 5000);
