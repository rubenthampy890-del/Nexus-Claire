#!/usr/bin/env bun
/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — SIDECAR DAEMON v2.0             ║
 * ║       Lightweight Distributed Worker Node            ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * A standalone lightweight worker that connects to the Nexus Brain
 * mainframe via WebSocket and executes delegated tasks.
 *
 * Deploy on any machine: VPS, Raspberry Pi, cloud VM, Docker, etc.
 * Multiple sidecars can connect simultaneously for distributed compute.
 *
 * Usage:
 *   NEXUS_MAINFRAME_URL=ws://your-server:18790 bun run src/core/satellite.ts
 *
 * Environment:
 *   NEXUS_MAINFRAME_URL - WebSocket URL of the brain server (default: ws://127.0.0.1:18790)
 *   SIDECAR_AUTH_TOKEN  - Optional auth token for secure connections
 *   SIDECAR_NAME        - Optional friendly name for this sidecar
 */

import { inference } from "./inference";
import { hostname } from "node:os";

const MAINFRAME_URL = process.env.NEXUS_MAINFRAME_URL || "ws://127.0.0.1:18790";
const SIDECAR_ID = `sidecar-${crypto.randomUUID().slice(0, 8)}`;
const SIDECAR_NAME = process.env.SIDECAR_NAME || hostname() || SIDECAR_ID;
const AUTH_TOKEN = process.env.SIDECAR_AUTH_TOKEN || "";
const RECONNECT_INTERVAL = 5000;
const HEARTBEAT_INTERVAL = 30000;
const MAX_RECONNECT_DELAY = 60000;

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
let isProcessingTask = false;

function log(msg: string) {
    const ts = new Date().toLocaleTimeString();
    console.log(`[${ts}] [SIDECAR:${SIDECAR_ID}] ${msg}`);
}

function getCapabilities(): string[] {
    return ['code', 'search', 'analysis', 'reasoning'];
}

function connect() {
    log(`Connecting to Mainframe: ${MAINFRAME_URL}`);

    try {
        ws = new WebSocket(MAINFRAME_URL);
    } catch (err: any) {
        log(`⚠️ Failed to create WebSocket: ${err.message}`);
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        log("✅ Connected to Mainframe.");
        reconnectAttempts = 0; // Reset on successful connection

        // Register with metadata
        ws!.send(JSON.stringify({
            type: "SATELLITE_REGISTER",
            payload: {
                id: SIDECAR_ID,
                name: SIDECAR_NAME,
                capabilities: getCapabilities(),
                os: process.platform,
                hostname: hostname(),
                auth: AUTH_TOKEN || undefined,
                timestamp: Date.now()
            }
        }));

        // Start heartbeat
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: "SATELLITE_HEARTBEAT",
                    payload: {
                        id: SIDECAR_ID,
                        uptime: process.uptime(),
                        busy: isProcessingTask,
                        memUsage: process.memoryUsage().heapUsed
                    }
                }));
            }
        }, HEARTBEAT_INTERVAL);
    };

    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(typeof event.data === "string" ? event.data : "");

            if (data.type === "SATELLITE_TASK") {
                const { taskId, directive, context } = data.payload;
                log(`📥 Received task [${taskId}]: "${directive?.substring(0, 80)}"`);
                isProcessingTask = true;

                // Acknowledge receipt
                sendToMainframe("SATELLITE_TASK_ACK", { taskId, status: "processing" });

                try {
                    // Send progress updates
                    sendToMainframe("SIDECAR_PROGRESS", {
                        taskId,
                        progress: "Reasoning on directive...",
                        percent: 10
                    });

                    // Build messages with context compression for long-running tasks
                    const messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }> = [
                        {
                            role: "system",
                            content: `You are Nexus Claire Sidecar Worker "${SIDECAR_NAME}". Execute the following task precisely and return the result. Be thorough but concise.`
                        },
                        {
                            role: "user",
                            content: `${context || ""}\n\nTask: ${directive}`
                        }
                    ];

                    // Auto-compress if context is too large (prevents 400 errors)
                    const compressedMessages = inference.compressHistory(messages);

                    const result = await inference.chat(compressedMessages);

                    log(`✅ Task [${taskId}] complete (${result.length} chars)`);
                    sendToMainframe("SATELLITE_TASK_RESULT", {
                        taskId,
                        status: "complete",
                        result: result.substring(0, 8000) // Generous cap
                    });
                } catch (err: any) {
                    log(`❌ Task [${taskId}] failed: ${err.message}`);
                    sendToMainframe("SATELLITE_TASK_RESULT", {
                        taskId,
                        status: "failed",
                        error: err.message
                    });
                } finally {
                    isProcessingTask = false;
                }
            } else if (data.type === "PING") {
                // Respond to server health checks
                sendToMainframe("PONG", { id: SIDECAR_ID, timestamp: Date.now() });
            }
        } catch (e) {
            // Non-JSON or irrelevant messages — ignore
        }
    };

    ws.onclose = () => {
        log("🔌 Disconnected from Mainframe.");
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        scheduleReconnect();
    };

    ws.onerror = (err) => {
        log(`⚠️ Connection error.`);
    };
}

function scheduleReconnect() {
    // Exponential backoff with max cap
    const delay = Math.min(RECONNECT_INTERVAL * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    log(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})...`);
    setTimeout(connect, delay);
}

function sendToMainframe(type: string, payload: any) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

// ─── Boot ───
console.log(`
╔══════════════════════════════════════════════════════╗
║         NEXUS SIDECAR DAEMON v2.0                   ║
╠══════════════════════════════════════════════════════╣
║  Sidecar ID    : ${SIDECAR_ID.padEnd(35)}║
║  Name          : ${SIDECAR_NAME.padEnd(35).slice(0, 35)}║
║  Mainframe URL : ${MAINFRAME_URL.padEnd(35).slice(0, 35)}║
║  Capabilities  : ${getCapabilities().join(', ').padEnd(35).slice(0, 35)}║
╚══════════════════════════════════════════════════════╝
`);

connect();

// Keep alive
setInterval(() => { }, 60000);

// Graceful shutdown
process.on("SIGINT", () => {
    log("Shutting down gracefully...");
    if (ws?.readyState === WebSocket.OPEN) {
        sendToMainframe("SIDECAR_DISCONNECT", { id: SIDECAR_ID, reason: "shutdown" });
    }
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    ws?.close();
    process.exit(0);
});

process.on("SIGTERM", () => {
    log("Received SIGTERM. Shutting down...");
    if (ws?.readyState === WebSocket.OPEN) {
        sendToMainframe("SIDECAR_DISCONNECT", { id: SIDECAR_ID, reason: "terminated" });
    }
    ws?.close();
    process.exit(0);
});
