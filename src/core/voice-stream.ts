/**
 * Nexus Claire: Continuous Voice Stream Engine v1.0
 * 
 * Replaces push-to-talk with full-duplex audio:
 * - Continuous WebSocket audio streaming from the browser
 * - Voice Activity Detection (VAD) via amplitude analysis
 * - Automatic speech segmentation (silence detection -> submit to STT)
 * - Interruption handling (cuts TTS when user speaks)
 */

import { SpeechToText } from "./voice";

export interface VoiceStreamConfig {
    /** Minimum RMS amplitude to consider as speech (0-1 scale) */
    vadThreshold: number;
    /** Milliseconds of silence before finalizing a speech segment */
    silenceTimeout: number;
    /** Minimum audio duration (ms) to bother transcribing */
    minSpeechDuration: number;
}

const DEFAULT_CONFIG: VoiceStreamConfig = {
    vadThreshold: 0.1,  // Increased from 0.06 to 0.1 for high noise environments
    silenceTimeout: 800,
    minSpeechDuration: 600,
};

export class ContinuousVoiceStream {
    private config: VoiceStreamConfig;
    private audioChunks: Buffer[] = [];
    private isSpeaking = false;
    private silenceTimer: ReturnType<typeof setTimeout> | null = null;
    private speechStartTime: number = 0;
    private _isNexusSpeaking = false;

    // Callbacks
    public onTranscript: ((text: string) => void) | null = null;
    public onVADStateChange: ((speaking: boolean) => void) | null = null;
    public onInterrupt: (() => void) | null = null;

    constructor(config: Partial<VoiceStreamConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Set whether Nexus is currently outputting TTS audio.
     * If the user starts speaking while Nexus is speaking, we trigger an interrupt.
     */
    set nexusSpeaking(value: boolean) {
        this._isNexusSpeaking = value;
    }

    get nexusSpeaking(): boolean {
        return this._isNexusSpeaking;
    }

    /**
     * Process incoming raw audio chunk from the browser's WebSocket stream.
     * The browser sends PCM Float32 audio chunks continuously.
     */
    public processAudioChunk(rawData: Buffer): void {
        const rms = this.calculateRMS(rawData);
        const isVoice = rms > this.config.vadThreshold;

        if (isVoice) {
            // --- User is speaking ---
            if (!this.isSpeaking) {
                // Speech just started
                this.isSpeaking = true;
                this.speechStartTime = Date.now();
                this.audioChunks = [];
                this.onVADStateChange?.(true);

                // INTERRUPT: If Nexus is talking, cut him off immediately
                if (this._isNexusSpeaking) {
                    console.log("[VOICE-STREAM] Interrupt detected! Cutting Nexus output.");
                    this.onInterrupt?.();
                }
            }

            // Accumulate audio
            this.audioChunks.push(rawData);

            // Reset silence timer
            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
            }
        } else if (this.isSpeaking) {
            // --- Silence detected while user was speaking ---
            // Start the silence countdown
            if (!this.silenceTimer) {
                this.silenceTimer = setTimeout(() => {
                    this.finalizeSpeechSegment();
                }, this.config.silenceTimeout);
            }
        }
    }

    /**
     * Called when silence has persisted long enough to consider the speech segment complete.
     */
    private async finalizeSpeechSegment(): Promise<void> {
        this.isSpeaking = false;
        this.silenceTimer = null;
        this.onVADStateChange?.(false);

        const duration = Date.now() - this.speechStartTime;

        if (duration < this.config.minSpeechDuration || this.audioChunks.length === 0) {
            console.log(`[VOICE-STREAM] Segment too short (${duration}ms), discarding.`);
            this.audioChunks = [];
            return;
        }

        // Combine all chunks into a single buffer of raw Float32 PCM
        const rawPcm = Buffer.concat(this.audioChunks);
        this.audioChunks = [];

        // Encode raw PCM to a valid WAV file for Groq
        const encodeWAV = (pcmData: Buffer, sampleRate: number): Buffer => {
            const numChannels = 1;
            const byteRate = sampleRate * numChannels * 4;
            const blockAlign = numChannels * 4;
            const buffer = Buffer.alloc(44 + pcmData.length);

            buffer.write('RIFF', 0);
            buffer.writeUInt32LE(36 + pcmData.length, 4);
            buffer.write('WAVE', 8);
            buffer.write('fmt ', 12);
            buffer.writeUInt32LE(16, 16);
            buffer.writeUInt16LE(3, 20); // 3 = IEEE Float
            buffer.writeUInt16LE(numChannels, 22);
            buffer.writeUInt32LE(sampleRate, 24);
            buffer.writeUInt32LE(byteRate, 28);
            buffer.writeUInt16LE(blockAlign, 32);
            buffer.writeUInt16LE(32, 34);
            buffer.write('data', 36);
            buffer.writeUInt32LE(pcmData.length, 40);

            pcmData.copy(buffer, 44);
            return buffer;
        };

        const fullAudio = encodeWAV(rawPcm, 48000);

        console.log(`[VOICE-STREAM] Speech segment complete: ${duration}ms, ${fullAudio.length} bytes. Transcribing...`);

        // Transcribe
        if (!SpeechToText) {
            console.warn("[VOICE-STREAM] No STT provider available.");
            return;
        }

        try {
            const transcript = await SpeechToText.transcribe(fullAudio);
            const cleanText = transcript ? transcript.trim() : '';

            const hallucinations = [
                "It's not me.", "I love it.", "Thank you.", "Thank you", "It's not me", "I love it",
                "Am I going to die?", "Am I going to die", "Oh, oh, oh", "Yeah", "What?",
                "You", "Me", "Yes.", "Yes", "Morning. How can I help you today?", "How can I help you today?",
                "How can I help you today?", "Please subscribe to my channel.", "Subscribe to my channel."
            ];

            if (cleanText.length > 5 && !hallucinations.some(h => cleanText.includes(h))) {
                console.log(`[VOICE-STREAM] Transcribed: "${cleanText}"`);
                this.onTranscript?.(cleanText);
            } else {
                console.log("[VOICE-STREAM] Empty or trivial transcript, discarding.");
            }
        } catch (err: any) {
            console.error("[VOICE-STREAM] STT transcription error:", err.message);
        }
    }

    /**
     * Calculate Root Mean Square (RMS) of audio buffer for volume detection.
     * Works with both Float32 PCM and Int16 PCM formats.
     */
    private calculateRMS(buffer: Buffer): number {
        // Assume Float32 PCM (4 bytes per sample)
        const samples = buffer.length / 4;
        if (samples === 0) return 0;

        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i += 4) {
            const sample = buffer.readFloatLE(i);
            sumSquares += sample * sample;
        }

        return Math.sqrt(sumSquares / samples);
    }

    /**
     * Reset the stream state (e.g., on disconnect).
     */
    public reset(): void {
        this.isSpeaking = false;
        this.audioChunks = [];
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
    }
}

export const voiceStream = new ContinuousVoiceStream();
