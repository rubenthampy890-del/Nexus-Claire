import { serve, type ServerWebSocket } from "bun";
import { NexusArchitect } from "../agents/architect";
import { NexusCoder } from "../agents/coder";
import { NexusBridge } from "../agents/bridge";
import { VoiceEngine, SpeechToText, splitIntoSentences } from "./voice";
import { GoalManager } from "./goals/goal-manager";
import { getSystemTelemetry } from "./system-monitor";
import { vault } from "./vault";
import { VaultExtractor } from "../agents/extractor";
import { NexusCLI } from "./cli-ui";
import type { Service } from "./services/service-registry";
import { engineer } from "../agents/engineer";
import { voiceStream } from "./voice-stream";
import { identity } from "./identity";
import { skillEngine } from "./skill-engine";
import { socialPersona } from "../agents/social-persona";
import { TelemetryBot } from "../services/telemetry-bot";
import { WhatsAppBridge } from "../services/whatsapp-bridge";
import { registerBuiltinTools } from "./tools/builtin";
import { registerDeveloperTools } from "./tools/developer";
import { registerWebTools } from "./tools/web";
import { registerGitHubTools } from "./tools/github";
import { registerAppleScriptTools } from "./tools/applescript";
import { awareness } from "./awareness";
import { extractor } from "./extractor";
import { taskManager } from "./task-manager";
import { orchestrator } from "./orchestrator";
import { sandbox } from "./sandbox";
import { nexusCritic } from "./critic";
import { toolFactory } from "./tool-factory";
import { toolRegistry } from "./tool-registry";
import { userFinder } from "./user-finder";

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
    private bridge: NexusBridge;
    private goalManager: GoalManager;

    private _status: "stopped" | "running" | "error" = "stopped";
    private chatQueue: { text: string, source: 'UI' | 'PHONE' }[] = [];
    private audioQueue: Buffer[] = [];

    // UI Bridge Connections
    private uiClients: Set<ServerWebSocket<unknown>> = new Set();

    // Satellite Daemon Connections
    private satelliteClients: Map<string, ServerWebSocket<unknown>> = new Map();

    // Loop control
    private chatLoopActive = false;
    private goalLoopActive = false;
    private speakInterrupted = false;
    private phoneLink: TelemetryBot | null = null;
    private whatsappLink: WhatsAppBridge | null = null;

    constructor() {
        this.architect = new NexusArchitect();
        this.coder = new NexusCoder();
        this.bridge = new NexusBridge(this.broadcastToUI.bind(this));
        this.goalManager = new GoalManager();

        // 1. Register Autonomous Tools
        registerBuiltinTools();
        registerDeveloperTools();
        registerWebTools();
        registerGitHubTools();
        registerAppleScriptTools();

        // Wire continuous voice stream callbacks
        voiceStream.onTranscript = (text: string) => {
            console.log(`[VOICE-STREAM] Got transcript: "${text}"`);
            this.chatQueue.push({ text, source: 'UI' });
            this.broadcastToUI('CHAT', { role: 'USER', text: `🎤 ${text}` });
        };
        voiceStream.onInterrupt = () => {
            this.speakInterrupted = true;
            this.broadcastToUI('INTERRUPT', {});
            this.broadcastToUI('LOG', '[VOICE] Nexus interrupted by user.');
        };
        voiceStream.onVADStateChange = (speaking: boolean) => {
            this.broadcastToUI('VAD_STATE', { userSpeaking: speaking });
        };
    }

    // ──────────── Service Lifecycle ────────────
    public status(): "stopped" | "running" | "error" {
        return this._status;
    }

    public async start() {
        this._status = "running";
        NexusCLI.showBanner();

        this.initWebServer();
        NexusCLI.showStatus("Web Server", "ONLINE", "#00F0FF");

        this.broadcastToUI('STATE', { architect: 'IDLE', coder: 'IDLE', bridge: 'UPLINKING' });
        NexusCLI.showStatus("Architect", "READY", "#CC66FF");
        NexusCLI.showStatus("Goal Engine", "ACTIVE", "#33FF99");
        NexusCLI.showStatus("Voice Core", "CONNECTED", "#00CCFF");
        NexusCLI.showStatus("Nexus Vault", "SYNCED", "#FFCC00");

        // Initialize Identity Engine
        await identity.initialize();
        NexusCLI.showStatus("Identity Core", `${identity.getMode()}`, "#FF6699");

        // Initialize Skill Engine
        await skillEngine.initialize();
        NexusCLI.showStatus("Skill Engine", `${skillEngine.getAll().length} skills`, "#33CCFF");

        // Initialize Critic Tier (OpenClaw before_tool_call hook)
        toolRegistry.registerBeforeHook(nexusCritic.createToolGateHook());
        NexusCLI.showStatus("Critic Tier", "ARMED", "#FF4444");

        // Load self-authored tools from disk
        const loadedTools = toolFactory.loadPersistedTools();
        NexusCLI.showStatus("Tool Factory", `${loadedTools} learned tool(s)`, "#FF9900");

        // Log registry stats
        const stats = toolRegistry.getStats();
        console.log(`[BRAIN] Tool Registry: ${stats.total} tools (${stats.core} core, ${stats.learned} learned, ${stats.userAuthored} user-authored)`);

        // Initialize Telegram Link (Department 4)
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
            this.phoneLink = new TelemetryBot(botToken);
            this.phoneLink.onMessageReceived = (text: string) => {
                console.log(`[PHONE LINK] Incoming: "${text}"`);
                this.chatQueue.push({ text, source: 'PHONE' });
                this.broadcastToUI('CHAT', { role: 'USER', text: `📱 ${text}` });
            };
            this.phoneLink.launch();
            NexusCLI.showStatus("Phone Link", "CONNECTED", "#00FF66");
        } else {
            NexusCLI.showStatus("Phone Link", "OFFLINE (No Token)", "#FF3366");
        }

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
        this.whatsappLink.launch();

        NexusCLI.showDashboardLink();

        // Initialize Obsidian Mirroring
        await vault.syncToMarkdown();
        vault.watchMarkdownVault();

        // Start concurrent service loops
        this.chatLoopActive = true;
        this.goalLoopActive = true;

        try {
            await Promise.all([
                this.runChatLoop(),
                this.runGoalLoop(),
                this.runTelemetryLoop(),
                this.runProactiveLoop(),
                this.runMemoryHeartbeat(),
                socialPersona.launchLoop()
            ]);
        } catch (fatalError: any) {
            const errorMsg = fatalError?.stack || fatalError?.message || String(fatalError);
            console.error('\n[FATAL ERROR] Main event loops crashed:\n', errorMsg);
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

                    // Send Vault facts + entities on connection
                    vault.getAllFacts().then(facts => {
                        ws.send(JSON.stringify({ type: 'VAULT_UPDATE', payload: { facts: facts.slice(0, 50) } }));
                    });
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
                            // Continuous voice: process raw audio chunk
                            const audioBuffer = Buffer.from(data.payload, 'base64');
                            voiceStream.processAudioChunk(audioBuffer);
                        } else if (data.type === 'GET_IDENTITY') {
                            ws.send(JSON.stringify({ type: 'IDENTITY_PROFILE', payload: identity.getProfile() }));
                        } else if (data.type === 'SET_PERSONALITY_MODE') {
                            identity.setMode(data.payload);
                            this.broadcastToUI('IDENTITY_PROFILE', identity.getProfile());
                            this.broadcastToUI('LOG', `[IDENTITY] Mode switched to ${data.payload}`);
                        } else if (data.type === 'SANDBOX_EXEC') {
                            console.log(`[SANDBOX] Executing code (${data.payload.length} chars)...`);
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
                        } else if (data.type === 'SATELLITE_REGISTER') {
                            const satId = data.payload?.id || 'unknown';
                            this.satelliteClients.set(satId, ws);
                            console.log(`[SATELLITE] Registered: ${satId} (${this.satelliteClients.size} total)`);
                            this.broadcastToUI('LOG', `[SATELLITE] Cloud worker "${satId}" connected.`);
                            this.broadcastToUI('SWARM_UPDATE', { satellites: Array.from(this.satelliteClients.keys()) });
                        } else if (data.type === 'SATELLITE_HEARTBEAT') {
                            // Keep-alive — no action needed, connection stays open
                        } else if (data.type === 'SATELLITE_TASK_ACK') {
                            this.broadcastToUI('LOG', `[SATELLITE] Task ${data.payload?.taskId} acknowledged.`);
                        } else if (data.type === 'SATELLITE_TASK_RESULT') {
                            const { taskId, status, result, error } = data.payload || {};
                            if (status === 'complete') {
                                this.broadcastToUI('CHAT', { role: 'NEXUS', text: `[SATELLITE RESULT] ${result?.substring(0, 500) || 'Task completed.'}` });
                                this.broadcastToUI('LOG', `[SATELLITE] Task ${taskId} completed successfully.`);
                            } else {
                                this.broadcastToUI('LOG', `[SATELLITE] Task ${taskId} failed: ${error}`);
                            }
                        }
                    } catch {
                        console.log("[UI BRIDGE] Raw message:", message);
                    }
                },
                close: (ws) => {
                    this.uiClients.delete(ws);
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

            if (transcript && transcript.trim().length > 0) {
                console.log(`[VOICE] Transcribed: "${transcript}"`);
                // Do NOT echo transcript to chat - just queue it for processing
                this.chatQueue.push({ text: transcript, source: 'UI' });
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

    // ──────────── TTS Speech Engine ────────────
    private async speak(text: string) {
        this.speakInterrupted = false;
        voiceStream.nexusSpeaking = true;
        console.log(`[VOICE] Synthesizing speech: "${text.substring(0, 50)}..."`);
        const sentences = splitIntoSentences(text);
        for (const sentence of sentences) {
            // Check for interrupt between each sentence
            if (this.speakInterrupted) {
                console.log("[VOICE] Speech interrupted by user. Aborting remaining sentences.");
                break;
            }
            try {
                const audioBuffer = await VoiceEngine.synthesize(sentence);
                if (audioBuffer.length > 0) {
                    const base64 = audioBuffer.toString('base64');
                    this.broadcastToUI('AUDIO_RESPONSE', base64);
                }
            } catch (err: any) {
                console.error("[VOICE] TTS failed for sentence:", err.message);
            }
        }
        voiceStream.nexusSpeaking = false;
    }

    // ──────────── Chat Loop (100ms) ────────────
    private async runChatLoop() {
        console.log("[NEXUS CLAIRE] Chat Loop Active.");
        while (this.chatLoopActive) {
            if (this.chatQueue.length > 0) {
                const { text: userMessage, source } = this.chatQueue.shift()!;
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

                console.log(`[NEXUS CLAIRE] Processing: "${userMessage}"`);
                let rawResponse = await this.architect.sequence(augmentedMessage);
                let response = "";

                if (typeof rawResponse !== 'string') {
                    console.log("[NEXUS] StepTree generated:", rawResponse.plan);
                    response = `I have formulated a multi-step plan: ${rawResponse.plan}.\n[EXEC: execute StepTree: ${JSON.stringify(rawResponse.steps)}]`;
                } else {
                    response = rawResponse;
                }

                // COMMANDER OVERRIDE: If the user says "fix", "build", "create" and no EXEC is present, force it.
                const buildWords = ['fix', 'build', 'create', 'implement', 'update', 'modify', 'add'];
                const isBuildIntent = buildWords.some(w => userMessage.toLowerCase().includes(w));

                if (isBuildIntent && !response.includes('[EXEC:')) {
                    console.log("[NEXUS] Detected build intent but no EXEC present. Forcing autonomy...");
                    const forceResponse = await this.architect.sequence(
                        `Ruben wants ACTION. You are a COMMANDER. Do not explain. 
                        Construct exactly ONE [EXEC: ...] tag to execute this: ${userMessage}`
                    );
                    response = typeof forceResponse === 'string' ? forceResponse : JSON.stringify(forceResponse);
                }

                // Extract [EXEC: ...] for automated engineering subsystem
                const execMatch = response.match(/\[EXEC:(.*?)\]/is);
                let finalResponse = response;

                if (execMatch) {
                    const taskStr = execMatch[1]?.trim() || 'No task description provided.';
                    const taskId = `task-${Date.now()}`;

                    // Satellite-first routing: prefer cloud worker if available
                    const firstSatellite = this.satelliteClients.entries().next().value;
                    if (firstSatellite) {
                        const [satId, satWs] = firstSatellite;
                        console.log(`[SATELLITE] Routing task to satellite: ${satId}`);
                        try {
                            satWs.send(JSON.stringify({
                                type: "SATELLITE_TASK",
                                payload: { taskId, directive: taskStr, context: contextHeader }
                            }));
                            this.broadcastToUI('CHAT', { role: 'NEXUS', text: `[SATELLITE] Task dispatched to cloud worker "${satId}": "${taskStr}"` });
                            this.broadcastToUI('LOG', `[SATELLITE] Task ${taskId} → ${satId}`);
                        } catch (e) {
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

                // Send text + speak
                this.broadcastToUI('CHAT', { role: 'NEXUS', text: finalResponse });
                this.broadcastToUI('LOG', `[NEXUS] ${finalResponse.substring(0, 200)}...`);
                this.speak(finalResponse);

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
                        }
                    }, 500);
                }
            }
            await new Promise(r => setTimeout(r, 100));
        }
    }

    private async runGoalLoop() {
        while (this.goalLoopActive) {
            await new Promise(r => setTimeout(r, 300000)); // Increase to 5 minutes

            const activeGoals = this.goalManager.getActive();
            // SKIP entirely if no goals or user is active
            if (activeGoals.length === 0 || this.chatQueue.length > 0) continue;

            try {
                const goalSummary = this.goalManager.getContextForLLM();
                const checkInRaw = await this.architect.sequence(
                    `Active goals:\n${goalSummary}\n\n` +
                    `Briefly assess if action is needed. If not, say "[ON TRACK]".`
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
        console.log("[NEXUS CLAIRE] System Telemetry Loop Active (5s interval).");
        while (this.chatLoopActive) {
            try {
                const telemetry = getSystemTelemetry();
                this.broadcastToUI('SYSTEM_TELEMETRY', telemetry);
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
            await new Promise(r => setTimeout(r, 60000)); // Check every 60s

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

                // ─── AMBIENT AWARENESS (Only every ~15min equivalent) ───
                // Skip ambient checks most cycles (15 out of 16 cycles)
                if (Math.random() > 0.0625) continue;

                if (telemetry.activeApp === lastApp && telemetry.cpu < 80) continue;
                lastApp = telemetry.activeApp;

                const goalContext = this.goalManager.getContextForLLM();
                const proactivePrompt = `Context: ${telemetry.timestamp}, App: ${telemetry.activeApp}, CPU: ${telemetry.cpu}%. Goals: ${goalContext}.
Analyze state. If nothing urgent/noteworthy, say "[SILENT]". Else, 1 short casual sentence to Ruben.`;

                const thoughtRaw = await this.architect.sequence(proactivePrompt);
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
        console.log("[NEXUS CLAIRE] Memory Heartbeat Loop Active (10min interval).");
        // Initial delay: 2 minutes after boot
        await new Promise(r => setTimeout(r, 120000));

        while (this.chatLoopActive) {
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
}


// ──────────── Bootstrap ────────────
try {
    const brain = new NexusBrain();
    await brain.start();
} catch (e: any) {
    console.error("[CRITICAL FAILURE] Top level crash:", e?.message || e);
}

// Ensure the Node/Bun event loop absolutely never dies.
setInterval(() => {
    // Keep alive...
}, 1000000);
