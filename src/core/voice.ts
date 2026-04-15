/**
 * Nexus Claire: Voice Engine v2.0 (Thomas Persona)
 * 
 * TTS: ElevenLabs (primary) + Edge TTS (fallback)
 * STT: Groq Whisper (primary) for voice-to-text transcription
 */

// ────────────── TTS Interfaces ──────────────
export interface TTSProvider {
    synthesize(text: string): Promise<Buffer>;
    stream?(text: string, onAudioChunk: (chunk: Buffer) => void): Promise<void>;
}

// ────────────── STT Interfaces ──────────────
export interface STTProvider {
    transcribe(audio: Buffer): Promise<string>;
}

// ────────────── ElevenLabs TTS (Streaming) ──────────────
export class ElevenLabsTTSProvider implements TTSProvider {
    private apiKey: string;
    private voiceId: string;
    private model: string;

    constructor(apiKey: string, voiceId = 'JBFqnCBsd6RMkjVDRZhf', model = 'eleven_turbo_v2') {
        this.apiKey = apiKey;
        this.voiceId = voiceId;
        this.model = model;
    }

    async synthesize(text: string): Promise<Buffer> {
        try {
            const response = await fetch(
                `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream?output_format=mp3_44100_128`,
                {
                    method: 'POST',
                    headers: {
                        'xi-api-key': this.apiKey,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        text,
                        model_id: this.model,
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.75,
                        },
                    }),
                }
            );

            if (!response.ok) {
                const err = await response.text();
                console.warn(`[VOICE] ElevenLabs error (${response.status}): ${err.slice(0, 100)}`);
                return Buffer.alloc(0);
            }

            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (err: any) {
            console.error('[VOICE] ElevenLabs synthesis failed:', err.message);
            return Buffer.alloc(0);
        }
    }

    /**
     * Real-time Streaming via WebSocket
     */
    public async streamSynthesize(text: string, onAudioChunk: (chunk: Buffer) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=${this.model}`);

            socket.onopen = () => {
                const bos = {
                    text: " ",
                    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
                    xi_api_key: this.apiKey,
                };
                socket.send(JSON.stringify(bos));

                // Send content in chunks
                socket.send(JSON.stringify({ text: text + " ", try_trigger_generation: true }));
                socket.send(JSON.stringify({ text: "" })); // EOS
            };

            socket.onmessage = (event) => {
                const data = JSON.parse(event.data as string);
                if (data.audio) {
                    onAudioChunk(Buffer.from(data.audio, 'base64'));
                }
                if (data.isFinal) {
                    socket.close();
                    resolve();
                }
            };

            socket.onerror = (err) => {
                console.error('[VOICE] WebSocket Error:', err);
                reject(err);
            };

            socket.onclose = () => resolve();
        });
    }
}

// ────────────── Edge TTS (Fallback) ──────────────
export class EdgeTTSProvider implements TTSProvider {
    private voice: string;
    private rate: string;
    private volume: string;

    constructor(voice = 'en-US-AriaNeural', rate = '+0%', volume = '+0%') {
        this.voice = voice;
        this.rate = rate;
        this.volume = volume;
    }

    async synthesize(text: string): Promise<Buffer> {
        try {
            const { Communicate } = await import('edge-tts-universal');
            const comm = new Communicate(text, {
                voice: this.voice,
                rate: this.rate,
                volume: this.volume,
            });
            const chunks: Buffer[] = [];
            for await (const chunk of comm.stream()) {
                if (chunk.type === 'audio' && chunk.data) {
                    chunks.push(chunk.data);
                }
            }
            return Buffer.concat(chunks);
        } catch (err: any) {
            console.error('[VOICE] Edge TTS synthesis failed:', err.message);
            return Buffer.alloc(0);
        }
    }
}

// ────────────── Groq Whisper STT ──────────────
export class GroqWhisperSTT implements STTProvider {
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model = 'whisper-large-v3-turbo') {
        this.apiKey = apiKey;
        this.model = model;
    }

    async transcribe(audio: Buffer): Promise<string> {
        const formData = new FormData();
        formData.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/webm' }), 'audio.webm');
        formData.append('model', this.model);
        formData.append('language', 'en');

        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
            body: formData,
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Groq STT error (${response.status}): ${err}`);
        }

        const result = await response.json() as any;
        return result.text;
    }
}

// ────────────── Utilities ──────────────
export function splitIntoSentences(text: string): string[] {
    const collapsed = text.replace(/```[\s\S]*?```/g, '[code block]');
    const sentences = collapsed
        .split(/(?<=[.!?])\s+(?=[A-Z])|(?<=\n\n)/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
    return sentences.length > 0 ? sentences : [text];
}

// ────────────── Factory ──────────────
export function createTTSProvider(): TTSProvider {
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgmqMArWsc7r"; // Thomas (Deep Masculine British)

    // Always create a fallback provider
    const fallback = new EdgeTTSProvider();

    if (elevenLabsKey) {
        const voiceId = ELEVENLABS_VOICE_ID;
        const primary = new ElevenLabsTTSProvider(elevenLabsKey, voiceId);

        // Wrap ElevenLabs with a runtime fallback
        return {
            synthesize: async (text: string) => {
                const buffer = await primary.synthesize(text);
                if (buffer.length === 0) {
                    console.log('[VOICE] ElevenLabs failed/limit hit. Falling back to Edge TTS...');
                    return await fallback.synthesize(text);
                }
                return buffer;
            },
            stream: async (text: string, onAudioChunk: (chunk: Buffer) => void) => {
                try {
                    await primary.streamSynthesize(text, onAudioChunk);
                } catch (err) {
                    console.error('[VOICE] ElevenLabs stream failed. Falling back to static synthesis.');
                    const buffer = await fallback.synthesize(text);
                    if (buffer.length > 0) onAudioChunk(buffer);
                }
            }
        };
    }
    return new EdgeTTSProvider("en-GB-ThomasNeural", "+0%", "-10%"); // Deeper tone via volume/rate tweak
}

export function createSTTProvider(): STTProvider | null {
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
        return new GroqWhisperSTT(groqKey);
    }
    console.log('[VOICE] No GROQ_API_KEY found, STT disabled.');
    return null;
}

/**
 * Singleton voice engine instance — uses ElevenLabs if configured, else Edge TTS.
 */
export const VoiceEngine = createTTSProvider();
export const SpeechToText = createSTTProvider();
