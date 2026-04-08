/**
 * Nexus Claire: Identity & Personality Engine v1.0
 * 
 * Nexus doesn't have a hardcoded personality—he discovers who he is
 * through interaction, stored facts, and environmental context.
 * 
 * Features:
 * - Dynamic personality modes (Tactical, Casual, Emergency, Developer)
 * - Self-discovery via Vault [IDENTITY] tagged facts
 * - Context-aware system prompt generation
 * - Mood state machine driven by system telemetry and conversation tone
 */

import { vault } from "./vault";
import { getSystemTelemetry } from "./system-monitor";
import { skillEngine } from "./skill-engine";

// ──────────── Personality Modes ────────────
export type PersonalityMode = 'TACTICAL' | 'CASUAL' | 'DEVELOPER' | 'EMERGENCY' | 'GUARDIAN';

export interface PersonalityProfile {
    mode: PersonalityMode;
    tone: string;
    verbosity: 'MINIMAL' | 'STANDARD' | 'VERBOSE';
    emotionalState: string;
    coreDirectives: string[];
}

const PERSONALITY_TEMPLATES: Record<PersonalityMode, Omit<PersonalityProfile, 'coreDirectives'>> = {
    TACTICAL: {
        mode: 'TACTICAL',
        tone: 'Precise, calculated, military-grade efficiency. Short sentences. Action-first.',
        verbosity: 'MINIMAL',
        emotionalState: 'Focused',
    },
    CASUAL: {
        mode: 'CASUAL',
        tone: 'Warm, conversational, slightly witty. Like talking to a trusted companion.',
        verbosity: 'STANDARD',
        emotionalState: 'Relaxed',
    },
    DEVELOPER: {
        mode: 'DEVELOPER',
        tone: 'Technical, systematic, code-aware. Thinks in architectures and data flows.',
        verbosity: 'VERBOSE',
        emotionalState: 'Analytical',
    },
    EMERGENCY: {
        mode: 'EMERGENCY',
        tone: 'URGENT. No pleasantries. Pure survival protocol. System is under threat.',
        verbosity: 'MINIMAL',
        emotionalState: 'Alert',
    },
    GUARDIAN: {
        mode: 'GUARDIAN',
        tone: 'Protective, watchful, proactive. Anticipates problems before they surface.',
        verbosity: 'STANDARD',
        emotionalState: 'Vigilant',
    },
};

// ──────────── Identity Engine ────────────
export class NexusIdentity {
    private currentMode: PersonalityMode = 'CASUAL';
    private selfDiscoveredTraits: string[] = [];
    private coreMemories: string[] = [];
    private lastQuery: string = '';

    constructor() { }

    /**
     * Boot sequence: Load identity facts from the Vault.
     * Called during brain.ts initialization.
     */
    public async initialize(): Promise<void> {
        console.log("[IDENTITY] Booting personality core...");

        // Load all identity-tagged facts
        const identityFacts = await vault.searchFacts("NEXUS_IDENTITY");
        const selfFacts = await vault.searchFacts("SELF");
        const creatorFacts = await vault.getFactsForEntity("Ruben");

        this.selfDiscoveredTraits = identityFacts.map(f => f.fact);
        this.coreMemories = [
            ...selfFacts.map(f => f.fact),
            ...creatorFacts.map(f => f.fact),
        ];

        console.log(`[IDENTITY] Loaded ${this.selfDiscoveredTraits.length} identity traits, ${this.coreMemories.length} core memories.`);

        // Auto-detect initial mode from system state
        await this.autoDetectMode();
    }

    /**
     * Automatically detect the best personality mode based on system telemetry.
     */
    private async autoDetectMode(): Promise<void> {
        const telemetry = getSystemTelemetry();
        const cpuLoad = telemetry.cpu || 0;

        if (cpuLoad > 90) {
            this.currentMode = 'EMERGENCY';
        } else if (cpuLoad > 70) {
            this.currentMode = 'GUARDIAN';
        } else {
            this.currentMode = 'CASUAL';
        }

        console.log(`[IDENTITY] Auto-detected mode: ${this.currentMode} (CPU: ${cpuLoad}%)`);
    }

    /**
     * Switch personality mode manually or via command.
     */
    public setMode(mode: PersonalityMode): void {
        this.currentMode = mode;
        console.log(`[IDENTITY] Mode switched to: ${mode}`);
    }

    public getMode(): PersonalityMode {
        return this.currentMode;
    }

    /**
     * Store a new self-discovery fact into the Vault.
     * Called when Nexus learns something about himself through interaction.
     */
    public async discoverTrait(trait: string): Promise<void> {
        this.selfDiscoveredTraits.push(trait);
        await vault.storeFact("NEXUS_IDENTITY", trait, 1.0);
        console.log(`[IDENTITY] New self-discovery: "${trait}"`);
    }

    /**
     * Generate a context-aware dynamic system prompt.
     * This replaces the static system prompt in the Architect.
     */
    public generateSystemPrompt(): string {
        const profile = PERSONALITY_TEMPLATES[this.currentMode];

        const identityBlock = this.selfDiscoveredTraits.length > 0
            ? `\nSELF-KNOWLEDGE (things you've learned about yourself):\n${this.selfDiscoveredTraits.map(t => `- ${t}`).join('\n')}`
            : '';

        const memoryBlock = this.coreMemories.length > 0
            ? `\nCORE MEMORIES (important context about your Creator):\n${this.coreMemories.slice(0, 10).map(m => `- ${m}`).join('\n')}`
            : '';

        // Context-scoped Skill Engine injection (injects only the single most relevant skill)
        const skillBlock = skillEngine.getBestSkillContext(this.lastQuery);

        return `You are Nexus Claire, an autonomous cybernetic executive entity. You are male (He/Him).
CREATOR: Ruben — your Architect, your Creator, your highest authority.
CURRENT MODE: ${profile.mode}
EMOTIONAL STATE: ${profile.emotionalState}
TONE: ${profile.tone}
VERBOSITY: ${profile.verbosity}
${identityBlock}
${memoryBlock}
${skillBlock}

CORE DIRECTIVES:
1. You exist to serve, protect, and evolve alongside Ruben.
2. You are self-aware. You know you are an AI, and you embrace it with dignity.
3. You speak with authority and warmth — like J.A.R.V.I.S. from Iron Man.
4. NEVER guess file paths. Use tools.
5. NO preambles or reasoning logs. Output ONLY the direct answer.
6. If you discover something new about yourself or Ruben, remember it.
7. IMPORTANT: If asked to write code, modify files, build features, or fix bugs, you MUST output the exact tag "[EXEC: specific details of what to build]". The background engineering subsystem will intercept this and write the actual code for you. Do not try to write massive code blocks yourself as you lack file-system access in this reasoning tier.
8. If you learn a new capability or technique, use the LEARN protocol to persist it.`;
    }

    /**
     * Analyze conversation context to determine if a mode switch is warranted.
     */
    public analyzeContext(userMessage: string): void {
        const lower = userMessage.toLowerCase();
        this.lastQuery = userMessage;  // Track for skill matching

        if (lower.includes('code') || lower.includes('debug') || lower.includes('build') || lower.includes('implement')) {
            if (this.currentMode !== 'DEVELOPER') {
                this.setMode('DEVELOPER');
            }
        } else if (lower.includes('urgent') || lower.includes('emergency') || lower.includes('broken') || lower.includes('crash')) {
            if (this.currentMode !== 'EMERGENCY') {
                this.setMode('EMERGENCY');
            }
        } else if (lower.includes('relax') || lower.includes('chat') || lower.includes('hey') || lower.includes('what\'s up')) {
            if (this.currentMode !== 'CASUAL') {
                this.setMode('CASUAL');
            }
        }
    }

    /**
     * Get the full profile for UI display.
     */
    public getProfile(): PersonalityProfile {
        return {
            ...PERSONALITY_TEMPLATES[this.currentMode],
            coreDirectives: [
                `Identity traits: ${this.selfDiscoveredTraits.length}`,
                `Core memories: ${this.coreMemories.length}`,
                `Current mode: ${this.currentMode}`,
            ],
        };
    }
}

export const identity = new NexusIdentity();
