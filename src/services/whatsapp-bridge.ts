/**
 * Nexus Claire: WhatsApp Bridge
 * 
 * Mirrors the Telegram bot functionality via WhatsApp Web.
 * Uses whatsapp-web.js for native WhatsApp linking.
 * 
 * Features:
 * - Direct chat relay to Nexus Brain
 * - !status: System telemetry
 * - !task <title>: Create a directive
 * - !search <query>: Web search from WhatsApp
 */

import { getSystemTelemetry } from "../core/system-monitor";

// WhatsApp Web.js is an optional dependency
let Client: any, LocalAuth: any;
let whatsappAvailable = false;

try {
    const ww = require('whatsapp-web.js');
    Client = ww.Client;
    LocalAuth = ww.LocalAuth;
    whatsappAvailable = true;
} catch {
    // whatsapp-web.js not installed — bridge will be disabled
}

export class WhatsAppBridge {
    private client: any;
    private allowedNumber: string | null = null;
    private _ready = false;

    // Callback for brain.ts to handle incoming messages
    public onMessageReceived?: (text: string) => void;
    public onTaskCreated?: (title: string) => void;
    public onSearchRequested?: (query: string) => void;
    public onStateChange?: (state: 'QR' | 'READY' | 'DISCONNECTED', data?: any) => void;


    constructor() {
        if (!whatsappAvailable) {
            console.log('[WHATSAPP] whatsapp-web.js not installed. Bridge disabled.');
            console.log('[WHATSAPP] To enable: bun add whatsapp-web.js');
            return;
        }

        this.client = new Client({
            authStrategy: new LocalAuth({ clientId: 'nexus-claire' }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        this.setupHandlers();
    }

    private setupHandlers() {
        if (!this.client) return;

        // QR Code for linking
        this.client.on('qr', (qr: string) => {
            console.log('[WHATSAPP] Scan this QR code to link your WhatsApp:');
            if (this.onStateChange) this.onStateChange('QR', qr);
            // Try to display QR in terminal
            try {
                const qrcode = require('qrcode-terminal');
                qrcode.generate(qr, { small: true });
            } catch {
                console.log('[WHATSAPP] QR Code (paste into QR reader):', qr.substring(0, 50) + '...');
            }
        });

        this.client.on('ready', () => {
            this._ready = true;
            if (this.onStateChange) this.onStateChange('READY');
            console.log('[WHATSAPP] Bridge Connected & Ready!');
        });

        this.client.on('message', async (msg: any) => {
            const text = msg.body?.trim();
            if (!text) return;

            // Auto-lock to first user who sends a message
            const contact = await msg.getContact();
            const number = contact.number;

            if (!this.allowedNumber) {
                this.allowedNumber = number;
                await msg.reply('✅ Nexus Claire linked. I am at your service, Architect.');
                console.log(`[WHATSAPP] Linked to user: ${number}`);
            }

            if (number !== this.allowedNumber) {
                await msg.reply('🚫 Unauthorized. Nexus Claire belongs to the Architect.');
                return;
            }

            console.log(`[WHATSAPP] Received: "${text}"`);

            // Command handling
            if (text.startsWith('!status')) {
                const t = getSystemTelemetry();
                const statusMsg = `🖥 *Mac Status*\n\n` +
                    `• CPU: ${t.cpu}%\n` +
                    `• RAM: ${t.memPct}% (${t.memUsed}/${t.memTotal} MB)\n` +
                    `• Active: ${t.activeApp}\n` +
                    `• Uptime: ${t.uptime}\n\n` +
                    `⏰ ${t.timestamp}`;
                await msg.reply(statusMsg);
                return;
            }

            if (text.startsWith('!task ')) {
                const taskTitle = text.substring(6).trim();
                if (taskTitle && this.onTaskCreated) {
                    this.onTaskCreated(taskTitle);
                    await msg.reply(`📋 Directive created: "${taskTitle}"`);
                }
                return;
            }

            if (text.startsWith('!search ')) {
                const query = text.substring(8).trim();
                if (query && this.onSearchRequested) {
                    this.onSearchRequested(query);
                    await msg.reply(`🔍 Searching: "${query}"...`);
                }
                return;
            }

            // Regular message — relay to brain
            if (this.onMessageReceived) {
                this.onMessageReceived(text);
            }
        });

        this.client.on('disconnected', () => {
            this._ready = false;
            if (this.onStateChange) this.onStateChange('DISCONNECTED');
            console.log('[WHATSAPP] Disconnected. Will try to reconnect...');
        });
    }

    /**
     * Send a message back to the linked user
     */
    public async replyDirect(text: string) {
        if (!this._ready || !this.allowedNumber || !this.client) return;
        try {
            const chatId = `${this.allowedNumber}@c.us`;
            await this.client.sendMessage(chatId, text);
        } catch (err: any) {
            console.error('[WHATSAPP] Reply failed:', err.message);
        }
    }

    public get isReady(): boolean {
        return this._ready;
    }

    public async launch() {
        if (!this.client) return;
        try {
            await this.client.initialize();
            console.log('[WHATSAPP] Initializing WhatsApp Bridge...');
        } catch (err: any) {
            console.error('[WHATSAPP] Launch failed:', err.message);
        }
    }
}
