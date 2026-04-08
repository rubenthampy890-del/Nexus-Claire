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

const ROOT = import.meta.dir;
const DASHBOARD_DIR = join(ROOT, "dashboard");

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function log(tag: string, color: string, msg: string) {
    console.log(`${color}${BOLD}[${tag}]${RESET} ${msg}`);
}

function banner() {
    console.clear();
    console.log(`
${CYAN}╔══════════════════════════════════════════════════════╗
║       NEXUS CLAIRE 4.0 — SENTINEL BOOT SEQUENCE        ║
║          Managed Swarm Architecture Active             ║
╚══════════════════════════════════════════════════════╝${RESET}
    `);
}

// ────────── CONFIG / ENV VALIDATION ──────────
const envPath = join(ROOT, ".env");
if (!existsSync(envPath)) {
    log("FATAL", RED, "No .env file found. Please copy .env.example to .env and configure your API keys.");
    process.exit(1);
}

const envSchema = z.object({
    CLOUDFLARE_ACCOUNT_ID_1: z.string().min(1, "Cloudflare Account ID is required for inference"),
    CLOUDFLARE_API_TOKEN_1: z.string().min(1, "Cloudflare API Token is required for inference"),
    GEMINI_API_KEY: z.string().min(1, "Gemini API Key is required for multimodal vision"),
    GROQ_API_KEY: z.string().min(1, "Groq API Key is required for TTS/STT processing"),
    VITE_WS_URL: z.string().optional()
});

const envParsed = envSchema.safeParse(Bun.env);
if (!envParsed.success) {
    log("FATAL", RED, "Environment configuration is invalid or missing keys:");
    for (const error of envParsed.error.issues) {
        console.log(`  ${YELLOW}→ ${BOLD}${error.path.join(".")}${RESET}: ${error.message}`);
    }
    process.exit(1);
}

async function bootBrain() {
    log("BRAIN", CYAN, "Starting Neural Core (ws://0.0.0.0:18790)...");
    const proc = spawn({
        cmd: ["bun", "run", join(ROOT, "src/core/brain.ts")],
        stdout: "inherit",
        stderr: "inherit",
        env: {
            ...Bun.env,
        },
    });
    return proc;
}

async function bootDashboard() {
    log("DASH", GREEN, "Booting Dashboard (http://localhost:5173)...");
    const proc = spawn({
        cmd: ["npm", "run", "dev"],
        cwd: DASHBOARD_DIR,
        stdout: "inherit",
        stderr: "inherit",
        env: {
            ...Bun.env,
        },
    });
    return proc;
}

function setupSignalHandlers(procs: Awaited<ReturnType<typeof bootBrain>>[]) {
    const shutdown = () => {
        log("NEXUS", YELLOW, "Shutting down all services...");
        tunnelManager.stop();
        for (const p of procs) {
            try { p.kill(); } catch (_) { }
        }
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

// ────────── MAIN ──────────
banner();

log("NEXUS", CYAN, "Initializing Sentinel Swarm Boot Sequence...");
log("NEXUS", CYAN, `Project Root: ${ROOT}`);
console.log();

// Boot all services in parallel
let brainProc: ReturnType<typeof spawn>;
let dashProc: ReturnType<typeof spawn>;

[brainProc, dashProc] = await Promise.all([
    bootBrain(),
    bootDashboard(),
]);

setupSignalHandlers([brainProc, dashProc]);

// Wait a bit for services to bind ports
await Bun.sleep(3000);

// Attempt Cloudflare Tunnel
const tunnelUrl = await tunnelManager.start(18790);
const tunnelLine = tunnelUrl
    ? `║  Tunnel URL  →  ${tunnelUrl.padEnd(37)}║`
    : `║  Tunnel      →  DISABLED (install cloudflared) ║`;

console.log(`
${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗
║                  NEXUS IS ALIVE                       ║
╠══════════════════════════════════════════════════════╣
║  Dashboard   →  http://localhost:5173                 ║
║  Neural Core →  ws://localhost:18790                  ║
${tunnelLine}
╠══════════════════════════════════════════════════════╣
║  Press Ctrl+C to shutdown all services                ║
╚══════════════════════════════════════════════════════╝${RESET}
`);


// Keep the process alive watching for child exits
setInterval(async () => {
    if (brainProc.exitCode !== null) {
        log("BRAIN", RED, `Neural Core exited unexpectedly (code ${brainProc.exitCode}). Restarting in 2s...`);
        await Bun.sleep(2000);
        brainProc = await bootBrain();
        setupSignalHandlers([brainProc, dashProc]);
    }

    if (dashProc.exitCode !== null) {
        log("DASH", RED, `Dashboard exited unexpectedly (code ${dashProc.exitCode}). Restarting in 2s...`);
        await Bun.sleep(2000);
        dashProc = await bootDashboard();
        setupSignalHandlers([brainProc, dashProc]);
    }
}, 5000);
