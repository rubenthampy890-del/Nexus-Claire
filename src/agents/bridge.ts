import { NeuralLink } from "../core/link";
import { readFileSync } from "fs";
import { spawnSync } from "bun";

/**
 * The Bridge: Real-time Neural Link and System Awareness.
 * Uses 'gemini-live-api-dev' and 'multimodal_awareness'.
 */
export class NexusBridge {
    private linkCore: NeuralLink;

    private awarenessInterval: any;
    private broadcastToUI?: (type: string, payload: any) => void;

    constructor(broadcastToUI?: (type: string, payload: any) => void) {
        const apiKey = process.env.GEMINI_API_KEY || "YOUR_API_KEY";
        this.linkCore = new NeuralLink(apiKey);
        this.broadcastToUI = broadcastToUI;
        console.log("[BRIDGE] Neural Link & Awareness Core Initialized.");
    }

    /**
     * Commences the continuous multimodal awareness loop.
     */
    public startAwarenessEngine(intervalMs: number = 5000) {
        if (this.awarenessInterval) clearInterval(this.awarenessInterval);

        console.log(`[BRIDGE] Multimodal Awareness Engine Engaged (${intervalMs}ms loop).`);

        this.awarenessInterval = setInterval(() => {
            this.perceive();
        }, intervalMs);
    }

    public perceive() {
        // macOS native capture: hide cursor (-x), save to tmp
        const captureScript = `screencapture -x /tmp/awareness.jpg && sips -Z 1024 /tmp/awareness.jpg > /dev/null 2>&1`;

        const result = spawnSync(["sh", "-c", captureScript]);
        if (result.success) {
            try {
                const buffer = readFileSync("/tmp/awareness.jpg");
                const frame = buffer.toString("base64");

                // Stream to Gemini Live
                this.linkCore.sendFrame(frame);

                // Stream to UI Dashboard
                if (this.broadcastToUI) {
                    this.broadcastToUI('VISION_FRAME', `data:image/jpeg;base64,${frame}`);
                }
            } catch (e: any) {
                console.error("[BRIDGE] Failed to read vision frame:", e.message);
            }
        } else {
            console.error("[BRIDGE] Screenshot failed. Check screen recording permissions.");
        }
    }

    public async link() {
        await this.linkCore.connect();
        // Start feeding vision context once linked
        this.startAwarenessEngine();
    }
}
