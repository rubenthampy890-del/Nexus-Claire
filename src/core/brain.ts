import { serve, type ServerWebSocket } from "bun";
import { NexusArchitect } from "../agents/architect";
import { NexusCoder } from "../agents/coder";
import { inference } from "./inference";
import { VoiceEngine, SpeechToText, splitIntoSentences } from "./voice";
import { GoalManager } from "./goals/goal-manager";
import { getSystemTelemetry } from "./system-monitor";
import { vault } from "./vault";
import { NexusCLI } from "./cli-ui";
import type { Service } from "./services/service-registry";
import { engineer } from "../agents/engineer";
import { identity } from "./identity";
import { PlatformUtils } from "./platform";
import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { skillEngine } from "./skill-engine";
import { socialPersona } from "../agents/social-persona";
import { TelemetryBot } from "../services/telemetry-bot";
import { WhatsAppBridge } from "../services/whatsapp-bridge";
import { registerBuiltinTools } from "./tools/builtin";
import { registerDeveloperTools, loadGeneratedTools } from "./tools/developer";
import { registerSourceControlTools } from "./tools/source-control";
import { registerWebTools } from "./tools/web";
import { registerGitHubTools } from "./tools/github";
import { registerAppleScriptTools } from "./tools/applescript";
import { registerBrowserTools, browserEngine } from "./tools/browser";
import { registerFFmpegTools } from "./tools/ffmpeg";
import { skillParser } from "./skill-parser";
import { awareness } from "./awareness";
import { extractor } from "./extractor";
import { taskManager } from "./task-manager";
import { swarmManager } from "./swarm-manager";
import { orchestrator } from "./orchestrator";
import { sandbox } from "./sandbox";
import { nexusCritic } from "./critic";
import { toolFactory } from "./tool-factory";
import { toolRegistry } from "./tool-registry";
import { userFinder } from "./user-finder";
import { startBridge, setBrainRef } from "./bridge";
import { NeuralLink } from "./link";
import { onboardManager } from "./onboard";


/**
 * Nexus Claire: Brain v2.0
 * 
 * Modular, service-oriented architecture.
 * - ChatService: handles user interactions (sub-100ms latency)
 * - GoalService: autonomous background goal pursuit
 * - VoiceService: ElevenLabs TTS + Groq STT pipeline
 */

export class NexusBrain implements Service {
    public name = "NexusBrain";

    private architect: NexusArchitect;
    private coder: NexusCoder;
    private goalManager: GoalManager;

    private _status: "stopped" | "running" | "error" = "stopped";
    private chatQueue: { text: string, source: 'UI' | 'PHONE', image?: { base64: string; mimeType: string } }[] = [];
    private audioQueue: Buffer[] = [];
    private pendingAuthChallenges: Map<string, { resolve: (value: string) => void }> = new Map();

    // UI Bridge Connections
    private uiClients: Set<ServerWebSocket<unknown>> = new Set();

    // Satellite Daemon Connections are managed by swarmManager

    // Loop control
    private chatLoopActive = false;
    private goalLoopActive = false;
    private speakInterrupted = false;
    private phoneLink: TelemetryBot | null = null;
    private whatsappLink: WhatsAppBridge | null = null;
    private neuralLink: NeuralLink | null = null;

    // Focus Mode: When true, all background heartbeats yield to give
    // the Engineer agent 100% of inference bandwidth.
    public isAutonomousFocusMode = false;


    constructor() {
        this.architect = new NexusArchitect();
        swarmManager.startHeartbeatCycle();
        this.coder = new NexusCoder();
        this.goalManager = new GoalManager();

        // 1. Register Autonomous Tools
        registerBuiltinTools();
        registerDeveloperTools();
        registerSourceControlTools();
        registerWebTools();
        registerGitHubTools();
        registerAppleScriptTools();
        registerBrowserTools();
        registerFFmpegTools();

        // Wire browser engine callbacks to dashboard
        browserEngine.onSnapshot = (base64, url) => {
            this.broadcastBrowserSnapshot(base64, url);
        };
        browserEngine.onBrowserLog = (message) => {
            this.broadcastBrowserLog(message);
        };
    }

    // ──────────── Service Lifecycle ────────────
    public status(): "stopped" | "running" | "error" {
        return this._status;
    }

    public async start() {
        // 0. Pre-flight Diagnostics
        const diagnosticsPassed = await onboardManager.runDiagnostics();
        if (!diagnosticsPassed) {
            console.error("[CRITICAL] Pre-flight diagnostics failed. Aborting boot.");
            return;
        }

        this._status = "running";
        NexusCLI.showBanner();

        this.initWebServer();
        NexusCLI.showStatus("Web Server", "ONLINE", "#00F0FF");

        // Start Neural Bridge for Voice Agent
        setBrainRef(this);
        startBridge();

        // 1.5 Start Neural Link (Gemini Live Sync)
        const geminiKey = process.env.GEMINI_API_KEY;
        if (geminiKey) {
            this.neuralLink = new NeuralLink(geminiKey);
            this.neuralLink.connect();
            NexusCLI.showStatus("Neural Link", "CONNECTED", "#00F0FF");
        } else {
            NexusCLI.showStatus("Neural Link", "OFFLINE (No Key)", "#FF3366");
        }


        this.broadcastToUI('STATE', { architect: 'IDLE', coder: 'IDLE', bridge: 'ACTIVE' });
        NexusCLI.showStatus("Architect", "READY", "#CC66FF");
        NexusCLI.showStatus("Goal Engine", "ACTIVE", "#33FF99");
        NexusCLI.showStatus("Voice Core", "CONNECTED", "#00CCFF");
        NexusCLI.showStatus("Nexus Vault", "SYNCED", "#FFCC00");

        // Wire up Swarm Manager status broadcasting to dashboard
        swarmManager.onStatusChange = (status) => {
            this.broadcastToUI('SWARM_UPDATE', {
                ...status,
                hierarchy: orchestrator.getHierarchy()
            });
        };

        // Initialize Identity Engine
        await identity.initialize();
        NexusCLI.showStatus("Identity Core", `${identity.getMode()}`, "#FF6699");

        // Initialize Skill Engine
        await skillEngine.initialize();
        NexusCLI.showStatus("Skill Engine", `${skillEngine.getAll().length} skills`, "#33CCFF");

        // Initialize Skill Parser (SKILL.md watcher)
        await skillParser.initialize();

        // Initialize Critic Tier (OpenClaw before_tool_call hook)
        toolRegistry.registerBeforeHook(nexusCritic.createToolGateHook());
        NexusCLI.showStatus("Critic Tier", "ARMED", "#FF4444");

        // Load self-authored tools from disk
        const loadedTools = toolFactory.loadPersistedTools();
        await loadGeneratedTools();

        // Broadcast tools when a new one is registered/modified
        toolRegistry.onToolRegistered(() => {
            const allTools = toolRegistry.listTools();
            this.broadcastToUI('TOOLS_UPDATE', allTools);
            this.broadcastToUI('LOG', `[NEXUS] New autonomous skill synchronized with UI.`);
        });

        NexusCLI.showStatus("Tool Factory", `${loadedTools} learned tool(s)`, "#FF9900");

        // Log registry stats
        const stats = toolRegistry.getStats();
        console.log(`[BRAIN] Tool Registry: ${stats.total} tools (${stats.core} core, ${stats.learned} learned, ${stats.userAuthored} user-authored)`);

        // Initialize Telegram Link (Department 4)
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
            this.phoneLink = new TelemetryBot(botToken);
            this.phoneLink.onMessageReceived = (text: string) => {
                NexusCLI.quietLog(`[PHONE LINK] Incoming: "${text}"`);
                this.chatQueue.push({ text, source: 'PHONE' });
                this.broadcastToUI('CHAT', { role: 'USER', text: `📱 ${text}` });
            };
            this.phoneLink.launch();
            NexusCLI.showStatus("Phone Link", "CONNECTED", "#00FF66");
        } else {
            NexusCLI.showStatus("Phone Link", "OFFLINE (No Token)", "#FF3366");
        }

        // Sensory Bridge: Stream tool events to Dashboard
        toolRegistry.onToolExecuted((event) => {
            if (event.toolName.startsWith('browser.')) {
                try {
                    const payload = typeof event.result === 'string' && event.result.startsWith('{')
                        ? JSON.parse(event.result) : {};
                    if (payload.base64 || payload.url) {
                        this.broadcastBrowserSnapshot(payload.base64, payload.url || '');
                    }
                    this.broadcastBrowserLog(`${event.toolName}(${JSON.stringify(event.params).substring(0, 100)}) → ${event.success ? 'OK' : 'FAIL'}`);
                } catch (_) { }
            }
        });

        toolRegistry.onApprovalRequested((id, toolName, reason) => {
            console.log(`[BRAIN] Tool approval routed to UI: ${toolName}`);
            this.broadcastToUI('APPROVAL_REQUEST', { id, toolName, reason });
            // Speak it so the user knows
            this.speak(`Approval required to execute ${toolName}.`);
        });

        // Wire Omni-Channel User Finder
        userFinder.setChannels({
            dashboard: (type, data) => this.broadcastToUI(type, data),
            telegram: this.phoneLink ? (text, parseMode: any) => this.phoneLink!.replyDirect(text, parseMode) : undefined,
            voice: async (text) => {
                this.broadcastToUI('STATE', { architect: 'SPEAKING', coder: 'IDLE', bridge: 'ACTIVE' });
                await this.speak(text);
                this.broadcastToUI('STATE', { architect: 'IDLE', coder: 'IDLE', bridge: 'ACTIVE' });
            }
        });
        NexusCLI.showStatus("Outreach Escalation", "ARMED", "#00F0FF");

        // Initialize WhatsApp Bridge
        this.whatsappLink = new WhatsAppBridge();
        this.whatsappLink.onMessageReceived = (text: string) => {
            console.log(`[WHATSAPP] Incoming: "${text}"`);
            this.chatQueue.push({ text, source: 'PHONE' });
            this.broadcastToUI('CHAT', { role: 'USER', text: `📱 [WA] ${text}` });
        };
        this.whatsappLink.onTaskCreated = (title: string) => {
            const goal = this.goalManager.create(title, 'Created via WhatsApp', []);
            this.broadcastToUI('GOALS', this.goalManager.getAll());
            this.broadcastToUI('LOG', `[WHATSAPP] Directive created: "${title}"`);
        };
        this.whatsappLink.onStateChange = (state, data) => {
            this.broadcastToUI('WHATSAPP_STATE', { state, data });
            if (state === 'READY') {
                NexusCLI.showStatus("WhatsApp", "CONNECTED", "#00FF66");
            } else if (state === 'QR') {
                NexusCLI.showStatus("WhatsApp", "PENDING QR", "#FFCC00");
                this.triggerCriticalPulse("WhatsApp requires QR scan. Check terminal or Dashboard.", 'warning');
            }
        };
        this.whatsappLink.launch();

        NexusCLI.showDashboardLink();
        NexusCLI.openDashboard();

        // Initialize Obsidian Mirroring
        await vault.syncToMarkdown();
        vault.watchMarkdownVault();

        // ═══════════════════════════════════════════════════════
        // ██  AUTONOMOUS HOUR MODE — Self-Improvement Directive  ██
        // ═══════════════════════════════════════════════════════
        nexusCritic.enableSessionTrust(30); // 30-minute auto-approve window
        NexusCLI.showStatus("Session Trust", "30 MIN AUTONOMOUS", "#FF9900");

        // Engage Focus Mode: freeze all background inference consumers
        this.isAutonomousFocusMode = true;
        console.log(`[FOCUS MODE] \u2705 Activated. Background heartbeats frozen for autonomous sprint.`);

        // Auto-inject the self-improvement directive after a brief boot delay
        setTimeout(() => {
            const directive = [
                "You have been given 30 minutes of full autonomous operation. Your directive:",
                "",
                "1. AUDIT — Scan your own source code (src/core/*.ts) for bugs, inefficiencies, and missing features.",
                "2. IMPROVE — Fix what you find, optimize what's slow, add what's missing.",
                "3. DOCUMENT CRITICALLY — Continuously document EVERYTHING you are doing during this 30 minute session into a dedicated folder. Create a folder called 'autonomous_hour_logs' and write detailed markdown reports inside it explaining the bugs you found, the files you edited, and the new things you learned.",
                "4. TEST — Verify EVERY change compiles cleanly via nexus.run_tests({\"mode\": \"typecheck\"}).",
                "5. PUSH — After each verified improvement, commit and push to GitHub.",
                "",
                "You have full access to your filesystem, GitHub, the web, and all tools.",
                "Session Trust is active — no approval popups will interrupt you.",
                "Git checkpoints are active — every code_patch creates a backup automatically.",
                "",
                "Begin now. Loop continuously and do not stop until the 30 minutes are up."
            ].join("\n");

            this.chatQueue.push({ text: directive, source: 'UI' });
            this.broadcastToUI('CHAT', { role: 'USER', text: `🚀 [AUTONOMOUS RUN] 30-min Directive injected.` });
            this.broadcastToUI('LOG', `[AUTONOMOUS] 30-minute self-improvement session started.`);
            console.log(`\n[AUTONOMOUS RUN] 🚀 Self-improvement directive injected. Session Trust active for 30 minutes.\n`);
        }, 10000); // 10 second boot delay

        // Start concurrent service loops
        this.chatLoopActive = true;
        this.goalLoopActive = true;

        try {
            // GIGA-LAUNCH: Activate all sentient loops concurrently
            await Promise.all([
                this.runChatLoop(),
                this.runGoalLoop(),
                this.runTelemetryLoop(),
                this.runProactiveLoop(),
                this.runMemoryHeartbeat(),
                this.runOptimizationHeartbeat(),
                awareness.start(120000),      // Vision Loop (2 min)
                extractor.launchLoop(900000), // Learning Loop (15 min)
                socialPersona.launchLoop()    // Social Intelligence
            ]);
        } catch (fatalError: any) {
            const errorMsg = fatalError?.stack || fatalError?.message || String(fatalError);
            console.error('\n[FATAL ERROR] Main event loops crashed:\n', errorMsg);

            // Critical Pulse to UI
            this.triggerCriticalPulse(`Nexus Core Failure: ${fatalError?.message || 'Unknown crash'}`, 'critical');

            console.log("\n[NEXUS CLAIRE] Initiating Self-Healing Protocol...");
            try {
                this.broadcastToUI('LOG', `[SYSTEM] FATAL CRASH DETECTED. Initiating self-healing sequence...`);
                // Let the engineer fix the bug using the new autonomous engine
                await engineer.executeTask(`The main event loop crashed with this fatal error:\n${errorMsg}\nAnalyze the situation, fix the bug, and ensure the system is stable.`);
                console.log("[NEXUS CLAIRE] Self-healing patch applied successfully. Please restart the daemon.");
            } catch (healError) {
                console.error("[NEXUS CLAIRE] Self-healing failed:", healError);
            }
        }
    }

    public async stop() {
        this.chatLoopActive = false;
        this.goalLoopActive = false;
        this._status = "stopped";
        console.log("[NEXUS CLAIRE] Brain stopped.");
    }

    // ──────────── WebSocket Server ────────────
    private initWebServer() {
        serve({
            port: 18790,
            hostname: "0.0.0.0",
            fetch(req, server) {
                const url = new URL(req.url);
                if (url.pathname === '/' || url.pathname === '') {
                    const upgraded = server.upgrade(req);
                    if (upgraded) return undefined;
                }
                return new Response("Nexus UI Bridge API Running", { status: 200 });
            },
            websocket: {
                open: (ws) => {
                    console.log("[UI BRIDGE] Dashboard connected.");
                    this.uiClients.add(ws);
                    ws.send(JSON.stringify({ type: 'LOG', payload: '[SYSTEM] Connected to Nexus Brain v2.0' }));

                    // Send current goals to newly connected client
                    ws.send(JSON.stringify({ type: 'GOALS', payload: this.goalManager.getAll() }));

                    // Broadcast all autonomous skills/tools
                    const allTools = (toolRegistry as any).tools ? Array.from((toolRegistry as any).tools.values()) : [];
                    ws.send(JSON.stringify({ type: 'TOOLS_UPDATE', payload: allTools }));

                    // Send Vault facts + entities on connection
                    vault.getAllFacts().then(facts => {
                        ws.send(JSON.stringify({ type: 'VAULT_UPDATE', payload: { facts: facts.slice(0, 50) } }));
                    });

                    // Send live agent hierarchy
                    ws.send(JSON.stringify({
                        type: 'SWARM_UPDATE',
                        payload: {
                            ...swarmManager.getStatus(),
                            hierarchy: orchestrator.getHierarchy()
                        }
                    }));
                    try {
                        const entities = (vault as any).db.query(
                            "SELECT name, type, description, last_seen FROM entities ORDER BY last_seen DESC LIMIT 20"
                        ).all();
                        ws.send(JSON.stringify({ type: 'VAULT_ENTITIES', payload: { entities } }));
                    } catch (_) { }
                },
                message: (ws, message) => {
                    try {
                        const data = JSON.parse(String(message));
                        if (data.type === 'CHAT_INPUT') {
                            console.log(`[UI BRIDGE] User directive: "${data.payload}"`);
                            this.chatQueue.push({ text: data.payload, source: 'UI' });
                        } else if (data.type === 'CHAT_INPUT_WITH_IMAGE') {
                            const { text, image } = data.payload;
                            console.log(`[UI BRIDGE] User directive with image: "${text}"`);
                            this.chatQueue.push({ text, source: 'UI', image });
                        } else if (data.type === 'RESOLVE_AUTH') {
                            const { id, value } = data.payload;
                            const pending = this.pendingAuthChallenges.get(id);
                            if (pending) {
                                pending.resolve(value);
                                this.pendingAuthChallenges.delete(id);
                                this.broadcastToUI('LOG', `[AUTH] User provided input for challenge ${id}.`);
                            }
                        } else if (data.type === 'AUDIO_BUFFER') {
                            console.log("[UI BRIDGE] Received audio buffer from browser mic.");
                            this.handleVoiceInput(data.payload);
                        } else if (data.type === 'CREATE_GOAL') {
                            const goal = this.goalManager.create(data.payload.title, data.payload.description, data.payload.steps);
                            this.broadcastToUI('GOALS', this.goalManager.getAll());
                            this.broadcastToUI('LOG', `[GOALS] Created: "${goal.title}"`);
                        } else if (data.type === 'GET_VAULT') {
                            vault.getAllFacts().then(facts => {
                                ws.send(JSON.stringify({ type: 'VAULT_UPDATE', payload: facts }));
                            });
                        } else if (data.type === 'VOICE_STREAM') {
                            // Smart Bridge: handle voice input from dashboard
                            this.handleVoiceInput(data.payload);
                        } else if (data.type === 'GET_IDENTITY') {
                            ws.send(JSON.stringify({ type: 'IDENTITY_PROFILE', payload: identity.getProfile() }));
                        } else if (data.type === 'SET_PERSONALITY_MODE') {
                            identity.setMode(data.payload);
                            this.broadcastToUI('IDENTITY_PROFILE', identity.getProfile());
                            this.broadcastToUI('LOG', `[IDENTITY] Mode switched to ${data.payload}`);
                        } else if (data.type === 'SANDBOX_EXEC') {
                            NexusCLI.quietLog(`[SANDBOX] Executing code (${data.payload.length} chars)...`);
                            this.broadcastToUI('LOG', '[SANDBOX] Executing code in isolated environment...');
                            sandbox.executeCode(data.payload).then(result => {
                                ws.send(JSON.stringify({ type: 'SANDBOX_RESULT', payload: result }));
                                this.broadcastToUI('LOG', `[SANDBOX] Execution complete (${result.engine}, exit: ${result.code})`);
                            }).catch(err => {
                                ws.send(JSON.stringify({
                                    type: 'SANDBOX_RESULT', payload: {
                                        success: false,
                                        stdout: '',
                                        stderr: err?.message || 'Unknown sandbox error',
                                        code: 1,
                                        engine: 'BUN_SUBPROCESS'
                                    }
                                }));
                            });
                        } else if (data.type === 'DELETE_FACT') {
                            vault.deleteFact(data.payload.id);
                        } else if (data.type === 'RESOLVE_APPROVAL') {
                            const { id, approved, options } = data.payload;
                            toolRegistry.resolveApproval(id, approved, options);
                        } else if (data.type === 'SATELLITE_REGISTER') {
                            const { id: satId, capabilities, os: satOs, hostname: satHost } = data.payload || {};
                            swarmManager.registerSatellite(satId || 'unknown', ws, {
                                capabilities: capabilities || [],
                                os: satOs,
                                hostname: satHost
                            });
                            this.broadcastToUI('SWARM_UPDATE', swarmManager.getStatus());
                            this.broadcastToUI('LOG', `[SWARM] Sidecar "${satId}" connected (${satOs || 'unknown OS'})`);
                        } else if (data.type === 'SATELLITE_HEARTBEAT') {
                            const satId = data.payload?.id;
                            if (satId) swarmManager.heartbeat(satId, data.payload);
                        } else if (data.type === 'SATELLITE_TASK_RESULT') {
                            const { taskId, status, result, error } = data.payload || {};
                            swarmManager.handleResult(taskId, result || error || '', status === 'complete');
                            if (status === 'complete') {
                                this.broadcastToUI('CHAT', { role: 'NEXUS', text: `[SIDECAR RESULT] ${result?.substring(0, 500) || 'Task completed.'}` });
                            } else {
                                this.broadcastToUI('LOG', `[SWARM] Task ${taskId} failed: ${error}`);
                            }
                        } else if (data.type === 'SATELLITE_TASK_ACK') {
                            this.broadcastToUI('LOG', `[SWARM] Task ${data.payload?.taskId} acknowledged by sidecar.`);
                        } else if (data.type === 'SIDECAR_PROGRESS') {
                            const { taskId, progress, percent } = data.payload || {};
                            this.broadcastToUI('SIDECAR_PROGRESS', { taskId, progress, percent });
                        } else if (data.type === 'SIDECAR_DISCONNECT') {
                            const satId = data.payload?.id;
                            if (satId) swarmManager.removeSatellite(satId);
                            this.broadcastToUI('LOG', `[SWARM] Sidecar "${satId}" disconnected: ${data.payload?.reason || 'unknown'}`);
                        } else if (data.type === 'PONG') {
                            // Heartbeat response — handled by swarm-manager
                        }
                    } catch {
                        console.log("[UI BRIDGE] Raw message:", message);
                    }
                },
                close: (ws) => {
                    this.uiClients.delete(ws);
                    // Also check if this was a sidecar connection
                    const status = swarmManager.getStatus();
                    for (const sidecar of status.sidecars) {
                        // The sidecar WS reference may match this disconnecting ws
                        // swarmManager handles cleanup via heartbeat timeout
                    }
                },
            },
        });
        console.log("[NEXUS CLAIRE] UI Socket Bridge online at ws://localhost:18790");
    }

    // ──────────── Voice Pipeline ────────────
    private async handleVoiceInput(base64Audio: string) {
        if (!SpeechToText) {
            console.warn("[VOICE] No STT provider configured. Set GROQ_API_KEY in .env");
            this.broadcastToUI('LOG', '[SYSTEM] Voice input received but STT is not configured. Add GROQ_API_KEY to .env');
            return;
        }

        try {
            this.broadcastToUI('LOG', '[VOICE] Transcribing...');
            const audioBuffer = Buffer.from(base64Audio, 'base64');
            const transcript = await SpeechToText.transcribe(audioBuffer);

            const cleanTranscript = transcript?.trim().toLowerCase() || "";
            const isPhantom = [
                'thank you', 'thank you.', 'thank you!',
                '. . .', '...', '.', 'yeah', 'yeah.',
                'subscribe', 'subscribe.', 'music', '[music]',
                'bye', 'bye.'
            ].includes(cleanTranscript);

            if (transcript && transcript.trim().length > 0 && !isPhantom) {
                console.log(`[VOICE] Transcribed: "${transcript}"`);
                // Do NOT echo transcript to chat - just queue it for processing
                this.chatQueue.push({ text: transcript, source: 'UI' });
            } else if (isPhantom) {
                console.log(`[VOICE] Ignored phantom noise transcript: "${transcript}"`);
                this.broadcastToUI('LOG', `[VOICE] Ignored noise: "${transcript}"`);
            } else {
                this.broadcastToUI('LOG', '[VOICE] Could not transcribe audio.');
            }
        } catch (err: any) {
            console.error("[VOICE] STT failed:", err.message);
            this.broadcastToUI('LOG', `[VOICE] Transcription error: ${err.message}`);
        }
    }

    // ──────────── Broadcast ────────────
    public broadcastToUI(type: string, payload: any) {
        const msg = JSON.stringify({ type, payload });
        this.uiClients.forEach(ws => ws.send(msg));
    }

    public broadcastBrowserSnapshot(base64: string, url: string) {
        this.broadcastToUI('BROWSER_SNAPSHOT', base64);
        this.broadcastToUI('BROWSER_URL', url);
    }

    public broadcastBrowserLog(log: string) {
        this.broadcastToUI('BROWSER_LOG', log);
    }

    // ──────────── TTS Speech Engine ────────────
    private async speak(text: string) {
        this.speakInterrupted = false;
        console.log(`[VOICE] Synthesizing speech: "${text.substring(0, 50)}..."`);
        const sentences = splitIntoSentences(text);
        for (const sentence of sentences) {
            // Check for interrupt between each sentence
            if (this.speakInterrupted) {
                console.log("[VOICE] Speech interrupted by user. Aborting remaining sentences.");
                break;
            }
            try {
                if (VoiceEngine.stream) {
                    await VoiceEngine.stream(sentence, (chunk) => {
                        this.broadcastToUI('AUDIO_RESPONSE', chunk.toString('base64'));
                    });
                } else {
                    const audioBuffer = await VoiceEngine.synthesize(sentence);
                    if (audioBuffer.length > 0) {
                        this.broadcastToUI('AUDIO_RESPONSE', audioBuffer.toString('base64'));
                    }
                }
            } catch (err: any) {
                console.error("[VOICE] TTS failed for sentence:", err.message);
            }
        }
    }

    // ──────────── Chat Loop (100ms) ────────────
    private async runChatLoop() {
        console.log("[NEXUS CLAIRE] Chat Loop Active.");
        while (this.chatLoopActive) {
            if (this.chatQueue.length > 0) {
                const { text: userMessage, source, image: attachedImage } = this.chatQueue.shift()!;
                this.broadcastToUI('STATE', { architect: 'REASONING', coder: 'IDLE', bridge: 'ACTIVE' });
                this.broadcastToUI('LOG', `[USER] ${userMessage}`);

                // Auto-switch personality mode based on conversation context
                identity.analyzeContext(userMessage);
                this.broadcastToUI('IDENTITY_PROFILE', identity.getProfile());

                // Context-Aware Augmentation: Avoid heavy system context for simple greetings
                const greetings = ['hello', 'hi', 'hey', 'yo', 'morning', 'afternoon', 'evening', 'nexus'];
                const isGreeting = greetings.some(g => userMessage.toLowerCase().trim() === g || userMessage.toLowerCase().trim() === `${g}?`);

                const telemetry = getSystemTelemetry();
                const vaultContext = isGreeting ? "" : await vault.getContextForPrompt(userMessage);
                const taskStatus = taskManager.listTasks().map(t => `${t.agentName}: ${t.status}`).join(', ') || 'No background tasks.';
                const contextHeader = isGreeting
                    ? `[TIME] ${telemetry.timestamp}`
                    : `[SYSTEM CONTEXT] Time: ${telemetry.timestamp} | Active App: ${telemetry.activeApp} | CPU: ${telemetry.cpu}% | RAM: ${telemetry.memPct}%\n[TASKS] ${taskStatus}\n${vaultContext}`;

                const goalContext = this.goalManager.getContextForLLM();
                const augmentedMessage = (goalContext !== 'No active goals.' && !isGreeting)
                    ? `${contextHeader}\n[ACTIVE GOALS]\n${goalContext}\n\n[USER REQUEST]\n${userMessage}`
                    : `${contextHeader}\n\n[USER REQUEST]\n${userMessage}`;

                // ──────────── FAST-PATH INTENT ROUTER (ZERO-LATENCY) ────────────
                const lowerMsg = userMessage.toLowerCase().trim();
                const cleanMsg = lowerMsg.replace(/[.!?]+$/, '');

                let fastPathResponse = null;
                if (cleanMsg.startsWith('open ') && cleanMsg.length > 5) {
                    const appOrUrl = userMessage.trim().substring(5).replace(/[.!?]+$/, '').trim();
                    if (appOrUrl.includes('http://') || appOrUrl.includes('https://') || appOrUrl.includes('.com') || appOrUrl.includes('.org') || appOrUrl.includes('.net')) {
                        const url = appOrUrl.startsWith('http') ? appOrUrl : `https://${appOrUrl}`;
                        fastPathResponse = `[TOOL: terminal.run({"command": "open '${url}'"})]`;
                    } else {
                        fastPathResponse = `[TOOL: mac.open_app({"name": "${appOrUrl}"})]`;
                    }
                } else if (cleanMsg.startsWith('type ') && cleanMsg.length > 5) {
                    const typeRequest = userMessage.trim().substring(5).trim();
                    const inMatch = typeRequest.match(/^(.*?)\s+in\s+([a-zA-Z0-9\s]+)$/i);
                    if (inMatch) {
                        const text = inMatch[1]!.trim();
                        // Clean up the trailing punctuation from the app if it had any
                        const app = inMatch[2]!.trim().replace(/[.!?]+$/, '');
                        const pressEnter = text.includes('.') && !text.includes(' ');
                        fastPathResponse = `[TOOL: mac.type_in_app({"app": "${app}", "text": "${text}", "press_enter": ${pressEnter}})]`;
                    } else {
                        fastPathResponse = `[TOOL: mac.type({"text": "${typeRequest}"})]`;
                    }
                } else if (cleanMsg.startsWith('press ') && cleanMsg.length > 6) {
                    const mappedKey = cleanMsg.substring(6).replace(/the |key/g, '').trim();
                    fastPathResponse = `[TOOL: mac.press_key({"key": "${mappedKey}"})]`;
                } else if (cleanMsg === 'get clipboard' || cleanMsg === 'read clipboard') {
                    fastPathResponse = `[TOOL: mac.get_clipboard({})]`;
                }

                let rawResponse: any;
                let streamedFullText = '';

                // ──── VISION PATH: Image attached ────
                if (attachedImage) {
                    console.log(`[NEXUS CLAIRE] Vision mode: analyzing attached image...`);
                    this.broadcastToUI('LOG', '[VISION] Analyzing image with multimodal engine...');
                    const visionResponse = await this.architect.sequenceWithImage(
                        augmentedMessage,
                        attachedImage.base64,
                        attachedImage.mimeType,
                        'HIGH'
                    );
                    rawResponse = visionResponse;
                    streamedFullText = visionResponse;
                } else if (fastPathResponse) {
                    console.log(`[NEXUS CLAIRE] Fast-Path intent matched! Bypassing reasoning LLM...`);
                    rawResponse = fastPathResponse;
                } else {
                    // ──── PIPELINED STREAMING TTS ────
                    // Stream sentences from the LLM and speak each one immediately
                    // while the LLM continues generating the rest.
                    console.log(`[NEXUS CLAIRE] Processing (streaming): "${userMessage}"`);

                    const spokenSentences: string[] = [];
                    let hasVoiceOutputSinceStart = false;

                    const streamGen = this.architect.streamSequence(
                        augmentedMessage,
                        'HIGH',
                        (fullText) => { streamedFullText = fullText; }
                    );

                    for await (const sentence of streamGen) {
                        // Broadcast the entire accumulated text for the UI to correctly append/update
                        streamedFullText = (streamedFullText || '') + (streamedFullText ? ' ' : '') + sentence;
                        this.broadcastToUI('CHAT_STREAM', { role: 'NEXUS', text: streamedFullText });

                        // Pipeline TTS: speak this sentence immediately
                        const hasTags = sentence.includes('[TOOL:') || sentence.includes('[EXEC:');
                        if (!hasTags && sentence.length > 2) {
                            spokenSentences.push(sentence);
                            hasVoiceOutputSinceStart = true;
                            // Use non-streaming synthesize for robust browser playback per sentence
                            try {
                                const audioBuffer = await VoiceEngine.synthesize(sentence);
                                if (audioBuffer.length > 0) {
                                    this.broadcastToUI('AUDIO_RESPONSE', audioBuffer.toString('base64'));
                                }
                            } catch (e: any) {
                                console.error('[VOICE] Pipelined TTS error:', e.message);
                            }
                        }
                    }

                    rawResponse = streamedFullText;
                }
                // ────────────────────────────────────────────────────────────────
                let response = "";

                if (typeof rawResponse !== 'string') {
                    NexusCLI.quietLog(`[NEXUS] StepTree generated: ${JSON.stringify(rawResponse.plan).substring(0, 200)}...`);
                    response = `I have formulated a multi - step plan: ${rawResponse.plan}.\n[EXEC: execute StepTree: ${JSON.stringify(rawResponse.steps)}]`;
                } else {
                    response = rawResponse;
                }

                // COMMANDER OVERRIDE: If the user says "fix", "build", "create" and no EXEC is present, force it.
                const buildWords = ['fix', 'build', 'create', 'implement', 'update', 'modify', 'add'];
                const isBuildIntent = buildWords.some(w => userMessage.toLowerCase().includes(w));

                if (isBuildIntent && !response.includes('[EXEC:')) {
                    console.log("[NEXUS] Detected build intent but no EXEC present. Forcing autonomy...");
                    const forceResponse = await this.architect.sequence(
                        `Ruben wants ACTION.You are a COMMANDER.Do not explain.\nConstruct exactly ONE[EXEC: ...]tag to execute this: ${userMessage}`
                    );
                    response = typeof forceResponse === 'string' ? forceResponse : JSON.stringify(forceResponse);
                }

                // Extract ALL [TOOL: ...] tags for multi-step execution (e.g. login flows)
                const toolMatches = [...response.matchAll(/\[TOOL:\s*([a-zA-Z0-9_\.]+)\((.*?)\)\]/gis)];
                const execMatch = response.match(/\[EXEC:(.*?)\]/is);
                let finalResponse = response.replace(/\[TOOL:.*?\]/g, "").replace(/\[EXEC:.*?\]/g, "").trim();

                if (toolMatches.length > 0) {
                    const toolResults: string[] = [];
                    for (const toolMatch of toolMatches) {
                        const toolName = toolMatch[1]!.trim();
                        try {
                            let argsStr = toolMatch[2]!.trim();
                            argsStr = argsStr.replace(/^```json /i, '').replace(/```$/i, '').trim();
                            const toolArgs = argsStr ? JSON.parse(argsStr) : {};

                            const tool = toolRegistry.getTool(toolName);
                            if (tool) {
                                console.log(`[DIRECT EXECUTION] Running ${toolName}...`);
                                this.broadcastToUI('LOG', `[DIRECT EXECUTION] Running ${toolName}...`);
                                const result = await tool.execute(toolArgs);
                                const resultStr = typeof result === 'string' ? result : 'Success';
                                const resultSummary = resultStr.substring(0, 200);

                                // ── AUTH DETECTION ── Check if the result signals an auth wall
                                const authPatterns = /captcha|verify|two.?factor|2fa|otp|verification code|confirm your identity|login required|sign in|authenticate|security check|phone number|email verification/i;
                                if (authPatterns.test(resultStr)) {
                                    toolResults.push(`🔐 ${toolName}: Auth challenge detected`);
                                    const userInput = await this.requestAuthFromUser(
                                        `🔐 Authentication Required`,
                                        `Nexus encountered a verification challenge while executing ${toolName}:\n\n"${resultStr.substring(0, 300)}"\n\nPlease provide the required input (verification code, CAPTCHA answer, etc.):`
                                    );
                                    if (userInput) {
                                        toolResults.push(`🔑 User provided: ${userInput.substring(0, 20)}...`);
                                        // Feed the user's input back as a new tool call
                                        this.chatQueue.unshift({ text: `Continue the previous task. The user provided this authentication input: "${userInput}". Use it to complete the auth step.`, source: 'UI' });
                                    }
                                } else {
                                    toolResults.push(`✅ ${toolName}: ${resultSummary}`);
                                }

                                // Brief pause between tools to let pages load
                                if (toolName.startsWith('browser.')) {
                                    await new Promise(r => setTimeout(r, 1500));
                                }
                            } else {
                                toolResults.push(`❌ ${toolName}: Tool not found`);
                            }
                        } catch (e: any) {
                            toolResults.push(`❌ ${toolName}: ${e.message}`);
                        }
                    }

                    // ── COGNITIVE PERSISTENCE: Check for failures and retry ──
                    const failures = toolResults.filter(r => r.startsWith('❌'));
                    if (failures.length > 0 && toolMatches.length > 0) {
                        this.broadcastToUI('LOG', `[PERSISTENCE] ${failures.length} failure(s) detected. Engaging cognitive retry...`);
                        const retryResult = await this.cognitiveRetryLoop(
                            userMessage,
                            failures.join('\n'),
                            augmentedMessage
                        );
                        if (retryResult) {
                            toolResults.push(`🧠 Retry: ${retryResult}`);
                        }
                    }

                    // Broadcast all results
                    const resultsStr = toolResults.join('\n');
                    this.broadcastToUI('CHAT', { role: 'NEXUS', text: `${toolMatches.length} action(s) executed:\n${resultsStr}` });
                    if (!finalResponse) finalResponse = `Executed ${toolMatches.length} action(s).`;
                } else if (execMatch) {
                    const taskStr = execMatch[1]?.trim() || 'No task description provided.';
                    const taskId = `task-${Date.now()}`;

                    // Satellite-first routing: prefer cloud worker if available
                    const firstSatellite = swarmManager.getFirstSatelliteWs();
                    if (firstSatellite) {
                        const [satId] = firstSatellite;
                        console.log(`[SATELLITE] Routing task to satellite: ${satId}`);
                        const dispatched = swarmManager.dispatchDirect(satId, taskId, taskStr, contextHeader);
                        if (dispatched) {
                            this.broadcastToUI('CHAT', { role: 'NEXUS', text: `[SATELLITE] Task dispatched to cloud worker "${satId}": "${taskStr}"` });
                            this.broadcastToUI('LOG', `[SATELLITE] Task ${taskId} → ${satId}`);
                        } else {
                            console.warn(`[SATELLITE] Failed to route to ${satId}, falling back to local.`);
                            engineer.executeTask(taskStr, contextHeader);
                            this.broadcastToUI('CHAT', { role: 'NEXUS', text: `[COMMANDER] Satellite unavailable. Running locally: "${taskStr}"` });
                        }
                    } else {
                        // Local fallback
                        console.log(`[ENGINEER] Spawning local background sub-agent for: ${taskStr}`);
                        engineer.executeTask(taskStr, contextHeader);
                        this.broadcastToUI('CHAT', { role: 'NEXUS', text: `[COMMANDER] Initiating background execution: "${taskStr}"... I'll keep you updated.` });
                    }
                    this.broadcastToUI('LOG', `[ENGINEER] Task dispatched: ${taskStr}`);
                }

                // Final UI Update: Only broadcast CHAT if it wasn't already streamed.
                // Replace any active stream with the final complete response.
                const wasStreamed = (streamedFullText.length > 0);
                if (wasStreamed) {
                    this.broadcastToUI('CHAT', {
                        role: 'NEXUS',
                        text: finalResponse,
                        isFinal: true,
                        replaceStream: true
                    });
                } else if (fastPathResponse || toolMatches.length > 0 || execMatch) {
                    this.broadcastToUI('CHAT', { role: 'NEXUS', text: finalResponse });
                    this.speak(finalResponse);
                }

                this.broadcastToUI('LOG', `[NEXUS] ${finalResponse.substring(0, 200)}...`);

                // Relay back to Phone if originate from there
                if (source === 'PHONE' && this.phoneLink) {
                    this.phoneLink.replyDirect(response);
                }

                this.broadcastToUI('STATE', { architect: 'IDLE', coder: 'IDLE', bridge: 'ACTIVE' });

                // Background: Extract facts into Vault
                if (userMessage.length > 15) {
                    setTimeout(async () => {
                        try {
                            await extractor.extractAndStore(`User: ${userMessage}\nNexus: ${finalResponse}`);
                            // Push updated vault to dashboard
                            const allFacts = await vault.getAllFacts();
                            this.broadcastToUI('VAULT_UPDATE', { facts: allFacts.slice(0, 50) });
                        } catch (e: any) {
                            console.error('[EXTRACTOR] Background extraction error:', e?.message);
                            this.triggerCriticalPulse(`Memory Extraction Failed: ${e?.message}`, 'warning');
                        }
                    }, 500);
                }
            }
            await new Promise(r => setTimeout(r, 100));
        }
    }

    // ──────────── Auth Challenge (User Input Request) ────────────
    private async requestAuthFromUser(title: string, description: string): Promise<string | null> {
        const challengeId = `auth-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        return new Promise<string | null>((resolve) => {
            // Set a 5-minute timeout
            const timeout = setTimeout(() => {
                this.pendingAuthChallenges.delete(challengeId);
                this.broadcastToUI('LOG', `[AUTH] Challenge ${challengeId} timed out.`);
                resolve(null);
            }, 300000);

            this.pendingAuthChallenges.set(challengeId, {
                resolve: (value: string) => {
                    clearTimeout(timeout);
                    resolve(value);
                }
            });

            // Broadcast to dashboard
            this.broadcastToUI('AUTH_CHALLENGE', {
                id: challengeId,
                title,
                description,
                timestamp: Date.now()
            });

            this.broadcastToUI('LOG', `[AUTH] Challenge sent to dashboard: "${title}"`);
        });
    }

    // ──────────── Cognitive Persistence Loop ────────────
    // When a task fails, Nexus reflects on WHY it failed, formulates a new approach,
    // and retries — up to MAX_RETRIES times with full self-reflection.
    private async cognitiveRetryLoop(
        originalGoal: string,
        failureReport: string,
        contextHeader: string,
        maxRetries: number = 3
    ): Promise<string | null> {
        let attempt = 0;
        let lastFailure = failureReport;

        while (attempt < maxRetries) {
            attempt++;
            this.broadcastToUI('STATE', { architect: 'REASONING', coder: 'IDLE', bridge: 'ACTIVE' });
            this.broadcastToUI('LOG', `[PERSISTENCE] Attempt ${attempt}/${maxRetries}: Re-analyzing failure...`);

            // Ask the Architect to reflect on the failure and formulate a new plan
            const retryPrompt = `
[COGNITIVE PERSISTENCE - RETRY ${attempt}/${maxRetries}]
Original user goal: "${originalGoal}"

PREVIOUS ATTEMPT FAILED:
${lastFailure}

You MUST analyze WHY it failed and formulate a DIFFERENT strategy.
Think about:
1. Did the selector/URL/path change?
2. Is there an alternative approach (different tool, different route, different API)?
3. Should you first gather information (screenshot, read_page) before acting?
4. Is there a prerequisite step missing?

Generate your NEXT attempt with [TOOL: ...] tags. Be creative and adaptive.
If you believe the task is genuinely impossible right now, say [GIVE_UP: reason].
`;

            try {
                const retryRaw = await this.architect.sequence(retryPrompt, 'HIGH');
                const retryResponse = typeof retryRaw === 'string' ? retryRaw : JSON.stringify(retryRaw);

                // Check if architect gave up
                if (retryResponse.includes('[GIVE_UP:')) {
                    const reason = retryResponse.match(/\[GIVE_UP:\s*(.*?)\]/)?.[1] || 'No reason given';
                    this.broadcastToUI('CHAT', { role: 'NEXUS', text: `🧠 After ${attempt} attempt(s), I've determined this task cannot be completed right now: ${reason}` });
                    return null;
                }

                // Extract new TOOL tags
                const newToolMatches = [...retryResponse.matchAll(/\[TOOL:\s*([a-zA-Z0-9_\.]+)\((.*?)\)\]/gis)];
                if (newToolMatches.length === 0) {
                    this.broadcastToUI('CHAT', { role: 'NEXUS', text: retryResponse.replace(/\[TOOL:.*?\]/g, '').trim() });
                    return retryResponse;
                }

                // Execute the new tools
                const retryResults: string[] = [];
                for (const toolMatch of newToolMatches) {
                    const toolName = toolMatch[1]!.trim();
                    try {
                        let argsStr = toolMatch[2]!.trim();
                        argsStr = argsStr.replace(/^```json /i, '').replace(/```$/i, '').trim();
                        const toolArgs = argsStr ? JSON.parse(argsStr) : {};
                        const tool = toolRegistry.getTool(toolName);
                        if (tool) {
                            this.broadcastToUI('LOG', `[RETRY ${attempt}] Running ${toolName}...`);
                            const result = await tool.execute(toolArgs);
                            const resultStr = typeof result === 'string' ? result : 'Success';
                            retryResults.push(`✅ ${toolName}: ${resultStr.substring(0, 200)}`);

                            if (toolName.startsWith('browser.')) {
                                await new Promise(r => setTimeout(r, 1500));
                            }
                        } else {
                            retryResults.push(`❌ ${toolName}: Tool not found`);
                        }
                    } catch (e: any) {
                        retryResults.push(`❌ ${toolName}: ${e.message}`);
                    }
                }

                const newFailures = retryResults.filter(r => r.startsWith('❌'));
                if (newFailures.length === 0) {
                    // SUCCESS
                    const successMsg = `🧠 Cognitive retry succeeded on attempt ${attempt}!\n${retryResults.join('\n')}`;
                    this.broadcastToUI('CHAT', { role: 'NEXUS', text: successMsg });
                    this.broadcastToUI('STATE', { architect: 'IDLE', coder: 'IDLE', bridge: 'ACTIVE' });
                    return successMsg;
                }

                // Update failure report for next iteration
                lastFailure = `Attempt ${attempt} also failed:\n${retryResults.join('\n')}`;
                this.broadcastToUI('LOG', `[PERSISTENCE] Attempt ${attempt} failed. ${maxRetries - attempt} retries remaining.`);
            } catch (e: any) {
                lastFailure = `Attempt ${attempt} crashed: ${e.message}`;
                this.broadcastToUI('LOG', `[PERSISTENCE] Attempt ${attempt} error: ${e.message}`);
            }
        }

        this.broadcastToUI('CHAT', { role: 'NEXUS', text: `🧠 Exhausted ${maxRetries} retry attempts. The task requires a different approach — please provide more details or try manually.` });
        this.broadcastToUI('STATE', { architect: 'IDLE', coder: 'IDLE', bridge: 'ACTIVE' });
        return null;
    }

    private async runGoalLoop() {
        while (this.goalLoopActive) {
            await new Promise(r => setTimeout(r, 1200000)); // Increase to 20 minutes

            const activeGoals = this.goalManager.getActive();
            // SKIP entirely if no goals or user is active
            if (activeGoals.length === 0 || this.chatQueue.length > 0) continue;

            try {
                const goalSummary = this.goalManager.getContextForLLM();
                const checkInRaw = await this.architect.sequence(
                    `Active goals:\n${goalSummary}\n\n` +
                    `Briefly assess if action is needed. If not, say "[ON TRACK]".`,
                    'LOW'
                );
                const checkIn = typeof checkInRaw === 'string' ? checkInRaw : JSON.stringify(checkInRaw);

                if (!checkIn.includes("[ON TRACK]")) {
                    this.broadcastToUI('LOG', `[GOALS] ${checkIn.substring(0, 100)}`);
                    this.broadcastToUI('NOTIFICATION', { title: 'Directive Update', body: checkIn.substring(0, 150) });
                }
            } catch (err: any) { }
        }
    }

    // ──────────── Telemetry Loop (5s) ────────────
    private async runTelemetryLoop() {
        NexusCLI.quietLog("[NEXUS CLAIRE] System Telemetry Loop Active (5s interval).");
        while (this.chatLoopActive) {
            try {
                const telemetry = getSystemTelemetry();
                const inferenceStats = inference.getRotationStats();
                this.broadcastToUI('SYSTEM_TELEMETRY', { ...telemetry, inference: inferenceStats });
            } catch (e: any) {
                console.error('[TELEMETRY] Failed to get system info:', e.message);
            }
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    // ──────────── Proactive Pulse (Event-Driven) ────────────
    private async runProactiveLoop() {
        let lastApp = "";
        let lastGoalCount = 0;
        await new Promise(r => setTimeout(r, 60000)); // 1min initial delay

        while (this.chatLoopActive) {
            await new Promise(r => setTimeout(r, 600000)); // Check every 10 mins

            // Focus Mode: yield all inference bandwidth to Engineer
            if (this.isAutonomousFocusMode) continue;

            // Skip if user is actively chatting
            if (this.chatQueue.length > 0) continue;

            try {
                const telemetry = getSystemTelemetry();

                // ─── CRITICAL EVENT DETECTION ───
                // 1. CPU/Memory Emergency
                if (telemetry.cpu > 90) {
                    this.broadcastToUI('CHAT', { role: 'NEXUS', text: `⚠️ ALERT: CPU at ${telemetry.cpu}%. System under heavy load.` });
                    this.broadcastToUI('LOG', `[PROACTIVE] Critical CPU: ${telemetry.cpu}%`);
                    this.speak(`Warning. CPU usage is at ${Math.round(telemetry.cpu)} percent.`);
                    continue;
                }

                // 2. Goal Completion Detection
                const goals = this.goalManager.getAll();
                const completedGoals = goals.filter((g: any) => g.status === 'completed');
                if (completedGoals.length > lastGoalCount) {
                    const newlyCompleted = completedGoals.slice(lastGoalCount);
                    for (const goal of newlyCompleted) {
                        this.broadcastToUI('CHAT', { role: 'NEXUS', text: `🎯 Goal Complete: "${goal.title}"` });
                        this.speak(`Goal completed: ${goal.title}`);
                    }
                    lastGoalCount = completedGoals.length;
                    continue;
                }

                // 3. Vision Awareness (Every 5 minutes)
                if (Math.random() > 0.8) { // ~20% of 60s cycles ~= every 5 mins
                    const screenshotPath = join(tmpdir(), `nexus_vision_${Date.now()}.png`);
                    try {
                        NexusCLI.quietLog("[PROACTIVE] Capturing vision heartbeat...");
                        await PlatformUtils.captureScreen(screenshotPath);
                        const base64 = readFileSync(screenshotPath, { encoding: 'base64' });

                        // Async extraction to avoid loop blocking
                        extractor.extractAndStore("", telemetry.activeApp, {
                            base64,
                            mime: "image/png"
                        }).then(() => {
                            this.broadcastToUI('LOG', "[PROACTIVE] Vision context synced to vault.");
                        });

                        unlinkSync(screenshotPath);
                    } catch (err: any) {
                        console.error("[PROACTIVE] Vision capture failed:", err.message);
                    }
                }

                // ─── AMBIENT AWARENESS (Only every ~15min equivalent) ───
                // Skip ambient checks most cycles (15 out of 16 cycles)
                if (Math.random() > 0.0625) continue;

                if (telemetry.activeApp === lastApp && telemetry.cpu < 80) continue;
                lastApp = telemetry.activeApp;

                const goalContext = this.goalManager.getContextForLLM();
                const proactivelyPrompt = `Context: ${telemetry.timestamp}, App: ${telemetry.activeApp}, CPU: ${telemetry.cpu}%. Goals: ${goalContext}.
Analyze state. If nothing urgent/noteworthy, say "[SILENT]". Else, 1 short casual sentence to Ruben.`;

                const thoughtRaw = await this.architect.sequence(proactivelyPrompt, 'LOW');
                const thoughtStr = typeof thoughtRaw === 'string' ? thoughtRaw : JSON.stringify(thoughtRaw);

                if (!thoughtStr.includes('[SILENT]') && thoughtStr.length > 5) {
                    this.broadcastToUI('CHAT', { role: 'NEXUS', text: `💭 ${thoughtStr}` });
                    this.speak(thoughtStr);
                }
            } catch (e: any) { }
        }
    }

    /**
     * External trigger for critical interruptions.
     * Called by engineer, satellite results, or other subsystems.
     */
    public triggerCriticalPulse(message: string, severity: 'info' | 'warning' | 'critical' = 'info') {
        const icon = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : '💡';
        this.broadcastToUI('CHAT', { role: 'NEXUS', text: `${icon} ${message}` });
        this.broadcastToUI('LOG', `[PULSE:${severity.toUpperCase()}] ${message}`);
        if (severity === 'critical') {
            this.speak(message);
        }
    }

    // ──────────── Memory Heartbeat (10min) ────────────
    private async runMemoryHeartbeat() {
        NexusCLI.quietLog("[NEXUS CLAIRE] Memory Heartbeat Loop Active (10min interval).");
        // Initial delay: 2 minutes after boot
        await new Promise(r => setTimeout(r, 120000));

        while (this.chatLoopActive) {
            // Focus Mode: yield inference bandwidth
            if (this.isAutonomousFocusMode) {
                await new Promise(r => setTimeout(r, 60000));
                continue;
            }

            try {
                // 1. Broadcast current vault state to dashboard
                const allFacts = await vault.getAllFacts();
                this.broadcastToUI('VAULT_UPDATE', { facts: allFacts.slice(0, 50) });

                // 2. Get all entities for dashboard
                const entities = (vault as any).db.query(
                    "SELECT name, type, description, last_seen FROM entities ORDER BY last_seen DESC LIMIT 20"
                ).all();
                this.broadcastToUI('VAULT_ENTITIES', { entities });

                if (allFacts.length > 0) {
                    console.log(`[HEARTBEAT] 🧠 Memory sync: ${allFacts.length} facts, ${entities.length} entities in vault.`);
                }

                // 3. Sync to Markdown for Obsidian
                await vault.syncToMarkdown();
            } catch (e: any) {
                console.error('[HEARTBEAT] Memory sync error:', e?.message);
            }

            // Wait 10 minutes
            await new Promise(r => setTimeout(r, 600000));
        }
    }

    // ──────────── Optimization Heartbeat (6 hours) ────────────
    private async runOptimizationHeartbeat() {
        NexusCLI.quietLog("[NEXUS CLAIRE] Optimization Heartbeat Active (6h interval).");
        // Initial delay: 5 minutes after boot
        await new Promise(r => setTimeout(r, 300000));

        while (this.chatLoopActive) {
            // Focus Mode: yield inference bandwidth
            if (this.isAutonomousFocusMode) {
                await new Promise(r => setTimeout(r, 60000));
                continue;
            }

            try {
                this.broadcastToUI('LOG', "[OPTIMIZER] Scanning codebase for technical debt and TODOs...");

                // Trigger a background task for the engineer to optimize
                const directive = "Perform a 'Self-Optimization Scan'. Search the codebase for FIXME, TODO, or deprecated patterns. If found, prioritize one and apply a surgical fix. If no debt found, analyze src/core/agent-runner.ts for performance bottlenecks.";

                console.log("[OPTIMIZER] Triggering autonomous optimization sequence...");
                engineer.executeTask(directive, "[HEARTBEAT: OPTIMIZATION]");

                this.broadcastToUI('LOG', "[OPTIMIZER] Optimization directive dispatched to Engineer sub-agent.");
            } catch (e: any) {
                console.error('[OPTIMIZER] Heartbeat error:', e?.message);
            }

            // Wait 6 hours (6 * 60 * 60 * 1000)
            await new Promise(r => setTimeout(r, 21600000));
        }
    }
}


// ──────────── Bootstrap ────────────
export const brain = new NexusBrain();

try {
    await brain.start();
} catch (e: any) {
    console.error("[CRITICAL FAILURE] Top level crash:", e?.message || e);
}

// ──────────── AUTONOMOUS HEALING MODE ────────────
// Traps unhandled errors and dispatches them to the Architect
// with source-control tools to self-diagnose and self-patch.

let healingCooldown = false;
const HEALING_COOLDOWN_MS = 60000; // 1 min cooldown to prevent infinite heal loops

async function triggerHealingMode(error: Error | string, source: string) {
    if (healingCooldown) {
        console.warn("[HEALING] Cooldown active — skipping healing to prevent loop.");
        return;
    }

    healingCooldown = true;
    setTimeout(() => { healingCooldown = false; }, HEALING_COOLDOWN_MS);

    const errorMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack || "" : "";

    console.log(`\n[HEALING MODE] 🧬 Autonomous Healing triggered by: ${source}`);
    console.log(`[HEALING MODE] Error: ${errorMsg}`);

    // Extract file path from stack trace
    const fileMatch = stack.match(/at\s+.*?\(?(\/[^:]+\.ts):(\d+)/);
    const crashFile = fileMatch ? fileMatch[1] : null;
    const crashLine = fileMatch ? fileMatch[2] : null;

    // Broadcast to dashboard
    try {
        (brain as any).broadcastToUI?.('CRITICAL_PULSE', {
            type: 'healing',
            title: '🧬 HEALING MODE ACTIVATED',
            body: `Error in ${crashFile || 'unknown'}:${crashLine || '?'} — ${errorMsg.substring(0, 100)}`,
        });
    } catch { /* dashboard may be down */ }

    // Build healing prompt for the Architect
    const healingPrompt = [
        `[HEALING MODE — CRITICAL]`,
        `An unhandled ${source} just occurred. You MUST attempt to fix it autonomously.`,
        ``,
        `Error: ${errorMsg}`,
        `Stack: ${stack.substring(0, 500)}`,
        crashFile ? `Crash Location: ${crashFile}:${crashLine}` : `Crash Location: Unknown (no stack trace)`,
        ``,
        `INSTRUCTIONS:`,
        `1. Use [TOOL: nexus.code_grep({"pattern": "<relevant search>"})] to locate the failing code.`,
        `2. Use [TOOL: nexus.code_read({"path": "<file>", "startLine": N, "endLine": N})] to inspect it.`,
        `3. Use [TOOL: nexus.code_patch({"path": "<file>", "target": "<broken code>", "replacement": "<fixed code>", "description": "<what you fixed>"})] to apply the fix.`,
        `4. Use [TOOL: nexus.run_tests({"mode": "typecheck"})] to verify.`,
        `5. Report back what you fixed.`,
        ``,
        `If you cannot identify the root cause, wrap the failing section in a try-catch to prevent the crash from recurring.`,
    ].join("\n");

    try {
        // Step 1: Auto-Checkpoint before healing attempt
        try {
            Bun.spawnSync(["git", "add", "-A"], { cwd: process.cwd() });
            Bun.spawnSync(["git", "commit", "-am", `AUTO-CHECKPOINT: Pre-healing (${source})`], { cwd: process.cwd(), timeout: 5000 });
            console.log(`[HEALING MODE] 📌 Git checkpoint created.`);
        } catch { /* Git might not be initialized */ }

        // Step 2: Let Architect attempt the fix
        const response = await (brain as any).architect.sequence(healingPrompt, 'HIGH');
        const result = typeof response === 'string' ? response : JSON.stringify(response);
        console.log(`[HEALING MODE] Architect response: ${result.substring(0, 300)}`);

        // Step 3: Verify the fix with TypeScript compiler
        const testProc = Bun.spawnSync(["bunx", "tsc", "--noEmit"], { cwd: process.cwd(), timeout: 30000 });
        const testOutput = (testProc.stdout.toString() + testProc.stderr.toString()).trim();
        const hasErrors = testOutput.split("\n").some(l => l.includes("error TS"));

        if (hasErrors) {
            // Step 4: AUTOMATIC REVERT — the safety fuse
            console.error(`[HEALING MODE] ❌ Fix verification FAILED. Auto-reverting via git reset...`);
            Bun.spawnSync(["git", "reset", "--hard", "HEAD"], { cwd: process.cwd() });
            Bun.spawnSync(["git", "clean", "-fd"], { cwd: process.cwd() });
            console.log(`[HEALING MODE] ⏪ Reverted to pre-healing checkpoint. System is stable.`);

            try {
                (brain as any).broadcastToUI?.('CHAT', {
                    role: 'NEXUS',
                    text: `🧬 [HEALING MODE] Attempted fix but it failed verification. Auto-reverted to stable state. Error: ${testOutput.substring(0, 200)}`,
                });
            } catch { }
        } else {
            console.log(`[HEALING MODE] ✅ Fix verified successfully! System is healthy.`);
            try {
                (brain as any).broadcastToUI?.('CHAT', {
                    role: 'NEXUS',
                    text: `🧬 [HEALING MODE] ${result.substring(0, 500)}`,
                });
            } catch { }
        }
    } catch (healErr: any) {
        console.error(`[HEALING MODE] Healing attempt failed: ${healErr?.message}`);
        // Last resort: revert to checkpoint
        try {
            Bun.spawnSync(["git", "reset", "--hard", "HEAD"], { cwd: process.cwd() });
            console.log(`[HEALING MODE] ⏪ Emergency revert after healing crash.`);
        } catch { }
    }
}

process.on("uncaughtException", (err) => {
    console.error("[GLOBAL] Uncaught Exception:", err);
    triggerHealingMode(err, "uncaughtException").catch(() => { });
});

process.on("unhandledRejection", (reason) => {
    console.error("[GLOBAL] Unhandled Rejection:", reason);
    const error = reason instanceof Error ? reason : new Error(String(reason));
    triggerHealingMode(error, "unhandledRejection").catch(() => { });
});

// Ensure the Node/Bun event loop absolutely never dies.
setInterval(() => {
    // Keep alive...
}, 1000000);

