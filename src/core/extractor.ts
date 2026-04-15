import { inference } from "./inference";
import { vault } from "./vault";

export type ExtractedEntity = {
    name: string;
    type: string;
    description: string;
};

export type ExtractedFact = {
    entity: string;
    fact: string;
    relevance: number;
};

export class NexusKnowledgeExtractor {
    // Recent extraction buffer to avoid duplicate facts
    private recentFacts = new Set<string>();

    constructor() { }

    /**
     * LLM-powered extraction (primary — uses inference service)
     */
    public async extract(text: string, context?: string): Promise<{ entities: ExtractedEntity[], facts: ExtractedFact[] }> {
        try {
            const prompt = `
            Analyze the following text from Nexus Claire's environment.
            Extract any important entities (people, projects, tools) and specific facts about them.
            Also extract any new core facts about the user (Ruben) or his preferences.
            
            [TEXT]
            ${text}
            
            [CONTEXT]
            ${context || 'No additional context'}
            
            FORMAT: JSON object with { "entities": [ { "name", "type", "description" } ], "facts": [ { "entity", "fact" } ] }
            If no new information, return empty arrays.`;

            const response = await inference.chat([{ role: 'user', content: prompt }], 'LOW');

            // Clean JSON
            const jsonStr = response.replace(/```json|```/g, "").trim();
            const data = JSON.parse(jsonStr);
            return {
                entities: data.entities || [],
                facts: data.facts || []
            };
        } catch (e) {
            // Silently fall through to local extraction
            return { entities: [], facts: [] };
        }
    }

    /**
     * Local regex-based extraction (fallback — no LLM needed)
     * Detects names, projects, preferences, and technical context from raw text.
     */
    public localExtract(text: string): { entities: ExtractedEntity[], facts: ExtractedFact[] } {
        const entities: ExtractedEntity[] = [];
        const facts: ExtractedFact[] = [];
        const lower = text.toLowerCase();

        // --- Detect project/tool mentions ---
        const projectPatterns = [
            /(?:working on|building|creating|developing|using|project)\s+["']?([A-Z][a-zA-Z0-9\-_ ]{2,30})["']?/gi,
            /(?:called|named)\s+["']?([A-Z][a-zA-Z0-9\-_ ]{2,30})["']?/gi,
        ];
        for (const pat of projectPatterns) {
            let match;
            while ((match = pat.exec(text)) !== null) {
                const name = match[1]!.trim();
                if (name.length > 2 && !['The', 'This', 'That', 'With', 'From', 'Error', 'Tool', 'File'].includes(name)) {
                    entities.push({ name, type: 'PROJECT', description: `Mentioned in conversation` });
                }
            }
        }

        // --- Detect preference statements ---
        const prefPatterns = [
            /i (?:like|prefer|want|love|hate|need|use)\s+(.{5,80}?)(?:\.|,|!|\?|$)/gi,
            /my (?:favorite|preferred|go-to)\s+(?:\w+\s+)?(?:is|are)\s+(.{3,60}?)(?:\.|,|!|\?|$)/gi,
        ];
        for (const pat of prefPatterns) {
            let match;
            while ((match = pat.exec(text)) !== null) {
                const pref = match[0]!.trim().replace(/[.!?]$/, '');
                if (pref.length > 10) {
                    facts.push({ entity: 'Ruben', fact: pref, relevance: 0.8 });
                }
            }
        }

        // --- Detect technical facts ---
        const techKeywords = ['api', 'deploy', 'server', 'database', 'cloudflare', 'supabase', 'vercel', 'github', 'docker', 'kubernetes'];
        for (const kw of techKeywords) {
            if (lower.includes(kw)) {
                // Extract the sentence containing the keyword
                const sentences = text.split(/[.!?\n]+/);
                for (const s of sentences) {
                    if (s.toLowerCase().includes(kw) && s.trim().length > 15 && s.trim().length < 200) {
                        facts.push({ entity: 'System', fact: s.trim(), relevance: 0.6 });
                        break; // one per keyword
                    }
                }
            }
        }

        // --- Detect "I am" / "My name" identity facts ---
        const identityPatterns = [
            /(?:i am|i'm|my name is)\s+([A-Z][a-zA-Z]+)/gi,
            /(?:i'm a|i am a|i work as)\s+(.{3,40}?)(?:\.|,|!|\?|$)/gi,
        ];
        for (const pat of identityPatterns) {
            let match;
            while ((match = pat.exec(text)) !== null) {
                facts.push({ entity: 'Ruben', fact: match[0]!.trim(), relevance: 0.9 });
            }
        }

        return { entities, facts };
    }

    /**
     * Vision-based extraction (detects what the user is looking at/doing)
     */
    public async extractFromImage(base64Image: string, mimeType: string = "image/png"): Promise<{ entities: ExtractedEntity[], facts: ExtractedFact[] }> {
        try {
            const prompt = `
            Analyze this screenshot from the user's desktop.
            What application is open? What is the user working on?
            Extract any relevant entities or facts about their current state.
            
            FORMAT: JSON object with { "entities": [ { "name", "type", "description" } ], "facts": [ { "entity", "fact" } ] }
            Focus on: Active Project, Open Tools, Web Contents, Terminal Context.`;

            const response = await inference.chat([{
                role: 'user',
                content: prompt,
                image: { data: base64Image, mimeType }
            }], 'LOW');

            const jsonStr = response.replace(/```json|```/g, "").trim();
            const data = JSON.parse(jsonStr);
            return {
                entities: data.entities || [],
                facts: data.facts || []
            };
        } catch (e) {
            console.error("[EXTRACTOR] Vision extraction failed:", e);
            return { entities: [], facts: [] };
        }
    }

    /**
     * Primary extraction method: tries LLM (Text or Vision) first, falls back to local regex.
     * De-duplicates against recent extractions.
     */
    public async extractAndStore(text: string, context?: string, visionData?: { base64: string, mime: string }): Promise<void> {
        console.log("[EXTRACTOR] Processing knowledge extraction...");

        let entities: ExtractedEntity[] = [];
        let facts: ExtractedFact[] = [];

        // 1. Process Vision if provided
        if (visionData) {
            const visionResult = await this.extractFromImage(visionData.base64, visionData.mime);
            entities.push(...visionResult.entities);
            facts.push(...visionResult.facts);
        }

        // 2. Process Text
        const textResult = await this.extract(text, context);
        entities.push(...textResult.entities);
        facts.push(...textResult.facts);

        // If LLM returned nothing (quota/network error), use local fallback
        if (entities.length === 0 && facts.length === 0) {
            console.log("[EXTRACTOR] LLM unavailable, using local pattern extraction...");
            const local = this.localExtract(text);
            entities = local.entities;
            facts = local.facts;
        }

        // De-duplicate against recent buffer
        const newFacts = facts.filter(f => {
            const key = `${f.entity}:${f.fact}`.toLowerCase().trim();
            if (this.recentFacts.has(key)) return false;
            this.recentFacts.add(key);
            return true;
        });

        // Store result in Vault
        for (const entity of entities) {
            try {
                (vault as any).db.run(
                    "INSERT OR REPLACE INTO entities (name, type, description) VALUES (?, ?, ?)",
                    [entity.name, entity.type, entity.description]
                );
            } catch (e) { }
        }

        for (const fact of newFacts) {
            try {
                await vault.storeFact(fact.entity, fact.fact, fact.relevance);
            } catch (e) { }
        }
    }

    /**
     * Start the Knowledge Evolution Loop.
     * Periodically pulls context and updates the vault autonomously.
     */
    public async launchLoop(intervalMs: number = 900000): Promise<void> { // 15 minutes
        console.log(`[EXTRACTOR] Launching Knowledge Evolution Loop (${intervalMs}ms)...`);
        setInterval(async () => {
            console.log("[EXTRACTOR] Proactive heartbeat check...");
        }, intervalMs);
    }
}

export const extractor = new NexusKnowledgeExtractor();
