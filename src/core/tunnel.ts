/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — TUNNEL MANAGER v1.0             ║
 * ║       Zero-Config Remote Access via cloudflared      ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Auto-detects cloudflared, launches a quick tunnel exposing
 * the Brain WebSocket (port 18790) to a public URL.
 * Falls back gracefully if cloudflared is not installed.
 *
 * Usage: Import and call tunnelManager.start() in nexus.ts
 */

import { spawn, which } from "bun";

export class TunnelManager {
    private tunnelProc: ReturnType<typeof spawn> | null = null;
    private publicUrl: string | null = null;
    private _active = false;

    /**
     * Check if cloudflared is installed on this system.
     */
    public async isAvailable(): Promise<boolean> {
        try {
            const path = which("cloudflared");
            return !!path;
        } catch {
            return false;
        }
    }

    /**
     * Start a quick tunnel (no Cloudflare account needed).
     * Exposes localPort to a random .trycloudflare.com URL.
     */
    public async start(localPort: number = 18790): Promise<string | null> {
        const available = await this.isAvailable();
        if (!available) {
            console.log("[TUNNEL] cloudflared not found. Install with: brew install cloudflared");
            console.log("[TUNNEL] Remote access disabled. Running in local-only mode.");
            return null;
        }

        console.log(`[TUNNEL] Starting Cloudflare Quick Tunnel on port ${localPort}...`);

        try {
            this.tunnelProc = spawn({
                cmd: ["cloudflared", "tunnel", "--url", `http://localhost:${localPort}`, "--no-autoupdate"],
                stdout: "pipe",
                stderr: "pipe",
            });

            // Parse stderr for the public URL (cloudflared logs to stderr)
            const url = await this.waitForUrl();

            if (url) {
                this.publicUrl = url;
                this._active = true;
                console.log(`[TUNNEL] ✅ Public URL: ${url}`);
                console.log(`[TUNNEL] Dashboard accessible at: ${url.replace('https://', 'wss://')}`);
                return url;
            } else {
                console.warn("[TUNNEL] Could not extract public URL. Tunnel may still be starting.");
                return null;
            }
        } catch (err: any) {
            console.error(`[TUNNEL] Failed to start: ${err.message}`);
            return null;
        }
    }

    /**
     * Wait for cloudflared to output the public URL (usually takes 2-5s).
     */
    private async waitForUrl(): Promise<string | null> {
        if (!this.tunnelProc?.stderr || typeof this.tunnelProc.stderr === 'number') return null;

        const decoder = new TextDecoder();
        const reader = (this.tunnelProc.stderr as ReadableStream<Uint8Array>).getReader();
        const timeout = 15000; // 15s timeout
        const start = Date.now();
        let buffer = "";

        while (Date.now() - start < timeout) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // cloudflared outputs: "your url is: https://xxxxx.trycloudflare.com"
            const urlMatch = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
            if (urlMatch) {
                reader.releaseLock();
                return urlMatch[0]!;
            }
        }

        reader.releaseLock();
        return null;
    }

    /**
     * Stop the tunnel gracefully.
     */
    public stop(): void {
        if (this.tunnelProc) {
            try {
                this.tunnelProc.kill();
            } catch { }
            this.tunnelProc = null;
            this._active = false;
            this.publicUrl = null;
            console.log("[TUNNEL] Tunnel closed.");
        }
    }

    // ─── Getters ───
    public isActive(): boolean { return this._active; }
    public getUrl(): string | null { return this.publicUrl; }
}

export const tunnelManager = new TunnelManager();
