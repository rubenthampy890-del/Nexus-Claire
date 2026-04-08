#!/usr/bin/env bun
/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — SATELLITE DAEMON                ║
 * ║       Cloud Worker for 24/7 Background Execution     ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * This daemon connects to a remote Nexus Brain via WebSocket
 * and processes [EXEC] tasks independently. Deploy on Railway,
 * Fly.io, a VPS, or any Docker host.
 *
 * Usage:
 *   NEXUS_MAINFRAME_URL=ws://your-server:18790 bun run src/core/satellite.ts
 */

import { inference } from "./inference";

const MAINFRAME_URL = process.env.NEXUS_MAINFRAME_URL || "ws://127.0.0.1:18790";
const SATELLITE_ID = `sat-${crypto.randomUUID().slice(0, 8)}`;
const RECONNECT_INTERVAL = 5000;
const HEARTBEAT_INTERVAL = 30000;

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function log(msg: string) {
    const ts = new Date().toLocaleTimeString();
    console.log(`[${ts}] [SATELLITE:${SATELLITE_ID}] ${msg}`);
}

function connect() {
    log(`Connecting to Mainframe: ${MAINFRAME_URL}`);

    ws = new WebSocket(MAINFRAME_URL);

    ws.onopen = () => {
        log("✅ Connected to Mainframe.");

        // Announce ourselves
        ws!.send(JSON.stringify({
            type: "SATELLITE_REGISTER",
            payload: {
                id: SATELLITE_ID,
                capabilities: ["code", "search", "analysis"],
                timestamp: Date.now()
            }
        }));

        // Start heartbeat
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: "SATELLITE_HEARTBEAT",
                    payload: { id: SATELLITE_ID, uptime: process.uptime() }
                }));
            }
        }, HEARTBEAT_INTERVAL);
    };

    ws.onmessage = async (event) => {
        try {
            const data = JSON.parse(typeof event.data === "string" ? event.data : "");

            if (data.type === "SATELLITE_TASK") {
                const { taskId, directive, context } = data.payload;
                log(`📥 Received task [${taskId}]: "${directive}"`);

                // Notify mainframe we're working on it
                sendToMainframe("SATELLITE_TASK_ACK", { taskId, status: "processing" });

                try {
                    // Process via inference
                    const result = await inference.chat([
                        { role: "system", content: "You are Nexus Claire Satellite Worker. Execute the following task precisely and return the result." },
                        { role: "user", content: `${context || ""}\n\nTask: ${directive}` }
                    ]);

                    log(`✅ Task [${taskId}] complete (${result.length} chars)`);
                    sendToMainframe("SATELLITE_TASK_RESULT", {
                        taskId,
                        status: "complete",
                        result: result.substring(0, 4000) // Cap to avoid WS overflow
                    });
                } catch (err: any) {
                    log(`❌ Task [${taskId}] failed: ${err.message}`);
                    sendToMainframe("SATELLITE_TASK_RESULT", {
                        taskId,
                        status: "failed",
                        error: err.message
                    });
                }
            }
        } catch (e) {
            // Non-JSON or irrelevant messages — ignore
        }
    };

    ws.onclose = () => {
        log("🔌 Disconnected from Mainframe. Reconnecting...");
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        setTimeout(connect, RECONNECT_INTERVAL);
    };

    ws.onerror = (err) => {
        log(`⚠️ Connection error. Will retry in ${RECONNECT_INTERVAL / 1000}s.`);
    };
}

function sendToMainframe(type: string, payload: any) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

// ─── Boot ───
console.log(`
╔══════════════════════════════════════════════════════╗
║           NEXUS SATELLITE DAEMON v1.0                ║
╠══════════════════════════════════════════════════════╣
║  Satellite ID  : ${SATELLITE_ID}                       ║
║  Mainframe URL : ${MAINFRAME_URL.padEnd(36)}║
╚══════════════════════════════════════════════════════╝
`);

connect();

// Keep alive
setInterval(() => { }, 60000);
