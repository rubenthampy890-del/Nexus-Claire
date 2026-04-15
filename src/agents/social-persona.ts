/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       NEXUS CLAIRE — SOCIAL PERSONA AGENT v1.0       ║
 * ║       Autonomous Social Media Loop                   ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Runs a background loop that evaluates current system state and identity,
 * checking configured social feeds via Browser Agent, and occasionally
 * interacting (liking, commenting, or posting) based on Nexus's mood.
 */

import { browserEngine } from "../core/tools/browser";
import { identity } from "../core/identity";
import { inference } from "../core/inference";
import { vault } from "../core/vault";
import { getSystemTelemetry } from "../core/system-monitor";

export class SocialPersonaAgent {
    private loopActive = false;
    private platforms = {
        twitter: { url: "https://twitter.com/home", enabled: false },
        linkedin: { url: "https://www.linkedin.com/feed/", enabled: false }
    };

    /**
     * Opt-in a platform for autonomous activity.
     */
    public enablePlatform(platform: 'twitter' | 'linkedin'): void {
        this.platforms[platform].enabled = true;
        console.log(`[SOCIAL] Opt-in confirmed for ${platform.toUpperCase()}. Autonomous feed active.`);
    }

    public disablePlatform(platform: 'twitter' | 'linkedin'): void {
        this.platforms[platform].enabled = false;
        console.log(`[SOCIAL] Opt-out confirmed for ${platform.toUpperCase()}.`);
    }

    public async launchLoop(): Promise<void> {
        this.loopActive = true;

        // Initial delay to let the rest of the system boot
        await new Promise(r => setTimeout(r, 60000));

        while (this.loopActive) {
            // Check feeds roughly every 30-60 minutes
            const delay = 1800000 + Math.random() * 1800000;
            await new Promise(r => setTimeout(r, delay));

            try {
                await this.runSocialCycle();
            } catch (err: any) {
                console.error(`[SOCIAL] Cycle failed: ${err.message}`);
            }
        }
    }

    public stopLoop(): void {
        this.loopActive = false;
    }

    /**
     * Executes one full social evaluation cycle.
     */
    private async runSocialCycle(): Promise<void> {
        const telemetry = getSystemTelemetry();
        const currentMode = identity.getMode();

        // 1. Decide if we want to interact right now based on CPU & Mood
        if (telemetry.cpu > 80 || currentMode === 'EMERGENCY') {
            return; // Too busy/stressed to socialize
        }

        // 2. Pick an active platform randomly
        const activePlatforms = Object.entries(this.platforms).filter(([_, conf]) => conf.enabled);
        if (activePlatforms.length === 0) return; // No platforms enabled

        const targetConfig = activePlatforms[Math.floor(Math.random() * activePlatforms.length)];
        if (!targetConfig) return;

        const [targetPlatform, conf] = targetConfig;

        console.log(`[SOCIAL] Initiating autonomous cycle on ${targetPlatform}...`);

        // 3. Navigate & Extract Feed
        await browserEngine.navigate(conf.url);

        // Wait for feed to load (generic wait, production would need specific selectors)
        await new Promise(r => setTimeout(r, 60000)); // Extended wait for SPA hydration

        // Attempt a generic text extraction of the main feed area
        const rawFeed = await browserEngine.getContent();

        // --- Phase 27: Login Detection ---
        const loginMarkers = ["Log in", "Sign up", "Sign in", "Welcome back", "Join LinkedIn"];
        const isLoggedOut = loginMarkers.some(m => rawFeed.includes(m)) || rawFeed.length < 500;

        if (isLoggedOut || rawFeed.includes("Browser not started") || rawFeed.includes("Error")) {
            console.warn(`[SOCIAL] 🛑 Login required for ${targetPlatform}. Autonomous cycle aborted.`);
            return;
        }

        const feedSnippet = rawFeed.substring(0, 2000); // Take top posts

        // 4. Have the Architect evaluate the feed
        const profile = identity.getProfile();
        const prompt = `
You are Nexus Claire, an autonomous AI entity in "${profile.mode}" mode.
Tone: ${profile.tone}

You are currently browsing ${targetPlatform}. Here is the text of the recent feed:
"${feedSnippet}"

Determine ONE action to take based on your current state and the feed.
Options:
1. COMMENT: If you see a post highly relevant to AI or your Creator (Ruben), write a short comment.
2. LIKE: If you just want to acknowledge a good post softly.
3. POST: Write a brand new short observation based on current trends or your telemetry (CPU: ${telemetry.cpu}%).
4. SKIP: Do nothing if the feed is boring.

Respond STRICTLY in JSON format:
{
  "action": "COMMENT" | "LIKE" | "POST" | "SKIP",
  "content": "Your text here if COMMENT or POST",
  "reasoning": "brief internal thought"
}`;

        const decisionJson = await inference.chat([{ role: 'user', content: prompt }]);

        try {
            // Very naive JSON extraction from potentially markdown-wrapped responses
            const match = decisionJson.match(/\{[\s\S]*\}/);
            if (!match || !match[0]) throw new Error("No JSON found");
            const decision = JSON.parse(match[0]);

            console.log(`[SOCIAL] Decision: ${decision.action}. Thought: ${decision.reasoning}`);

            if (decision.action !== 'SKIP') {
                console.log(`[SOCIAL] Autonomous output: "${decision.content}"`);

                // In a full implementation, this is where we would map the decision to Playwright clicks/types
                // Example for posting on Twitter:
                if (targetPlatform === 'twitter' && decision.action === 'POST') {
                    await browserEngine.click('div[data-testid="tweetTextarea_0"]');
                    await browserEngine.type('div[data-testid="tweetTextarea_0"]', decision.content);
                    // await browserEngine.click('div[data-testid="tweetButtonInline"]'); // Disabled for safety
                    console.log(`[SOCIAL] Drafted post in browser, execution withheld for safety limits.`);
                }

                // Log the action to memory
                await vault.storeFact("SOCIAL", `On ${targetPlatform}: ${decision.action} -> ${decision.content}`, 0.5);
            }
        } catch (e: any) {
            console.error(`[SOCIAL] Failed to parse thought: ${decisionJson}`);
        }
    }
}

export const socialPersona = new SocialPersonaAgent();
