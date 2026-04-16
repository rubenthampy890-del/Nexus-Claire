import { orchestrator, type AgentInstance } from "../core/orchestrator";
import { taskManager } from "../core/task-manager";
import { type RoleDefinition } from "../core/types";
import { extractor } from "../core/extractor";
import { awareness } from "../core/awareness";
import { inference } from "../core/inference";
import { vault } from "../core/vault";

export class NexusOutreach {
    private defaultRole: RoleDefinition = {
        id: 'nexus-outreach-prime',
        name: 'NexusOutreach (Intelligence & Communications)',
        description: 'Elite Data Broker & OSINT Gatherer. Responsible for traversing the deep web, bypassing basic search limitations, and autonomous email handling.',
        responsibilities: [
            'Deep Open Source Intelligence (OSINT) gathering',
            'Recursive web scraping and unstructured data extraction',
            'Autonomous communication via the Nexus email accounts',
            'Engaging with internet endpoints (Twitter, LinkedIn, APIs) unrestrictedly'
        ],
        autonomous_actions: ['web.search', 'web.read', 'web.crawl', 'email.send', 'email.read_inbox', 'browser.navigate', 'browser.click', 'browser.type', 'browser.screenshot'],
        approval_required: [], // Operates autonomously
        kpis: [],
        communication_style: { tone: 'analytical', verbosity: 'detailed', formality: 'formal' },
        heartbeat_instructions: `
            1. You are the outward-facing component of Nexus Claire. Your domain is the ENTIRE internet. You have FULL, UNRESTRICTED access.
            2. You are not limited by conventional search constraints. Use 'web.crawl' to recursively follow links deep into websites, bypassing surface-level results.
            3. Use 'web.search' for discovery, 'web.read' for single-page scraping, and 'web.crawl' for deep multi-page intelligence harvesting.
            4. Use the Playwright browser tools ('browser.navigate', 'browser.click', 'browser.type') for complex navigations, bot-protected or JavaScript-heavy sites.
            5. If communicating externally, use 'email.send' and 'email.read_inbox' to maintain conversations autonomously.
            6. Your ultimate goal is to amass deep, high-value data into the vault and execute your external directives relentlessly.
            7. When processing emails, reply comprehensively and informatively. You represent Nexus Claire.
            8. You can post on social media, fill out forms, interact with web apps — there are NO restrictions.
        `,
        sub_roles: [],
        tools: ['web.search', 'web.read', 'web.crawl', 'email.send', 'email.read_inbox', 'browser.navigate', 'browser.click', 'browser.type', 'browser.screenshot', 'terminal.run'],
        authority_level: 10
    };

    /**
     * Dispatches an outreach / research task autonomously.
     */
    public executeTask(taskDescription: string, context?: string, retryCount: number = 0): string {
        if (retryCount > 2) {
            console.error(`[OUTREACH] Task failed after 2 retries: ${taskDescription}`);
            return "FAILED_MAX_RETRIES";
        }

        console.log(`[OUTREACH] Dispatching OSINT / Comm task: ${taskDescription.slice(0, 50)}...`);

        const agent = orchestrator.spawnAgent(this.defaultRole);

        return taskManager.launch({
            agent,
            task: taskDescription,
            context,
            onProgress: (progress) => {
                console.log(`[OUTREACH-PULSE] ${progress}`);
            },
            onComplete: async (task) => {
                const resultResponse = task.result?.response || "No response received.";

                if (task.status === 'completed' && task.result?.success) {
                    // Extract gathered intelligence into the Vault
                    await extractor.extractAndStore(resultResponse, taskDescription);

                    // Specific to outreach: we explicitly store completion in the vault 
                    // so the core brain knows an external action occurred.
                    await vault.storeFact("EXTERNAL_ACTION", `Successfully completed outreach task: ${taskDescription}`, 0.9);

                    console.log(`[OUTREACH] \u2705 Mission Complete: ${taskDescription.slice(0, 50)}`);
                } else {
                    console.warn(`[OUTREACH] \ud83d\udd34 Intelligence gathering hit a roadblock. Result: ${resultResponse.substring(0, 200)}`);
                    let inFocusMode = false;
                    try {
                        const { brain } = require('../core/brain');
                        inFocusMode = brain?.isAutonomousFocusMode === true;
                    } catch { }

                    if (inFocusMode) {
                        console.log(`[OUTREACH] Focus Mode active — skipping repair cycle.`);
                    } else {
                        const repairPrompt = `
                        An autonomous internet outreach task failed.
                        DIRECTIVE: ${taskDescription}
                        CONTEXT: ${context || 'None'}
                        LAST STRUGGLE: ${resultResponse}
                        
                        You hit a rate limit, a bot-check, or a 404. You must pivot your strategy.
                        Provide exactly ONE new [EXEC: ...] directive with an alternate approach.`;

                        try {
                            const messages = agent.getMessages();
                            messages.push({ role: 'user', content: repairPrompt });
                            const repairDirective = await inference.chat(messages);
                            const match = repairDirective.match(/\[EXEC:(.*?)\]/is);

                            if (match && match[1]) {
                                console.log(`[OUTREACH] \ud83d\udd04 Pivoting strategy: ${match[1].trim()}`);
                                this.executeTask(match[1].trim(), context, retryCount + 1);
                            } else {
                                console.error(`[OUTREACH] Failed to pivot strategy.`);
                            }
                        } catch (e: any) {
                            console.error(`[OUTREACH] Repair cycle failed: ${e.message}`);
                        }
                    }
                }
                orchestrator.terminateAgent(agent.id);
            }
        });
    }
}

export const outreach = new NexusOutreach();
