import { GoogleGenAI } from "@google/genai";
import { NexusCLI } from "./cli-ui";
import { identity } from "./identity";

export type Message = {
    role: 'user' | 'assistant' | 'system';
    content: string;
    image?: { data: string; mimeType: string }; // Base64 data and mime type for vision
};

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — INFERENCE SERVICE v3.0                     ║
 * ║       OpenClaw-Inspired: Smart API Key Rotation                 ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Implements 3-tier failover with smart rotation:
 * 1. Cloudflare Workers AI (Primary: Gemma 4 26B) — with auto key rotation
 * 2. Google AI Studio (Fallback: Gemini 2.0 Flash)
 * 3. Groq (Emergency: Llama 3.3 70B)
 *
 * Adapted from OpenClaw's executeWithApiKeyRotation():
 *   - Only rotates on actual rate-limit errors (429), not preemptively
 *   - Deduplicates keys (dedupeApiKeys pattern)
 *   - onRetry callback for dashboard logging
 *   - Exponential backoff between retries
 */

type CloudflareAccount = { accountId: string; apiToken: string };

type RotationStats = {
    totalCalls: number;
    rotations: number;
    rateLimitHits: number;
    lastSuccessfulAccount: number;
    accountUsage: Record<string, number>;
    errors: Array<{ timestamp: number; account: number; error: string }>;
};

type RetryCallback = (info: {
    attempt: number;
    accountIndex: number;
    error: string;
    willRetry: boolean;
}) => void;

export class InferenceService {
    private cfAccounts: CloudflareAccount[];
    private currentAccountIndex = 0;  // Sticky: remembers last working account

    private geminiClient: GoogleGenAI;
    private geminiModelId = "gemini-2.0-flash";
    private groqApiKey = process.env.GROQ_API_KEY || "";

    private stats: RotationStats = {
        totalCalls: 0,
        rotations: 0,
        rateLimitHits: 0,
        lastSuccessfulAccount: 0,
        accountUsage: {},
        errors: [],
    };

    private onRetryCallbacks: RetryCallback[] = [];

    constructor() {
        // Load and deduplicate accounts (OpenClaw dedupeApiKeys pattern)
        this.cfAccounts = this.dedupeAccounts([
            {
                accountId: process.env.CLOUDFLARE_ACCOUNT_ID || "",
                apiToken: process.env.CLOUDFLARE_API_TOKEN || ""
            },
            {
                accountId: process.env.CLOUDFLARE_ACCOUNT_ID_2 || "",
                apiToken: process.env.CLOUDFLARE_API_TOKEN_2 || ""
            },
            {
                accountId: process.env.CLOUDFLARE_ACCOUNT_ID_3 || "",
                apiToken: process.env.CLOUDFLARE_API_TOKEN_3 || ""
            },
            {
                accountId: process.env.CLOUDFLARE_ACCOUNT_ID_4 || "",
                apiToken: process.env.CLOUDFLARE_API_TOKEN_4 || ""
            }
        ].filter(acc => acc.accountId && acc.apiToken));

        this.geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

        // Initialize account usage tracking
        for (let i = 0; i < this.cfAccounts.length; i++) {
            this.stats.accountUsage[`account_${i + 1}`] = 0;
        }

        console.log(`[INFERENCE] Loaded ${this.cfAccounts.length} Cloudflare account(s) (deduplicated).`);
    }

    /**
     * Deduplicate API keys — prevents cycling through the same key twice.
     * Adapted from OpenClaw's dedupeApiKeys().
     */
    private dedupeAccounts(accounts: CloudflareAccount[]): CloudflareAccount[] {
        const seen = new Set<string>();
        return accounts.filter(acc => {
            const key = `${acc.accountId}:${acc.apiToken}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    private getSystemPrompt(): string {
        return identity.generateSystemPrompt();
    }

    /**
     * Register a callback that fires on every retry attempt.
     * Used by the dashboard to show real-time rotation status.
     */
    public onRetry(callback: RetryCallback): void {
        this.onRetryCallbacks.push(callback);
    }

    private emitRetry(info: Parameters<RetryCallback>[0]): void {
        for (const cb of this.onRetryCallbacks) {
            try { cb(info); } catch { }
        }
    }

    /**
     * Main chat method with smart rotation.
     * Adapted from OpenClaw's executeWithApiKeyRotation().
     */
    public async chat(messages: Message[]): Promise<string> {
        this.stats.totalCalls++;

        // Automatically inject system prompt if not present
        if (!messages.find(m => m.role === 'system')) {
            messages.unshift({ role: 'system', content: this.getSystemPrompt() });
        }

        // 1. Cloudflare — Smart Rotation (start from last successful account)
        const cfResult = await this.executeWithKeyRotation(messages);
        if (cfResult !== null) return cfResult;

        // 2. Google AI Studio
        try {
            console.log(`[INFERENCE] Falling back to Gemini...`);
            return await this.queryGemini(messages);
        } catch (error: any) {
            console.warn(`[INFERENCE] Gemini fallback failed: ${error.message}`);
        }

        // 3. Groq Emergency
        try {
            console.log(`[INFERENCE] EMERGENCY fallback to Groq...`);
            return await this.queryGroq(messages);
        } catch (error: any) {
            console.error(`[INFERENCE] EMERGENCY: All providers failed! ${error.message}`);
            throw new Error("All inference providers are unreachable.");
        }
    }

    /**
     * OpenClaw-style key rotation: tries accounts starting from the last 
     * successful one, with specific handling for 429 rate limits vs other errors.
     */
    private async executeWithKeyRotation(messages: Message[]): Promise<string | null> {
        if (this.cfAccounts.length === 0) return null;

        const maxRetries = this.cfAccounts.length;
        let attempt = 0;

        while (attempt < maxRetries) {
            const accountIdx = (this.currentAccountIndex + attempt) % this.cfAccounts.length;
            const account = this.cfAccounts[accountIdx]!;

            try {
                const result = await this.queryCloudflare(messages, account);

                // Success — remember this account for next time
                this.currentAccountIndex = accountIdx;
                this.stats.lastSuccessfulAccount = accountIdx;
                this.stats.accountUsage[`account_${accountIdx + 1}`] =
                    (this.stats.accountUsage[`account_${accountIdx + 1}`] || 0) + 1;

                if (attempt > 0) {
                    console.log(`[INFERENCE] ✅ Rotated to Account ${accountIdx + 1} (after ${attempt} retry/retries).`);
                }

                return result;
            } catch (error: any) {
                const isRateLimit = this.isRateLimitError(error);

                if (isRateLimit) {
                    this.stats.rateLimitHits++;
                    this.stats.rotations++;
                    console.warn(`[INFERENCE] ⚡ Rate-limited on Account ${accountIdx + 1}, rotating...`);
                }

                // Log the error
                this.stats.errors.push({
                    timestamp: Date.now(),
                    account: accountIdx + 1,
                    error: error.message,
                });

                // Keep only last 50 errors
                if (this.stats.errors.length > 50) {
                    this.stats.errors = this.stats.errors.slice(-50);
                }

                const willRetry = attempt + 1 < maxRetries;
                this.emitRetry({
                    attempt: attempt + 1,
                    accountIndex: accountIdx + 1,
                    error: error.message,
                    willRetry,
                });

                if (!willRetry) {
                    console.warn(`[INFERENCE] All ${maxRetries} Cloudflare account(s) exhausted.`);
                }

                // Exponential backoff only for rate limits (not other errors)
                if (isRateLimit && willRetry) {
                    const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                }

                attempt++;
            }
        }

        return null;
    }

    /**
     * Detect rate-limit errors specifically (429 status or known patterns).
     */
    private isRateLimitError(error: any): boolean {
        const msg = (error.message || '').toLowerCase();
        return (
            msg.includes('429') ||
            msg.includes('rate limit') ||
            msg.includes('rate_limit') ||
            msg.includes('too many requests') ||
            msg.includes('quota exceeded') ||
            msg.includes('neuron') // Cloudflare neuron limit
        );
    }

    private async queryCloudflare(
        messages: Message[],
        account: CloudflareAccount
    ): Promise<string> {
        const modelId = "@cf/google/gemma-4-26b-a4b-it";
        const url = `https://api.cloudflare.com/client/v4/accounts/${account.accountId}/ai/run/${modelId}`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${account.apiToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ messages, stream: false })
        });

        if (!response.ok) {
            const statusText = `Cloudflare HTTP ${response.status}`;
            throw new Error(response.status === 429 ? `Rate limit: ${statusText}` : statusText);
        }

        const data: any = await response.json();
        return data.result?.choices?.[0]?.message?.content || data.result?.response || "Directive acknowledged.";
    }

    private async queryGemini(messages: Message[]): Promise<string> {
        // Convert to Google SDK format for genai
        const history = messages.slice(0, -1).map(m => {
            const parts: any[] = [{ text: m.content }];
            if (m.image) {
                parts.push({
                    inlineData: {
                        data: m.image.data,
                        mimeType: m.image.mimeType
                    }
                });
            }
            return {
                role: m.role === 'assistant' ? 'model' : 'user',
                parts
            };
        });

        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) return "Directive acknowledged.";

        const lastParts: any[] = [{ text: lastMessage.content }];
        if (lastMessage.image) {
            lastParts.push({
                inlineData: {
                    data: lastMessage.image.data,
                    mimeType: lastMessage.image.mimeType
                }
            });
        }

        const allMessages = [...history, { role: 'user', parts: lastParts }];

        const response = await this.geminiClient.models.generateContent({
            model: this.geminiModelId,
            contents: allMessages as any
        });

        return response.text || "";
    }

    private async queryGroq(messages: Message[]): Promise<string> {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.groqApiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: messages,
                max_tokens: 2048,
                temperature: 0.7
            })
        });

        if (!response.ok) throw new Error(`Groq HTTP ${response.status}`);
        const data: any = await response.json();
        return data.choices?.[0]?.message?.content || "Directive acknowledged.";
    }

    /* ─── Diagnostics ─── */

    public getRotationStats(): RotationStats {
        return { ...this.stats };
    }

    public getCurrentAccountIndex(): number {
        return this.currentAccountIndex + 1; // 1-indexed for display
    }

    public getAccountCount(): number {
        return this.cfAccounts.length;
    }
}

export const inference = new InferenceService();
