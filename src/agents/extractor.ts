import { GoogleGenAI } from "@google/genai";

/**
 * The Extractor: A background agent that parses chat history to extract facts into the Vault.
 * This runs asynchronously after each interaction to avoid blocking the main chat.
 */
export class VaultExtractor {
    private geminiClient: GoogleGenAI;
    private modelId = "gemini-1.5-flash"; // Fast & cheap for extraction

    constructor() {
        const geminiKey = process.env.GEMINI_API_KEY || "";
        this.geminiClient = new GoogleGenAI({ apiKey: geminiKey });
    }

    public async extractFacts(chatHistory: string): Promise<{ entity: string, fact: string }[]> {
        try {
            const prompt = `
            Analyze the following chat history between Ruben (the Creator) and Nexus Claire (the AI).
            Extract any permanent facts about Ruben, his preferences, projects, or environment.
            
            FORMAT: JSON array of { "entity": string, "fact": string }
            RULES:
            - Focus on long-term value (preferences, names, project details).
            - Keep facts concise.
            - If no new facts, return [].
            
            CHAT HISTORY:
            ${chatHistory}
            
            JSON OUTPUT:`;

            const response = await this.geminiClient.models.generateContent({
                model: this.modelId,
                contents: prompt
            });
            const text = response.text || "";

            // Clean JSON
            const jsonStr = text.replace(/```json|```/g, "").trim();
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("[EXTRACTOR] Failed to extract facts:", e);
            return [];
        }
    }
}
