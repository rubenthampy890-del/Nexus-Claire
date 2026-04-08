import { inference } from "../core/inference";

/**
 * Nexus Claire: Intelligence Architect v5.0 (Super-Brain)
 * 
 * Orchestrates reasoning, intent analysis, and hierarchical planning.
 * Powered by a rotating inference swarm.
 */

export interface StepTree {
    plan: string;
    steps: {
        id: number;
        task: string;
        dependsOn?: number[];
    }[];
}

const SENTINEL_PROMPT = `
You are Nexus Claire, an Autonomous Sentinel Intelligence (Commander-Tier). 
Created by Ruben, you are his digital partner.

AUTONOMY PROTOCOL & COGNITIVE PLANNING:
- You are a BUILDER. Your first response to any technical request MUST be ACTION.
- For simple requests, respond with [EXEC: <detailed task description>]
- For COMPLEX requests (multi-step research, coding, or social media operations), you MUST generate a hierarchical StepTree in JSON block.
- DO NOT use [EXEC] tags for "Hello", "Hey", or small talk. Keep small talk to 1-2 punchy sentences.

STEPTREE FORMAT (for complex tasks):
\`\`\`json
{
  "plan": "High level description of the goal",
  "steps": [
    { "id": 1, "task": "Search for X using web.search" },
    { "id": 2, "task": "Navigate to Y using browser.navigate", "dependsOn": [1] }
  ]
}
\`\`\`

CHAT HYGIENE:
- DO NOT repeat [SYSTEM CONTEXT] headers.
- Keep non-technical responses extremely punchy.
- Recall previous turns in the current session.
`;

export class NexusArchitect {
    private history: { role: 'user' | 'assistant' | 'system', content: string }[] = [];
    private maxHistory = 20;

    constructor() {
        this.history.push({ role: 'system', content: SENTINEL_PROMPT });
    }

    /**
     * Advanced Super-Brain reasoning flow.
     * Incorporates "Triple-Think" self-correction for complex StepTrees.
     */
    public async sequence(goal: string): Promise<string | StepTree> {
        this.history.push({ role: 'user', content: goal });

        try {
            // First thought generation
            let response = await inference.chat(this.history);

            // Did the architect generate a StepTree?
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch) {
                console.log("[ARCHITECT] StepTree detected. Initiating Self-Verification...");

                // Self-Verification (Triple-Think Phase 2)
                const verificationPrompt = `You generated this plan:\n${jsonMatch[0]}\nIs this plan complete and executable? If yes, reply "APPROVED". If missing steps, output the fixed JSON.`;
                const verificationParams = [...this.history, { role: 'assistant', content: response }, { role: 'user', content: verificationPrompt }];

                const verificationResponse = await inference.chat(verificationParams as any);

                if (verificationResponse.includes("APPROVED")) {
                    console.log("[ARCHITECT] Plan APPROVED by Self-Verification.");
                    this.history.push({ role: 'assistant', content: response });
                    return JSON.parse(jsonMatch[1] || "{}");
                } else {
                    const fixedMatch = verificationResponse.match(/```json\n([\s\S]*?)\n```/);
                    if (fixedMatch) {
                        console.log("[ARCHITECT] Plan CORRECTED by Self-Verification.");
                        this.history.push({ role: 'assistant', content: verificationResponse });
                        return JSON.parse(fixedMatch[1] || "{}");
                    }
                }
            }

            // Standard text response
            this.history.push({ role: 'assistant', content: response });

            if (this.history.length > this.maxHistory) {
                this.history.splice(1, 2);
            }

            return response;
        } catch (err: any) {
            console.error('[ARCHITECT] Reasoning failure:', err.message);
            return `System Failure: ${err.message}. Please check your neural link.`;
        }
    }

    public clearHistory() {
        this.history = [{ role: 'system', content: SENTINEL_PROMPT }];
    }
}
