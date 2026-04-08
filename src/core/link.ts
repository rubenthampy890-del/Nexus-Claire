import { GoogleGenAI } from "@google/genai";

/**
 * Layer 0: Neural Link
 * Handles the low-latency WebSocket connection to Gemini Live.
 * Inspired by 'gemini-live-api-dev' skill.
 */
export class NeuralLink {
    private client: any;
    private session: any;
    private speaker: any;

    constructor(private apiKey: string) {
        this.client = new GoogleGenAI({ apiKey: this.apiKey });
        // Audio will be handled by the UI/Browser via Edge TTS in brain.ts
        // Local speaker is disabled to avoid server-side conflicts.
        console.log("[NEURAL LINK] Live Engine Prime. Ready for Uplink.");
    }

    public async connect() {
        try {
            console.log("[NEURAL LINK] Establishing secure WebSocket to Gemini Live...");

            this.session = await this.client.live.connect({
                model: 'gemini-2.0-flash-exp',
                config: {
                    responseModalities: ['text'],
                    systemInstruction: {
                        parts: [{ text: 'You are Nexus Claire, a high-performance macOS AI assistant. Your responses must be concise, elite, and proactive.' }]
                    }
                },
                callbacks: {
                    onopen: () => console.log('[NEURAL LINK] Live Uplink Synchronized.'),
                    onmessage: (response: any) => this.handleMessage(response),
                    onerror: (error: any) => console.error('[NEURAL LINK] Critical Sync Error:', error),
                    onclose: () => console.log('[NEURAL LINK] Connection Terminated.')
                }
            });

        } catch (error) {
            console.error("[NEURAL LINK] Failed to initialize connection:", error);
        }
    }

    private handleMessage(response: any) {
        // Handle potential model turns
        const content = response.serverContent;
        if (content?.outputTranscription) {
            console.log(`[NEURAL LINK] Transcript: ${content.outputTranscription.text}`);
        }
    }

    public sendText(text: string) {
        if (this.session) {
            this.session.sendRealtimeInput({ text });
        }
    }

    public sendFrame(frameBase64: string) {
        if (this.session) {
            this.session.sendRealtimeInput({
                video: { data: frameBase64, mimeType: 'image/jpeg' }
            });
        }
    }
}
