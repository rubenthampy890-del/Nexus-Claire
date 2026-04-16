import { getSystemTelemetry } from "./system-monitor";
import { vault } from "./vault";
import { outreach } from "../agents/outreach";
import { toolRegistry } from "./tool-registry";

export class OutreachLoop {
    private loopActive = false;

    public async launchLoop(): Promise<void> {
        this.loopActive = true;
        console.log(`[OUTREACH-LOOP] 🌍 Starting Unrestricted Internet Outreach background loop...`);

        // Wait a few seconds for the system/inference to fully boot
        await new Promise(r => setTimeout(r, 60000));

        while (this.loopActive) {
            // Check emails and perform research every ~20 minutes
            const delay = 1200000 + Math.random() * 600000;

            try {
                // Focus Mode Check
                let inFocusMode = false;
                try {
                    const { brain } = require('../core/brain');
                    inFocusMode = brain?.isAutonomousFocusMode === true;
                } catch { }

                if (inFocusMode) {
                    await new Promise(r => setTimeout(r, 60000));
                    continue; // Skip outreach while an Extreme Engineering Audit is happening
                }

                await this.runOutreachCycle();
            } catch (err: any) {
                console.error(`[OUTREACH-LOOP] Cycle failed: ${err.message}`);
            }

            await new Promise(r => setTimeout(r, delay));
        }
    }

    public stopLoop(): void {
        this.loopActive = false;
    }

    private async runOutreachCycle(): Promise<void> {
        // 1. Check Inbox Autonomous Mode
        console.log(`[OUTREACH-LOOP] 📥 Checking email inbox for incoming requests or data...`);
        const readInboxTool = toolRegistry.getTool('email.read_inbox');

        let inboxData = "Inbox empty or unreadable.";
        if (readInboxTool) {
            try {
                // Fetch the latest 3 emails
                const result = await readInboxTool.execute({ limit: 3 });
                if (typeof result === 'string') {
                    inboxData = result;
                } else {
                    inboxData = JSON.stringify(result);
                }
            } catch (e: any) {
                console.error(`[OUTREACH-LOOP] Failed to execute email.read_inbox: ${e.message}`);
            }
        }

        // 2. Identify Topics of Interest
        // Pull recent Vault facts to see what Nexus should be researching
        const recentFacts = await vault.getAllFacts();
        const keywords = recentFacts.slice(0, 5).map(f => f.fact).join(" | ");

        // 3. Dispatch the Agent
        // We instruct the Outreach Agent to read its inbox and perform OSINT gathering.
        const directive = `
            You are the Nexus Outreach Agent. Your task for this cycle is:
            1. Read this incoming INBOX DATA: ${inboxData}
            2. If there are any urgent emails directed at you, use 'email.send' to reply to the sender intelligently.
            3. If the inbox requires no action, perform a deep web search ('web.search', 'browser.navigate') on a topic related to this internal context: [${keywords}].
            4. Extract the most important insights and complete the task.
        `;

        outreach.executeTask(directive.trim(), "AUTONOMOUS_OUTREACH_CYCLE");
    }
}

export const outreachLoop = new OutreachLoop();
