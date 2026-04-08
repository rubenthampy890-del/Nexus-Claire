/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — USER FINDER v1.0                           ║
 * ║       Omni-Channel Outreach Escalation                          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * When Nexus needs the user's attention, it escalates through
 * progressively more intrusive channels with configurable cooldowns.
 *
 * Escalation chain:
 *   Level 0 → Dashboard WebSocket push (instant)
 *   Level 1 → Desktop Notification (AppleScript)
 *   Level 2 → Telegram High-Priority Message (bold + HTML)
 *   Level 3 → Audible Voice (ElevenLabs TTS)
 */

import { spawnSync } from "bun";

/* ─── Types ─── */

export type EscalationLevel = 0 | 1 | 2 | 3;

export type EscalationConfig = {
    cooldownMs: number;       // Time between escalation levels (default: 5 min)
    maxLevel: EscalationLevel;
    enabled: boolean;
    voiceEnabled: boolean;    // ElevenLabs TTS for level 3
};

export type OutreachAttempt = {
    timestamp: number;
    level: EscalationLevel;
    channel: string;
    message: string;
    delivered: boolean;
};

type DashboardBroadcast = (type: string, data: any) => void;
type TelegramSend = (text: string, parseMode?: string) => void;
type VoiceSpeak = (text: string) => Promise<void>;

/* ─── User Finder ─── */

export class NexusUserFinder {
    private config: EscalationConfig = {
        cooldownMs: 5 * 60 * 1000,  // 5 minutes
        maxLevel: 3,
        enabled: true,
        voiceEnabled: true,
    };

    private currentLevel: EscalationLevel = 0;
    private escalationTimer: ReturnType<typeof setTimeout> | null = null;
    private attempts: OutreachAttempt[] = [];
    private acknowledged = false;

    // External channel handlers (injected by brain.ts)
    private dashboardBroadcast: DashboardBroadcast | null = null;
    private telegramSend: TelegramSend | null = null;
    private voiceSpeak: VoiceSpeak | null = null;

    /**
     * Wire external channel handlers.
     */
    public setChannels(opts: {
        dashboard?: DashboardBroadcast;
        telegram?: TelegramSend;
        voice?: VoiceSpeak;
    }): void {
        if (opts.dashboard) this.dashboardBroadcast = opts.dashboard;
        if (opts.telegram) this.telegramSend = opts.telegram;
        if (opts.voice) this.voiceSpeak = opts.voice;
    }

    /**
     * Initiate a user-finding escalation chain.
     * Starts at level 0 and escalates through channels until acknowledged.
     */
    public async findUser(reason: string, urgency: 'low' | 'normal' | 'critical' = 'normal'): Promise<void> {
        if (!this.config.enabled) {
            console.log(`[USER FINDER] Disabled, skipping outreach for: ${reason}`);
            return;
        }

        this.acknowledged = false;
        this.currentLevel = 0;

        // Critical urgency starts at level 2
        if (urgency === 'critical') {
            this.currentLevel = 2;
        }

        console.log(`[USER FINDER] 📡 Initiating outreach: "${reason}" (urgency: ${urgency})`);
        await this.executeLevel(reason);
    }

    /**
     * Execute the current escalation level.
     */
    private async executeLevel(reason: string): Promise<void> {
        if (this.acknowledged) {
            console.log(`[USER FINDER] ✅ User acknowledged. Stopping escalation.`);
            return;
        }

        if (this.currentLevel > this.config.maxLevel) {
            console.log(`[USER FINDER] ⚠️ Max escalation level reached. Giving up.`);
            return;
        }

        const attempt: OutreachAttempt = {
            timestamp: Date.now(),
            level: this.currentLevel,
            channel: this.getLevelChannel(this.currentLevel),
            message: reason,
            delivered: false,
        };

        try {
            switch (this.currentLevel) {
                case 0:
                    await this.sendDashboard(reason);
                    break;
                case 1:
                    await this.sendDesktopNotification(reason);
                    break;
                case 2:
                    await this.sendTelegram(reason);
                    break;
                case 3:
                    await this.sendVoice(reason);
                    break;
            }
            attempt.delivered = true;
        } catch (e: any) {
            console.warn(`[USER FINDER] Level ${this.currentLevel} delivery failed: ${e.message}`);
        }

        this.attempts.push(attempt);

        // Schedule next escalation level
        if (!this.acknowledged && this.currentLevel < this.config.maxLevel) {
            const nextLevel = (this.currentLevel + 1) as EscalationLevel;
            console.log(`[USER FINDER] ⏰ Will escalate to level ${nextLevel} in ${this.config.cooldownMs / 1000}s`);

            this.escalationTimer = setTimeout(async () => {
                this.currentLevel = nextLevel;
                await this.executeLevel(reason);
            }, this.config.cooldownMs);
        }
    }

    /* ─── Channel Implementations ─── */

    private async sendDashboard(reason: string): Promise<void> {
        if (this.dashboardBroadcast) {
            this.dashboardBroadcast('ALERT', {
                type: 'user_attention_needed',
                reason,
                level: 0,
                timestamp: Date.now(),
            });
        }
        console.log(`[USER FINDER] 🖥️ Dashboard alert sent: "${reason}"`);
    }

    private async sendDesktopNotification(reason: string): Promise<void> {
        try {
            const script = `display notification "${reason.replace(/"/g, '\\"')}" with title "NEXUS CLAIRE" subtitle "Attention Required" sound name "Glass"`;
            spawnSync(["osascript", "-e", script]);
            console.log(`[USER FINDER] 🔔 Desktop notification sent.`);
        } catch (e: any) {
            console.warn(`[USER FINDER] Desktop notification failed: ${e.message}`);
        }
    }

    private async sendTelegram(reason: string): Promise<void> {
        if (this.telegramSend) {
            const htmlMessage = `🚨 <b>NEXUS REQUIRES YOUR ATTENTION</b>\n\n${reason}\n\n<i>Reply to acknowledge.</i>`;
            this.telegramSend(htmlMessage, 'HTML');
            console.log(`[USER FINDER] 📱 Telegram high-priority sent.`);
        } else {
            console.warn(`[USER FINDER] Telegram not configured, skipping level 2.`);
        }
    }

    private async sendVoice(reason: string): Promise<void> {
        if (!this.config.voiceEnabled) {
            console.log(`[USER FINDER] 🔇 Voice disabled, skipping level 3.`);
            return;
        }

        if (this.voiceSpeak) {
            const shortReason = reason.length > 100 ? reason.substring(0, 100) + '...' : reason;
            await this.voiceSpeak(`Ruben, I need your attention. ${shortReason}`);
            console.log(`[USER FINDER] 🔊 Voice alert triggered.`);
        } else {
            console.warn(`[USER FINDER] Voice engine not configured, skipping level 3.`);
        }
    }

    /* ─── Control ─── */

    /**
     * User has responded — stop escalating.
     */
    public acknowledge(): void {
        this.acknowledged = true;
        if (this.escalationTimer) {
            clearTimeout(this.escalationTimer);
            this.escalationTimer = null;
        }
        console.log(`[USER FINDER] ✅ User acknowledged at level ${this.currentLevel}.`);
    }

    /**
     * Update configuration.
     */
    public configure(opts: Partial<EscalationConfig>): void {
        this.config = { ...this.config, ...opts };
        console.log(`[USER FINDER] Config updated:`, this.config);
    }

    /**
     * Get the channel name for a level.
     */
    private getLevelChannel(level: EscalationLevel): string {
        switch (level) {
            case 0: return 'dashboard';
            case 1: return 'desktop-notification';
            case 2: return 'telegram';
            case 3: return 'voice';
        }
    }

    /* ─── Diagnostics ─── */

    public getAttempts(): OutreachAttempt[] {
        return [...this.attempts];
    }

    public getCurrentLevel(): EscalationLevel {
        return this.currentLevel;
    }

    public isEscalating(): boolean {
        return !this.acknowledged && this.escalationTimer !== null;
    }
}

export const userFinder = new NexusUserFinder();
