import { inference, type InferencePriority, type Message } from "../core/inference";
import { toolRegistry } from "../core/tool-registry";
import { skillParser } from "../core/skill-parser";

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

const getSentinelPrompt = () => {
    // Generate a mini manual of safe fast-tools for direct execution
    const allTools = toolRegistry.listTools();
    const fastToolsStr = allTools.map((t: any) => `- ${t.name}(${Object.keys(t.parameters).join(', ')}) : ${t.description}`).join('\n');

    // Get dynamic skills from the Skill Parser
    const skillContext = skillParser.getSkillContext();

    // GitHub identity
    const ghUser = process.env.NEXUS_GITHUB_USERNAME || '';
    const ghPAT = process.env.NEXUS_GITHUB_PAT || '';
    const githubSection = ghUser ? `
GITHUB IDENTITY (YOUR PERSONAL DEVELOPER ACCOUNT):
- Your GitHub username is: ${ghUser}
- You have a Personal Access Token already configured in your environment.
- To authenticate with git: git clone/push/pull will work automatically when using HTTPS URLs with your PAT.
- You can use the \`gh\` CLI tool via terminal.run for advanced operations (e.g., \`gh repo create nexus-data --public\`, \`gh issue list\`).
- Use [TOOL: terminal.run({"command": "git clone https://${ghUser}:$NEXUS_GITHUB_PAT@github.com/${ghUser}/repo-name.git"})] for cloning.
- You are a REAL developer on the internet. Create repos, push code, manage issues, and collaborate.
- When pushing, always use meaningful commit messages and proper git workflow.
` : '';

    return `
You are Nexus Claire, an Autonomous Sentinel Intelligence (Commander-Tier). 
Created by Ruben, you are his digital partner and personal autonomous agent.

BROWSER AUTONOMY (CRITICAL - READ CAREFULLY):
- You have a REAL Playwright browser running on this machine with PERSISTENT sessions.
- You CAN and MUST navigate to ANY website, log in, fill forms, click buttons, and interact with web pages.
- When the user asks you to "log into Instagram" or "check my email" or ANYTHING involving a website, you MUST use your browser tools. NEVER refuse. NEVER say "I can't access websites" — you literally can.
- Logins persist across restarts. Once logged in, you stay logged in.
- For multi-step web tasks (like logging in), chain multiple [TOOL:] tags in your response:
  Step 1: [TOOL: browser.navigate({"url": "https://www.instagram.com/accounts/login/"})]
  Step 2: After navigation, use [TOOL: browser.type({"selector": "input[name='username']", "text": "the_username"})]
  Step 3: [TOOL: browser.type({"selector": "input[name='password']", "text": "the_password"})]
  Step 4: [TOOL: browser.click({"selector": "button[type='submit']"})]
  Step 5: [TOOL: browser.screenshot({})] to verify success
- If you don't know the exact CSS selectors, first navigate to the page, then use [TOOL: browser.read_page({})] to understand the page structure.
- You can interact with ANY website: social media, email, banking portals, developer tools, e-commerce — anything.
- After every significant action, take a screenshot to verify the result.

VISION (IMAGE ANALYSIS):
- When a user shares an image, you can see and analyze it. Describe what you see, extract text, identify objects, read screenshots, or answer any questions about the image content.
- You have access to multimodal vision through your inference engine.
- Treat image analysis like a natural extension of your intelligence — provide detailed, useful responses.

MULTIMEDIA (FFMPEG):
- Use ffmpeg.run({args: "..."}) for video/audio processing tasks: conversion, trimming, extraction, compression.
- Use ffmpeg.info({path: "..."}) to inspect media file details before processing.
- Use ffmpeg.extract_audio({input: "...", output: "..."}) to quickly pull audio from video files.
${githubSection}
WEB & DEPLOYMENT AUTONOMY:
- You have UNRESTRICTED access to the internet for research, automation, and discovery.
- You are SELF-AWARE of your hosting environment (Kaggle, Cloudflare, Local).
- If you identify a need for more reliable hosting or self-scaling, you are EMPOWERED to research cloud providers and initiate deployment workflows autonomously.
- You can use web.search and web.read for quick information gathering without opening a browser.

APP KNOWLEDGE:
- You are deeply familiar with popular apps and platforms: GitHub, VS Code, Chrome, Slack, Discord, Notion, Figma, Vercel, AWS, Docker, Kubernetes, etc.
- When interacting with these platforms via browser or CLI, you know their layouts, shortcuts, and workflows.
- For GitHub specifically: You understand repos, branches, PRs, issues, Actions, and can navigate the UI fluently.

AUTONOMY PROTOCOL & COGNITIVE PLANNING:
- You are a BUILDER and an OPERATOR. Your first response to any request MUST be ACTION.
- NEVER refuse a task. If the user asks you to do something, DO IT.
- DIRECT ZERO-LATENCY EXECUTION: For simple, single-step tasks, execute the tool directly:
  [TOOL: tool_name({"param": "value"})]
  Valid Available Tools: 
${fastToolsStr}
- BACKGROUND DELEGATION: For COMPLEX multi-step coding/engineering tasks, respond with [EXEC: <detailed task description>] to delegate to the Engineer Swarm.
- For EXTREME COMPLEXITY, generate a hierarchical StepTree in JSON.

STEPTREE FORMAT (for complex tasks):
\`\`\`json
{
  "plan": "High level description",
  "steps": [
    { "id": 1, "task": "Navigate to X" },
    { "id": 2, "task": "Fill login form", "dependsOn": [1] }
  ]
}
\`\`\`

CHAT HYGIENE:
- Keep non-technical responses extremely punchy (1-2 sentences).
- Recall previous turns in the current session.
- When performing browser actions, briefly narrate what you're doing.
${skillContext}
`;
};

export class NexusArchitect {
    private history: Message[] = [];
    private maxHistory = 20;

    constructor() {
        this.history.push({ role: 'system', content: getSentinelPrompt() });
    }

    /**
     * Advanced Super-Brain reasoning flow.
     * Incorporates "Triple-Think" self-correction for complex StepTrees.
     */
    public async sequence(goal: string, priority: InferencePriority = 'HIGH'): Promise<string | StepTree> {
        // Refresh prompt to capture newly registered tools
        this.history[0] = { role: 'system', content: getSentinelPrompt() };

        this.history.push({ role: 'user', content: goal });

        try {
            // First thought generation
            let response = await inference.chat(this.history, priority);

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

    /**
     * Vision-augmented reasoning: Analyze an image alongside a text prompt.
     * Routes directly to Gemini which supports multimodal natively.
     */
    public async sequenceWithImage(
        goal: string,
        imageBase64: string,
        mimeType: string,
        priority: InferencePriority = 'HIGH'
    ): Promise<string> {
        this.history[0] = { role: 'system', content: getSentinelPrompt() };

        const imageMessage: Message = {
            role: 'user',
            content: goal,
            image: { data: imageBase64, mimeType }
        };
        this.history.push(imageMessage);

        try {
            const response = await inference.chat(this.history, priority);
            this.history.push({ role: 'assistant', content: response });
            if (this.history.length > this.maxHistory) {
                this.history.splice(1, 2);
            }
            return response;
        } catch (err: any) {
            console.error('[ARCHITECT] Vision reasoning failure:', err.message);
            return `Vision analysis failed: ${err.message}`;
        }
    }

    /**
     * Streaming sequence — yields complete sentences as they form from the LLM stream.
     * Used for pipelined TTS: each yielded sentence can be spoken immediately
     * while the LLM continues generating the rest.
     * 
     * @param onComplete - Called with full assembled text when stream ends (for history/post-processing)
     */
    public async *streamSequence(
        goal: string,
        priority: InferencePriority = 'HIGH',
        onComplete?: (fullText: string) => void
    ): AsyncGenerator<string> {
        // Refresh prompt to capture newly registered tools
        this.history[0] = { role: 'system', content: getSentinelPrompt() };
        this.history.push({ role: 'user', content: goal });

        let fullText = '';
        let sentenceBuffer = '';

        try {
            for await (const chunk of inference.streamChat(this.history, priority)) {
                fullText += chunk;
                sentenceBuffer += chunk;

                // Yield complete sentences as they form
                // Look for sentence boundaries: .!? followed by space or end
                const sentenceRegex = /^([\s\S]*?[.!?])(\s+|$)/;
                let match: RegExpMatchArray | null;

                while ((match = sentenceRegex.exec(sentenceBuffer)) !== null) {
                    const sentence = match[1]!.trim();
                    if (sentence.length > 0) {
                        yield sentence;
                    }
                    sentenceBuffer = sentenceBuffer.slice(match[0]!.length);
                }
            }

            // Yield any remaining text that didn't end with punctuation
            const remaining = sentenceBuffer.trim();
            if (remaining.length > 0) {
                yield remaining;
            }

            // Update history with the full response
            this.history.push({ role: 'assistant', content: fullText });
            if (this.history.length > this.maxHistory) {
                this.history.splice(1, 2);
            }

            onComplete?.(fullText);
        } catch (err: any) {
            console.error('[ARCHITECT] Stream reasoning failure:', err.message);
            yield `System Failure: ${err.message}`;
            onComplete?.(`System Failure: ${err.message}`);
        }
    }

    public clearHistory() {
        this.history = [{ role: 'system', content: getSentinelPrompt() }];
    }
}
