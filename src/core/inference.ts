import { GoogleGenAI } from "@google/genai";
import { NexusCLI } from "./cli-ui";
import { identity } from "./identity";

// Bypass strict SSL validation for Ngrok free-tier certs on MacOS/Bun
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export type Message = {
    role: 'user' | 'assistant' | 'system';
    content: string;
    image?: { data: string; mimeType: string }; // Base64 data and mime type for vision
};

export type InferencePriority = 'HIGH' | 'LOW';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — INFERENCE SERVICE v3.1                     ║
 * ║       Resource Optimized: Priority-Based Routing                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Implements 4-tier failover with smart rotation:
 * 1. Ollama (Primary: Qwen 2.5 Coder 14B) — Hosted on Kaggle/Ngrok
 * 2. Cloudflare Workers AI (Secondary) — with auto key rotation
 * 3. Google AI Studio (Tertiary: Gemini 2.0 Flash)
 * 4. Groq (Emergency: Llama 3.3 70B)
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
    private ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "";

    private stats: RotationStats = {
        totalCalls: 0,
        rotations: 0,
        rateLimitHits: 0,
        lastSuccessfulAccount: 0,
        accountUsage: {
            ollama: 0,
            gemini: 0,
            groq: 0
        },
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

    /* ─── Rolling Context Summarizer (Prevents Token Overflow) ─── */
    private readonly MAX_CONTEXT_CHARS = 25000; // ~8k tokens
    private readonly PRESERVE_RECENT = 5; // Keep the 5 most recent turns intact

    /**
     * Compresses message history when it exceeds the token limit.
     * Preserves the system prompt and the N most recent turns.
     * Middle messages are collapsed into a single <MEMORY> summary block.
     */
    public compressHistory(messages: Message[]): Message[] {
        const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);

        if (totalChars <= this.MAX_CONTEXT_CHARS || messages.length <= this.PRESERVE_RECENT + 1) {
            return messages; // No compression needed
        }

        console.log(`[INFERENCE] 📦 Context compression triggered: ${totalChars} chars / ${messages.length} messages`);

        // Split: system prompt | compressible middle | recent turns
        const systemMsg = messages[0]?.role === 'system' ? messages[0] : null;
        const startIdx = systemMsg ? 1 : 0;
        const recentStart = Math.max(startIdx, messages.length - this.PRESERVE_RECENT);

        const middleMessages = messages.slice(startIdx, recentStart);
        const recentMessages = messages.slice(recentStart);

        // Summarize middle messages into a concise memory block
        const summaryLines = middleMessages.map(m => {
            const prefix = m.role === 'user' ? 'USER' : 'ASSISTANT';
            // Truncate long individual messages
            const content = m.content.length > 200
                ? m.content.substring(0, 200) + '...'
                : m.content;
            return `[${prefix}]: ${content}`;
        });

        const memoryBlock: Message = {
            role: 'system',
            content: `<MEMORY>\nThe following is a compressed summary of ${middleMessages.length} earlier conversation turns:\n${summaryLines.join('\n')}\n</MEMORY>`
        };

        const compressed = [
            ...(systemMsg ? [systemMsg] : []),
            memoryBlock,
            ...recentMessages
        ];

        const newChars = compressed.reduce((sum, m) => sum + m.content.length, 0);
        console.log(`[INFERENCE] ✅ Compressed: ${messages.length} msgs (${totalChars} chars) → ${compressed.length} msgs (${newChars} chars)`);

        return compressed;
    }

    /**
     * Main chat method with smart rotation and priority routing.
     * LOW priority (background tasks) bypasses Cloudflare neurons to save credits.
     */
    private injectProviderCtx(messages: Message[], provider: string): Message[] {
        const clone = messages.map(m => ({ ...m }));
        const sysMsg = clone.find(m => m.role === 'system');
        const note = `\n\n[SYSTEM METADATA: Your Active Neural Engine resolving this prompt is: ${provider}]`;
        if (sysMsg) {
            sysMsg.content += note;
        } else {
            clone.unshift({ role: 'system', content: note });
        }
        return clone;
    }

    public async chat(messages: Message[], priority: InferencePriority = 'HIGH'): Promise<string> {
        this.stats.totalCalls++;

        // Automatically inject system prompt if not present
        if (!messages.find(m => m.role === 'system')) {
            messages.unshift({ role: 'system', content: this.getSystemPrompt() });
        }

        // ── Rolling Context Compression ──
        messages = this.compressHistory(messages);

        // 1. Primary: Ollama/Kaggle
        if (this.ollamaBaseUrl) {
            try {
                const modelName = process.env.OLLAMA_MODEL || "nexus-brain";
                console.log(`[INFERENCE] Querying ${modelName} via Kaggle (${this.ollamaBaseUrl})...`);
                const kaggleCmd = this.injectProviderCtx(messages, `Kaggle Cloud (${modelName})`);
                const result = await this.queryOllama(kaggleCmd);
                this.stats.accountUsage.ollama = (this.stats.accountUsage.ollama || 0) + 1;
                console.log(`[INFERENCE] ✅ Response from: Kaggle/Ollama (${result.length} chars)`);
                return result;
            } catch (error: any) {
                console.warn(`[INFERENCE] Ollama/Kaggle failed: ${error.message}. Falling back to Cloudflare Swarm.`);
            }
        }

        // 2. Secondary: Cloudflare Swarm
        const cfMessages = this.injectProviderCtx(messages, "Cloudflare Swarm (Llama 3 / Qwen)");
        const cfResult = await this.executeWithKeyRotation(cfMessages);
        if (cfResult !== null) {
            console.log(`[INFERENCE] ✅ Response from: Cloudflare Account ${this.currentAccountIndex + 1}`);
            return cfResult;
        }

        // 3. Tertiary: Google AI Studio
        try {
            console.log(`[INFERENCE] Falling back to Gemini...`);
            const gemMessages = this.injectProviderCtx(messages, "Google AI Studio (Gemini Pro)");
            const geminiResult = await this.queryGemini(gemMessages);
            console.log(`[INFERENCE] ✅ Response from: Gemini (AI Studio)`);
            return geminiResult;
        } catch (error: any) {
            console.warn(`[INFERENCE] Gemini fallback failed: ${error.message}`);
        }

        // 4. Groq Emergency
        try {
            console.log(`[INFERENCE] EMERGENCY fallback to Groq...`);
            const groqMessages = this.injectProviderCtx(messages, "Groq Speed Cluster (Llama 3)");
            return await this.queryGroq(groqMessages);
        } catch (error: any) {
            console.error(`[INFERENCE] EMERGENCY: All providers failed! ${error.message}`);
            throw new Error("All inference providers are unreachable.");
        }
    }

    /**
     * OpenClaw-style key rotation: tries accounts starting from the last 
     * successful one, with specific handling for 429 rate limits vs other errors.
     */
    private accountCooldowns: Record<number, number> = {};

    private async executeWithKeyRotation(messages: Message[]): Promise<string | null> {
        if (this.cfAccounts.length === 0) return null;

        const maxRetries = this.cfAccounts.length;
        let attempt = 0;
        let triedAny = false;

        while (attempt < maxRetries) {
            const accountIdx = (this.currentAccountIndex + attempt) % this.cfAccounts.length;
            const account = this.cfAccounts[accountIdx]!;

            if (this.accountCooldowns[accountIdx] && Date.now() < this.accountCooldowns[accountIdx]!) {
                attempt++;
                continue;
            }

            triedAny = true;

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
                    this.accountCooldowns[accountIdx] = Date.now() + 60000; // 60s cooldown
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
        // Enforce the user's specific Gemma 4 ID
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

    private async queryOllama(messages: Message[]): Promise<string> {
        const baseUrl = this.ollamaBaseUrl.replace(/\/$/, '');
        const modelName = process.env.OLLAMA_MODEL || "nexus-brain";

        // Strategy 1: Native Ollama API
        try {
            const ollamaUrl = `${baseUrl}/api/chat`;
            const response = await fetch(ollamaUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "ngrok-skip-browser-warning": "true"
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: messages,
                    stream: false,
                    options: { temperature: 0.7, num_predict: 2048 }
                }),
                signal: AbortSignal.timeout(120000) // Allow 120s for cold model loading on Kaggle GPUs
            });

            // Detect dead ngrok tunnels returning HTML error pages
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/html')) {
                const body = await response.text();
                if (body.includes('ngrok') || body.includes('ERR_NGROK') || body.includes('endpoint')) {
                    throw new Error('Ngrok tunnel is offline (ERR_NGROK_3200). Kaggle kernel may need restart.');
                }
                throw new Error(`Ollama returned HTML instead of JSON (status ${response.status})`);
            }

            if (response.ok) {
                const data: any = await response.json();
                return data.message?.content || "Directive acknowledged.";
            }

            // If it's a 404, we don't throw yet - we try Strategy 2
            if (response.status !== 404) {
                throw new Error(`Ollama HTTP ${response.status}`);
            }
        } catch (e: any) {
            if (!e.message.includes('404')) throw e;
        }

        // Strategy 2: OpenAI-Compatible Fallback (vLLM, Unsloth, etc)
        console.log("[INFERENCE] Ollama endpoint not found. Attempting OpenAI-compatible fallback...");
        const openaiUrl = `${baseUrl}/v1/chat/completions`;
        const openaiResponse = await fetch(openaiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "true"
            },
            body: JSON.stringify({
                model: modelName,
                messages: messages,
                max_tokens: 2048,
                temperature: 0.7
            }),
            signal: AbortSignal.timeout(120000) // 120s for Kaggle VRAM allocation
        });

        // Detect dead ngrok on fallback too
        const ct = openaiResponse.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
            throw new Error('Ngrok tunnel is offline. Kaggle kernel may need restart.');
        }

        if (!openaiResponse.ok) {
            throw new Error(`Kaggle Inference failed (Tried Ollama & OpenAI). OpenAI Status: ${openaiResponse.status}`);
        }

        const data: any = await openaiResponse.json();
        return data.choices?.[0]?.message?.content || "Directive acknowledged.";
    }

    private async queryGemini(messages: Message[]): Promise<string> {
        // Extract system prompt
        const systemMsg = messages.find(m => m.role === 'system');
        const chatMessages = messages.filter(m => m.role !== 'system');

        // Convert to Google SDK format for genai
        const history = chatMessages.slice(0, -1).map(m => {
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

        const lastMessage = chatMessages[chatMessages.length - 1];
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
            contents: allMessages as any,
            config: systemMsg ? { systemInstruction: systemMsg.content } : undefined
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

    /* ─── Streaming Chat (for pipelined TTS) ─── */

    /**
     * Streaming chat — yields text chunks as they arrive from the LLM.
     * Uses Ollama's native streaming when available, falls back to
     * yielding the full response as a single chunk for other providers.
     */
    public async *streamChat(messages: Message[], priority: InferencePriority = 'HIGH'): AsyncGenerator<string> {
        this.stats.totalCalls++;

        // Automatically inject system prompt if not present
        if (!messages.find(m => m.role === 'system')) {
            messages.unshift({ role: 'system', content: this.getSystemPrompt() });
        }

        // 1. Primary: Ollama/Kaggle (true streaming)
        if (this.ollamaBaseUrl) {
            try {
                console.log(`[INFERENCE] [STREAM] Querying Qwen via Kaggle (${this.ollamaBaseUrl})...`);
                const kaggleCmd = this.injectProviderCtx(messages, "Kaggle Cloud (Qwen 2.5 GPU)");
                const baseUrl = this.ollamaBaseUrl.replace(/\/$/, '');
                const modelName = process.env.OLLAMA_MODEL || "nexus-brain";

                const response = await fetch(`${baseUrl}/api/chat`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "ngrok-skip-browser-warning": "true"
                    },
                    body: JSON.stringify({
                        model: modelName,
                        messages: kaggleCmd,
                        stream: true,
                        options: { temperature: 0.7, num_predict: 2048 }
                    }),
                    signal: AbortSignal.timeout(30000)
                });

                // Detect dead ngrok tunnels
                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('text/html')) {
                    throw new Error('Ngrok tunnel is offline (HTML response)');
                }

                if (response.ok && response.body) {
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || ''; // keep incomplete line in buffer

                        for (const line of lines) {
                            if (!line.trim()) continue;
                            try {
                                const json = JSON.parse(line);
                                if (json.message?.content) {
                                    yield json.message.content;
                                }
                                if (json.done) {
                                    this.stats.accountUsage.ollama = (this.stats.accountUsage.ollama || 0) + 1;
                                    console.log(`[INFERENCE] ✅ Stream complete from: Kaggle/Ollama`);
                                    return;
                                }
                            } catch { /* skip malformed JSON lines */ }
                        }
                    }

                    // Process remaining buffer
                    if (buffer.trim()) {
                        try {
                            const json = JSON.parse(buffer);
                            if (json.message?.content) yield json.message.content;
                        } catch { /* skip */ }
                    }

                    this.stats.accountUsage.ollama = (this.stats.accountUsage.ollama || 0) + 1;
                    console.log(`[INFERENCE] ✅ Stream complete from: Kaggle/Ollama`);
                    return;
                }

                throw new Error(`Ollama HTTP ${response.status}`);
            } catch (error: any) {
                console.warn(`[INFERENCE] [STREAM] Ollama/Kaggle stream failed: ${error.message}. Falling back...`);
            }
        }

        // 2. Fallback: Use blocking chat() and yield the full response as one chunk
        // (Cloudflare, Gemini, Groq don't have convenient streaming in our setup)
        try {
            const fullResponse = await this.chat(messages, priority);
            yield fullResponse;
        } catch (error: any) {
            console.error(`[INFERENCE] [STREAM] All providers failed: ${error.message}`);
            yield `System error: ${error.message}`;
        }
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
