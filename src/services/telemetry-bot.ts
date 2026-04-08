/**
 * Nexus Claire: Department 4 - Global Phone Link (Telegram)
 * 
 * This service allows Ruben to interact with Nexus from anywhere via Telegram.
 * Features:
 * - Direct chat relay to Nexus Brain
 * - /status: Real-time Mac telemetry
 * - /screengrab: Remote screenshot of the Mac
 * - /cmd: Execute sandboxed scripts (future)
 */

import { Telegraf } from "telegraf";
import { getSystemTelemetry } from "../core/system-monitor";
import { spawnSync } from "bun";
import { join } from "path";
import { unlinkSync } from "fs";

export class TelemetryBot {
    private bot: Telegraf;
    private allowedUserId: number | null = null; // Ruben's Telegram ID (auto-learned)

    constructor(token: string) {
        this.bot = new Telegraf(token);
        this.setupHandlers();
    }

    private setupHandlers() {
        // Middleware to restrict access to Ruben only
        this.bot.use(async (ctx, next) => {
            if (this.allowedUserId && ctx.from?.id !== this.allowedUserId) {
                return ctx.reply("🚫 Unauthorized access. Nexus Claire belongs to Ruben.");
            }
            return next();
        });

        // /start command - Link Ruben's identity
        this.bot.start((ctx) => {
            if (!this.allowedUserId) {
                this.allowedUserId = ctx.from.id;
                ctx.reply(`✅ Link Established. Welcome, Architect Ruben. I am at your service.`);
            } else {
                ctx.reply("System already linked to the Architect.");
            }
        });

        // /status command - Get Mac telemetry
        this.bot.command("status", async (ctx) => {
            const t = getSystemTelemetry();
            const statusMsg = `🖥 **Mac Terminal Status**\n\n` +
                `● CPU: ${t.cpu}%\n` +
                `● RAM: ${t.memPct}% (${t.memUsed}/${t.memTotal} MB)\n` +
                `● Active: ${t.activeApp}\n` +
                `● Uptime: ${t.uptime}\n\n` +
                `⏰ ${t.timestamp}`;

            await ctx.replyWithMarkdown(statusMsg);
        });

        // /screengrab command - Remote screenshot
        this.bot.command("screengrab", async (ctx) => {
            const tmpPath = join("/tmp", `nexus_grab_${Date.now()}.png`);
            try {
                ctx.reply("📸 Capturing workstation...");
                spawnSync(["screencapture", "-x", tmpPath]);
                await ctx.replyWithPhoto({ source: tmpPath });
                unlinkSync(tmpPath);
            } catch (err) {
                ctx.reply("❌ Screenshot failed: " + err);
            }
        });

        // Universal message handler - Relay to Nexus Brain
        this.bot.on("text", async (ctx) => {
            const text = ctx.message.text;
            if (text.startsWith("/")) return; // Ignore commands here

            console.log(`[TELEGRAM] Relaying message: "${text}"`);

            // This will be wired to the memory chat queue in brain.ts
            if (this.onMessageReceived) {
                this.onMessageReceived(text);
            }
        });
    }

    // Callback for brain.ts to handle relays
    public onMessageReceived?: (text: string) => void;

    /**
     * Send a direct message back to Ruben's phone.
     */
    public async replyDirect(text: string, parseMode?: string) {
        if (this.allowedUserId) {
            await this.bot.telegram.sendMessage(this.allowedUserId, text, { parse_mode: parseMode as any });
        }
    }

    public async launch() {
        this.bot.launch();
        console.log("[TELEGRAM] Bot Uplink Active.");

        // Enable graceful stop
        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }
}
