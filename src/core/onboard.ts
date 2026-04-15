import { NexusCLI } from "./cli-ui";
import { PlatformUtils } from "./platform";
import { getSystemTelemetry } from "./system-monitor";
import { existsSync } from "node:fs";
import { join } from "node:path";

export class OnboardManager {
    /**
     * Perform pre-flight diagnostic checks.
     * Ensures all critical dependencies and configurations are ready.
     */
    public async runDiagnostics(): Promise<boolean> {
        console.log("\n[ONBOARD] Running pre-flight diagnostics...");

        const checks = [
            this.checkEnv(),
            this.checkDiskSpace(),
            this.checkAPIReachability(),
            this.warmupKaggleEngine()
        ];

        const results = await Promise.all(checks);
        const allPassed = results.every(r => r === true);

        if (allPassed) {
            NexusCLI.showStatus("Pre-flight", "PASSED", "#00FF66");
        } else {
            NexusCLI.showStatus("Pre-flight", "FAILED (Check Logs)", "#FF3366");
        }

        return allPassed;
    }

    private async warmupKaggleEngine(): Promise<boolean> {
        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL?.replace(/\/$/, '');
        if (!ollamaBaseUrl) return true; // No Kaggle configured, skip

        console.log("\n[ONBOARD] ⏳ Warming Kaggle Qwen GPU model (this takes ~3 mins on startup)...");
        const maxAttempts = 30; // 5 mins max wait (30 * 10s)

        for (let i = 1; i <= maxAttempts; i++) {
            try {
                const res = await fetch(`${ollamaBaseUrl}/api/tags`, {
                    method: 'GET',
                    headers: { "ngrok-skip-browser-warning": "true" }
                });

                if (res.ok) {
                    const ct = res.headers.get('content-type') || '';
                    if (!ct.includes('text/html')) {
                        console.log(`[ONBOARD] ✅ Kaggle Qwen model is warm and responding (attempt ${i})!`);
                        return true;
                    }
                }
            } catch (error) {
                // Ignore fetch errors, just wait and retry
            }

            if (i % 3 === 0) {
                console.log(`[ONBOARD] ... still waiting for Kaggle GPU model (attempt ${i}/${maxAttempts})`);
            }
            await new Promise(r => setTimeout(r, 10000)); // wait 10s
        }

        console.warn(`[ONBOARD] ⚠️ Kaggle warming timed out after 5 minutes. Falling back to failover cluster.`);
        return true; // Don't fail the whole boot, just warn user
    }

    private checkEnv(): boolean {
        const required = ["GEMINI_API_KEY", "ELEVENLABS_API_KEY"];
        const missing = required.filter(k => !process.env[k]);

        if (missing.length > 0) {
            console.error(`[ONBOARD] Missing critical environment variables: ${missing.join(", ")}`);
            return false;
        }

        if (!existsSync(join(process.cwd(), ".env"))) {
            console.warn("[ONBOARD] No .env file found. Using system environment variables.");
        }

        return true;
    }

    private async checkDiskSpace(): Promise<boolean> {
        try {
            const usage = await PlatformUtils.getDiskUsage();
            if (usage > 95) {
                console.warn(`[ONBOARD] Critical disk usage detected: ${usage}%`);
                return false;
            }
            return true;
        } catch {
            return true;
        }
    }


    private async checkAPIReachability(): Promise<boolean> {
        const apis = [
            { name: "Google AI", url: "https://generativelanguage.googleapis.com" },
            { name: "ElevenLabs", url: "https://api.elevenlabs.io" }
        ];

        for (const api of apis) {
            try {
                const res = await fetch(api.url, { method: "HEAD" });
                if (!res.ok && res.status !== 401) { // 401 is fine, means it reached the auth wall
                    console.warn(`[ONBOARD] ${api.name} API unreachable or returned ${res.status}`);
                    // Don't fail the whole boot unless it's a timeout/DNS error
                }
            } catch (e) {
                console.error(`[ONBOARD] Failed to reach ${api.name} (${api.url}). Connectivity issue?`);
                return false;
            }
        }
        return true;
    }
}

export const onboardManager = new OnboardManager();
